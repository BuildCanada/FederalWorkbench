import { geolocation } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  JsonToSseTransformStream,
  smoothStream,
  stepCountIs,
  streamText,
} from "ai";
import { unstable_cache as cache } from "next/cache";
import type { ModelCatalog } from "tokenlens/core";
import { fetchModels } from "tokenlens/fetch";
import { getUsage } from "tokenlens/helpers";
import { auth, type UserType } from "@/app/(auth)/auth";
import type { VisibilityType } from "@/components/visibility-selector";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import type { ChatModel } from "@/lib/ai/models";
import {
  parliamentPrompt,
  type RequestHints,
  systemPrompt,
} from "@/lib/ai/prompts";
import { myProvider } from "@/lib/ai/providers";
import { createDocument } from "@/lib/ai/tools/create-document";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import {
  getLegislationContext,
  type LegislationContextResult,
  retrieveLegislationContext,
} from "@/lib/ai/tools/retrieve-legislation-context";
import {
  getParliamentContext,
  retrieveParliamentContext,
} from "@/lib/ai/tools/retrieve-parliament-context";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { isProductionEnvironment } from "@/lib/constants";
import {
  createStreamId,
  deleteChatById,
  ensureUserExistsById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatLastContextById,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatSDKError } from "@/lib/errors";
import { ragDebug, resetRagTimer } from "@/lib/rag/parliament/debug";
import { detectLanguage } from "@/lib/rag/parliament/query-analysis";
import type { ChatMessage } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

const getTokenlensCatalog = cache(
  async (): Promise<ModelCatalog | undefined> => {
    try {
      return await fetchModels();
    } catch (err) {
      console.warn(
        "TokenLens: catalog fetch failed, using default catalog",
        err
      );
      return; // tokenlens helpers will fall back to defaultCatalog
    }
  },
  ["tokenlens-catalog"],
  { revalidate: 24 * 60 * 60 } // 24 hours
);

const dbg = ragDebug("route");

// RAG feature flags - any truthy value enables
// Check both prefixed and non-prefixed versions for flexibility
const isParlRagEnabled =
  !!process.env.PARL_RAG_ENABLED || !!process.env.NEXT_PUBLIC_PARL_RAG_ENABLED;
const isLegRagEnabled =
  !!process.env.LEG_RAG_ENABLED || !!process.env.NEXT_PUBLIC_LEG_RAG_ENABLED;

export async function POST(request: Request) {
  resetRagTimer();

  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  try {
    const {
      id,
      message,
      selectedChatModel,
      selectedVisibilityType,
    }: {
      id: string;
      message: ChatMessage;
      selectedChatModel: ChatModel["id"];
      selectedVisibilityType: VisibilityType;
    } = requestBody;

    const session = await auth();

    if (!session?.user) {
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 24,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      return new ChatSDKError("rate_limit:chat").toResponse();
    }

    // Ensure the user row exists (dev sessions can survive DB resets)
    await ensureUserExistsById({
      id: session.user.id,
      email: session.user.email || undefined,
    });

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatSDKError("forbidden:chat").toResponse();
      }
      // Only fetch messages if chat already exists
      messagesFromDb = await getMessagesByChatId({ id });
    } else {
      const title = await generateTitleFromUserMessage({
        message,
      });

      await saveChat({
        id,
        userId: session.user.id,
        title,
        visibility: selectedVisibilityType,
      });
      // New chat - no need to fetch messages, it's empty
    }

    const uiMessages = [...convertToUIMessages(messagesFromDb), message];

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    await saveMessages({
      messages: [
        {
          chatId: id,
          id: message.id,
          role: "user",
          parts: message.parts,
          attachments: [],
          createdAt: new Date(),
          context: null,
        },
      ],
    });

    const streamId = generateUUID();
    await createStreamId({ streamId, chatId: id });

    let finalMergedUsage: AppUsage | undefined;

    // Try to assemble RAG context for the latest user message (lightweight pre-retrieval)
    const requestStart = Date.now();
    const userText = (message.parts || [])
      .map((p: any) => (p?.type === "text" ? p.text : ""))
      .join("\n")
      .trim();
    let ragSystem: string | undefined;
    let langGuess: "en" | "fr" | "unknown" = "unknown";
    let ragMs = 0;
    let parlResult:
      | Awaited<ReturnType<typeof getParliamentContext>>
      | undefined;
    let legResult: LegislationContextResult | undefined;

    try {
      if (userText) {
        const ragStart = Date.now();

        // Fetch enabled RAG contexts in parallel
        const ragPromises: Promise<void>[] = [];

        if (isParlRagEnabled) {
          ragPromises.push(
            getParliamentContext(userText, 10).then((r) => {
              parlResult = r;
            })
          );
        }

        if (isLegRagEnabled) {
          ragPromises.push(
            getLegislationContext(userText, 10).then((r) => {
              legResult = r;
            })
          );
        }

        await Promise.all(ragPromises);
        ragMs = Date.now() - ragStart;

        // Use parliament language detection if available, fallback to legislation, then detect
        langGuess =
          parlResult?.language ??
          legResult?.language ??
          detectLanguage(userText).language;

        dbg(
          "prefetch: lang=%s parlTypes=%d legCitations=%d ragMs=%d",
          langGuess,
          parlResult?.hydratedSources?.length ?? 0,
          legResult?.citations?.length ?? 0,
          ragMs
        );

        // Build combined context prompt
        const contextParts: string[] = [];
        if (parlResult?.prompt) {
          contextParts.push(parlResult.prompt);
        }
        if (legResult?.prompt) {
          contextParts.push(legResult.prompt);
        }

        if (contextParts.length > 0) {
          ragSystem = parliamentPrompt({
            requestHints,
            language: langGuess,
            context: contextParts.join("\n\n"),
          });
        }
      }
    } catch {
      // RAG failed - detect language for fallback prompt
      ragMs = Date.now() - requestStart;
      langGuess = userText ? detectLanguage(userText).language : "unknown";
      ragSystem = undefined;
    }

    const stream = createUIMessageStream({
      execute: ({ writer: dataStream }) => {
        // Send pre-fetched RAG contexts to client for UI features
        if (parlResult) {
          dataStream.write({
            type: "data-parliamentContext",
            data: parlResult,
          });
        }
        if (legResult) {
          dataStream.write({
            type: "data-legislationContext",
            data: legResult,
          });
        }
        const result = streamText({
          model: myProvider.languageModel(selectedChatModel),
          system:
            ragSystem ??
            systemPrompt({
              selectedChatModel,
              requestHints,
              language: langGuess,
            }),
          messages: convertToModelMessages(uiMessages),
          stopWhen: stepCountIs(5),
          experimental_activeTools:
            selectedChatModel === "chat-model-reasoning"
              ? []
              : ([
                  "getWeather",
                  "createDocument",
                  "updateDocument",
                  "requestSuggestions",
                  ...(isParlRagEnabled
                    ? (["retrieveParliamentContext"] as const)
                    : []),
                  ...(isLegRagEnabled
                    ? (["retrieveLegislationContext"] as const)
                    : []),
                ] as const),
          experimental_transform: smoothStream({ chunking: "word" }),
          tools: {
            getWeather,
            createDocument: createDocument({ session, dataStream }),
            updateDocument: updateDocument({ session, dataStream }),
            requestSuggestions: requestSuggestions({
              session,
              dataStream,
            }),
            ...(isParlRagEnabled ? { retrieveParliamentContext } : {}),
            ...(isLegRagEnabled ? { retrieveLegislationContext } : {}),
          },
          providerOptions:
            selectedChatModel === "chat-model-reasoning"
              ? {
                  openai: {
                    reasoningSummary: "detailed",
                  },
                }
              : undefined,
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: "stream-text",
          },
          onFinish: async ({ usage }) => {
            try {
              const providers = await getTokenlensCatalog();
              const modelId =
                myProvider.languageModel(selectedChatModel).modelId;
              if (!modelId) {
                finalMergedUsage = usage;
                dataStream.write({
                  type: "data-usage",
                  data: finalMergedUsage,
                });
                return;
              }

              if (!providers) {
                finalMergedUsage = usage;
                dataStream.write({
                  type: "data-usage",
                  data: finalMergedUsage,
                });
                return;
              }

              const summary = getUsage({ modelId, usage, providers });
              finalMergedUsage = { ...usage, ...summary, modelId } as AppUsage;
              dataStream.write({ type: "data-usage", data: finalMergedUsage });
            } catch (err) {
              console.warn("TokenLens enrichment failed", err);
              finalMergedUsage = usage;
              dataStream.write({ type: "data-usage", data: finalMergedUsage });
            }
          },
        });

        result.consumeStream();

        dataStream.merge(
          result.toUIMessageStream({
            sendReasoning: selectedChatModel === "chat-model-reasoning",
          })
        );
      },
      generateId: generateUUID,
      onFinish: async ({ messages }) => {
        const totalMs = Date.now() - requestStart;
        const llmMs = totalMs - ragMs;
        dbg(
          "complete: totalMs=%d ragMs=%d llmMs=%d query=%s",
          totalMs,
          ragMs,
          llmMs,
          userText.slice(0, 50)
        );

        // Build RAG context object for assistant messages
        const ragContext =
          parlResult || legResult
            ? {
                ...(parlResult ? { parliament: parlResult } : {}),
                ...(legResult ? { legislation: legResult } : {}),
              }
            : null;

        await saveMessages({
          messages: messages.map((currentMessage) => ({
            id: currentMessage.id,
            role: currentMessage.role,
            parts: currentMessage.parts,
            createdAt: new Date(),
            attachments: [],
            chatId: id,
            // Attach RAG context to assistant messages
            context: currentMessage.role === "assistant" ? ragContext : null,
          })),
        });

        if (finalMergedUsage) {
          try {
            await updateChatLastContextById({
              chatId: id,
              context: finalMergedUsage,
            });
          } catch (err) {
            console.warn("Unable to persist last usage for chat", id, err);
          }
        }
      },
      onError: () => {
        return "Oops, an error occurred!";
      },
    });

    // const streamContext = getStreamContext();

    // if (streamContext) {
    //   return new Response(
    //     await streamContext.resumableStream(streamId, () =>
    //       stream.pipeThrough(new JsonToSseTransformStream())
    //     )
    //   );
    // }

    return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    // Check for Vercel AI Gateway credit card error
    if (
      error instanceof Error &&
      error.message?.includes(
        "AI Gateway requires a valid credit card on file to service requests"
      )
    ) {
      return new ChatSDKError("bad_request:activate_gateway").toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatSDKError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatSDKError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
