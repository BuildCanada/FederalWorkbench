"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import equal from "fast-deep-equal";
import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useArtifact } from "@/hooks/use-artifact";
import type { LegislationContextResult } from "@/lib/ai/tools/retrieve-legislation-context";
import type { ParliamentContextResult } from "@/lib/ai/tools/retrieve-parliament-context";
import type { Vote } from "@/lib/db/schema";
import type { HydratedLegislationSource } from "@/lib/rag/legislation/hydrate";
import type { ChatMessage } from "@/lib/types";
import { cn, generateUUID, sanitizeText } from "@/lib/utils";
import { DocumentToolResult } from "./document";
import { DocumentPreview } from "./document-preview";
import { Citations } from "./elements/citations";
import { LegislationContextPanel } from "./elements/legislation-context-panel";
import { MessageContent } from "./elements/message";
import { Response } from "./elements/response";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "./elements/tool";
import { SparklesIcon } from "./icons";
import { MessageActions } from "./message-actions";
import { MessageEditor } from "./message-editor";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";
import { Weather } from "./weather";

// Regex patterns at top level for performance
const REGEX_ACT_ID_PREFIX = /^act-/;
const REGEX_REG_ID_PREFIX = /^reg-/;
// Citation patterns with prefixes: [P1], [P2], [L1], [L2], etc.
const REGEX_PARLIAMENT_CITATION = /\[P(\d+)\](?!\()/g;
const REGEX_LEGISLATION_CITATION = /\[L(\d+)\](?!\()/g;

const PurePreviewMessage = ({
  chatId,
  message,
  vote,
  isLoading,
  setMessages,
  regenerate,
  isReadonly,
  requiresScrollPadding,
  parliamentContext: parliamentContextProp,
  legislationContext: legislationContextProp,
}: {
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
  parliamentContext: ParliamentContextResult | null;
  legislationContext: LegislationContextResult | null;
}) => {
  const [mode, setMode] = useState<"view" | "edit">("view");

  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === "file"
  );

  const { setArtifact } = useArtifact();

  // Get parliament context from: 1) message context (persisted), 2) tool output, 3) prop
  // The prop is now scoped to this specific message (via forMessageId in parent)
  const latestParliamentContext: ParliamentContextResult | undefined = (() => {
    // First check persisted context on the message
    if (message.context?.parliament) {
      return message.context.parliament;
    }
    // Then check if LLM called the tool (tool output in message parts)
    const parts = message.parts || [];
    for (let i = parts.length - 1; i >= 0; i--) {
      const p: any = parts[i];
      if (
        p?.type === "tool-retrieveParliamentContext" &&
        p?.state === "output-available" &&
        p?.output &&
        !("error" in p.output)
      ) {
        return p.output as ParliamentContextResult;
      }
    }
    // Fall back to pre-fetched context passed as prop
    // The prop is now scoped to this message's ID by the parent component
    return parliamentContextProp ?? undefined;
  })();

  // Get legislation context from: 1) message context (persisted), 2) tool output, 3) prop
  const latestLegislationContext: LegislationContextResult | undefined =
    (() => {
      // First check persisted context on the message
      if (message.context?.legislation) {
        return message.context.legislation;
      }
      // Then check if LLM called the tool (tool output in message parts)
      const parts = message.parts || [];
      for (let i = parts.length - 1; i >= 0; i--) {
        const p: any = parts[i];
        if (
          p?.type === "tool-retrieveLegislationContext" &&
          p?.state === "output-available" &&
          p?.output &&
          !("error" in p.output)
        ) {
          return p.output as LegislationContextResult;
        }
      }
      // Fall back to pre-fetched context passed as prop
      return legislationContextProp ?? undefined;
    })();

  /**
   * Convert citation markers like [P1], [L2] into markdown links.
   * Parliament uses [Pn] prefix, legislation uses [Ln] prefix.
   * This avoids collisions when both RAG systems return results.
   */
  function linkifyCitationMarkers(
    raw: string,
    parlCtx?: ParliamentContextResult,
    legCtx?: LegislationContextResult
  ): string {
    let result = raw;

    // Helper to build markdown link from citation
    // displayId is what the user sees (just the number), not the internal prefixed ID
    const buildLink = (
      displayId: number,
      citation: {
        urlEn?: string;
        urlFr?: string;
        textEn: string;
        textFr: string;
        titleEn?: string;
        titleFr?: string;
      },
      isFrench: boolean
    ): string => {
      const href = isFrench
        ? (citation.urlFr ?? citation.urlEn)
        : (citation.urlEn ?? citation.urlFr);
      const text = isFrench ? citation.textFr : citation.textEn;
      const citationTitle = isFrench ? citation.titleFr : citation.titleEn;
      const title = citationTitle ? `${text} — ${citationTitle}` : text;
      if (!href) {
        return `[${displayId}]`;
      }
      return `[${displayId}](${href} "${title.replace(/"/g, "'")}")`;
    };

    // Link parliament citations [P1], [P2], etc. -> user sees [1], [2], etc.
    if (parlCtx?.citations && parlCtx.citations.length > 0) {
      const isFrench = parlCtx.language === "fr";
      result = result.replace(REGEX_PARLIAMENT_CITATION, (match, numStr) => {
        const id = Number(numStr);
        const c = parlCtx.citations.find((ci) => ci.id === id);
        if (!c) {
          return match;
        }
        return buildLink(id, c, isFrench);
      });
    }

    // Link legislation citations [L1], [L2], etc. -> user sees [1], [2], etc.
    if (legCtx?.citations && legCtx.citations.length > 0) {
      const isFrench = legCtx.language === "fr";
      result = result.replace(REGEX_LEGISLATION_CITATION, (match, numStr) => {
        const id = Number(numStr);
        const c = legCtx.citations.find((ci) => ci.id === id);
        if (!c) {
          return match;
        }
        return buildLink(id, c, isFrench);
      });
    }

    return result;
  }

  async function openParliamentSourceArtifact(sourceType: string) {
    try {
      const ctx = latestParliamentContext;
      const source = ctx?.hydratedSources.find(
        (s) => s.sourceType === sourceType
      );
      if (!ctx || !source) {
        return;
      }
      const docId = generateUUID();
      const isFr = source.languageUsed === "fr";
      // Parse id like "bill-C-35-44-1" to get readable title
      const idParts = source.id.split("-");
      const label =
        sourceType === "bill"
          ? `${idParts[1]}-${idParts[2]} (${idParts[3]}-${idParts[4]})`
          : source.id;
      const title = isFr
        ? `${sourceType} — ${label} — Texte intégral`
        : `${sourceType} — ${label} — Full Text`;
      const content = source.markdown;

      // Persist document so it survives refresh/versioning
      await fetch(`/api/document?id=${docId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, title, kind: "text" }),
      });

      // Show artifact panel with the saved document
      setArtifact((a) => ({
        ...a,
        documentId: docId,
        title,
        kind: "text",
        content,
        isVisible: true,
        status: "idle",
      }));
    } catch (err) {
      console.error("[openParliamentSourceArtifact] error:", err);
    }
  }

  async function openLegislationSourceArtifact(
    source: HydratedLegislationSource
  ) {
    try {
      const docId = generateUUID();
      const language = source.languageUsed || "en";
      const isFr = language === "fr";

      let title: string;
      let content: string;
      let kind: "legislation" | "text";

      const { sourceType } = source;

      if (sourceType === "act" || sourceType === "act_section") {
        // Acts use the legislation viewer
        const actId = source.id.replace(REGEX_ACT_ID_PREFIX, "");
        title = isFr
          ? `Loi — ${actId} — Texte intégral`
          : `Act — ${actId} — Full Text`;
        content = JSON.stringify({ docType: "act", docId: actId, language });
        kind = "legislation";
      } else if (
        sourceType === "regulation" ||
        sourceType === "regulation_section"
      ) {
        // Regulations use the legislation viewer
        const regulationId = source.id.replace(REGEX_REG_ID_PREFIX, "");
        title = isFr
          ? `Règlement — ${regulationId} — Texte intégral`
          : `Regulation — ${regulationId} — Full Text`;
        content = JSON.stringify({
          docType: "regulation",
          docId: regulationId,
          language,
        });
        kind = "legislation";
      } else if (sourceType === "defined_term") {
        // Defined terms use text viewer
        const termLabel = source.term ? `"${source.term}"` : "";
        title = isFr
          ? `Définition — ${termLabel}`
          : `Definition — ${termLabel}`;
        content = source.markdown;
        kind = "text";
      } else if (sourceType === "cross_reference") {
        // Cross-references use text viewer
        title = isFr
          ? `Renvoi — ${source.targetTitle ?? ""}`
          : `Cross-reference — ${source.targetTitle ?? ""}`;
        content = source.markdown;
        kind = "text";
      } else {
        // Fallback for other source types
        title = source.displayLabel ?? source.id;
        content = source.markdown;
        kind = "text";
      }

      // Persist document so it survives refresh/versioning
      const res = await fetch(`/api/document?id=${docId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, title, kind }),
      });
      if (!res.ok) {
        console.error(
          "[openLegislationSourceArtifact] Failed to save document:",
          res.status
        );
        return;
      }

      // Show artifact panel with the saved document
      setArtifact((a) => ({
        ...a,
        documentId: docId,
        title,
        kind,
        content,
        isVisible: true,
        status: "idle",
      }));
    } catch (err) {
      console.error("[openLegislationSourceArtifact] error:", err);
    }
  }

  const billSource = latestParliamentContext?.hydratedSources?.find(
    (s) => s.sourceType === "bill"
  );

  return (
    <div
      className="group/message fade-in w-full animate-in duration-200"
      data-role={message.role}
      data-testid={`message-${message.role}`}
    >
      <div
        className={cn("flex w-full items-start gap-2 md:gap-3", {
          "justify-end": message.role === "user" && mode !== "edit",
          "justify-start": message.role === "assistant",
        })}
      >
        {message.role === "assistant" && (
          <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
            <SparklesIcon size={14} />
          </div>
        )}

        <div
          className={cn("flex flex-col", {
            "gap-2 md:gap-4": message.parts?.some(
              (p) => p.type === "text" && p.text?.trim()
            ),
            "min-h-96": message.role === "assistant" && requiresScrollPadding,
            "w-full":
              (message.role === "assistant" &&
                message.parts?.some(
                  (p) => p.type === "text" && p.text?.trim()
                )) ||
              mode === "edit",
            "max-w-[calc(100%-2.5rem)] sm:max-w-[min(fit-content,80%)]":
              message.role === "user" && mode !== "edit",
          })}
        >
          {attachmentsFromMessage.length > 0 && (
            <div
              className="flex flex-row justify-end gap-2"
              data-testid={"message-attachments"}
            >
              {attachmentsFromMessage.map((attachment) => (
                <PreviewAttachment
                  attachment={{
                    name: attachment.filename ?? "file",
                    contentType: attachment.mediaType,
                    url: attachment.url,
                  }}
                  key={attachment.url}
                />
              ))}
            </div>
          )}

          {message.parts?.map((part, index) => {
            const { type } = part;
            const key = `message-${message.id}-part-${index}`;

            if (type === "reasoning" && part.text?.trim().length > 0) {
              return (
                <MessageReasoning
                  isLoading={isLoading}
                  key={key}
                  reasoning={part.text}
                />
              );
            }

            if (type === "text") {
              if (mode === "view") {
                return (
                  <div key={key}>
                    <MessageContent
                      className={cn({
                        "w-fit break-words rounded-2xl px-3 py-2 text-right text-white":
                          message.role === "user",
                        "bg-transparent px-0 py-0 text-left":
                          message.role === "assistant",
                      })}
                      data-testid="message-content"
                      style={
                        message.role === "user"
                          ? { backgroundColor: "#006cff" }
                          : undefined
                      }
                    >
                      <Response>
                        {sanitizeText(
                          linkifyCitationMarkers(
                            part.text,
                            latestParliamentContext,
                            latestLegislationContext
                          )
                        )}
                      </Response>
                    </MessageContent>
                  </div>
                );
              }

              if (mode === "edit") {
                return (
                  <div
                    className="flex w-full flex-row items-start gap-3"
                    key={key}
                  >
                    <div className="size-8" />
                    <div className="min-w-0 flex-1">
                      <MessageEditor
                        key={message.id}
                        message={message}
                        regenerate={regenerate}
                        setMessages={setMessages}
                        setMode={setMode}
                      />
                    </div>
                  </div>
                );
              }
            }

            if (type === "tool-getWeather") {
              const { toolCallId, state } = part;

              return (
                <Tool defaultOpen={true} key={toolCallId}>
                  <ToolHeader state={state} type="tool-getWeather" />
                  <ToolContent>
                    {state === "input-available" && (
                      <ToolInput input={part.input} />
                    )}
                    {state === "output-available" && (
                      <ToolOutput
                        errorText={undefined}
                        output={
                          part.output && "error" in part.output ? (
                            <div className="rounded border p-2 text-red-500">
                              Error: {String(part.output.error)}
                            </div>
                          ) : (
                            <Weather weatherAtLocation={part.output} />
                          )
                        }
                      />
                    )}
                  </ToolContent>
                </Tool>
              );
            }

            if (type === "tool-createDocument") {
              const { toolCallId } = part;

              if (part.output && "error" in part.output) {
                return (
                  <div
                    className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                    key={toolCallId}
                  >
                    Error creating document: {String(part.output.error)}
                  </div>
                );
              }

              return (
                <DocumentPreview
                  isReadonly={isReadonly}
                  key={toolCallId}
                  result={part.output}
                />
              );
            }

            if (type === "tool-updateDocument") {
              const { toolCallId } = part;

              if (part.output && "error" in part.output) {
                return (
                  <div
                    className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                    key={toolCallId}
                  >
                    Error updating document: {String(part.output.error)}
                  </div>
                );
              }

              return (
                <div className="relative" key={toolCallId}>
                  <DocumentPreview
                    args={{ ...part.output, isUpdate: true }}
                    isReadonly={isReadonly}
                    result={part.output}
                  />
                </div>
              );
            }

            if (type === "tool-requestSuggestions") {
              const { toolCallId, state } = part;

              return (
                <Tool defaultOpen={true} key={toolCallId}>
                  <ToolHeader state={state} type="tool-requestSuggestions" />
                  <ToolContent>
                    {state === "input-available" && (
                      <ToolInput input={part.input} />
                    )}
                    {state === "output-available" && (
                      <ToolOutput
                        errorText={undefined}
                        output={
                          "error" in part.output ? (
                            <div className="rounded border p-2 text-red-500">
                              Error: {String(part.output.error)}
                            </div>
                          ) : (
                            <DocumentToolResult
                              isReadonly={isReadonly}
                              result={part.output}
                              type="request-suggestions"
                            />
                          )
                        }
                      />
                    )}
                  </ToolContent>
                </Tool>
              );
            }

            // Hide retrieveParliamentContext tool card in the UI, but still
            // use its output for inline [n] citation linking above.
            if (type === "tool-retrieveParliamentContext") {
              return null;
            }

            // Hide retrieveLegislationContext tool card in the UI
            if (type === "tool-retrieveLegislationContext") {
              return null;
            }

            return null;
          })}

          {!isLoading &&
            message.role === "assistant" &&
            latestParliamentContext?.citations &&
            latestParliamentContext.citations.length > 0 && (
              <Citations
                citations={latestParliamentContext.citations}
                language={latestParliamentContext.language}
              />
            )}

          {!isLoading && message.role === "assistant" && billSource ? (
            <div className="mt-2">
              <Button
                onClick={() => openParliamentSourceArtifact("bill")}
                size="sm"
                variant="outline"
              >
                {latestParliamentContext?.language === "fr"
                  ? "Ouvrir le projet de loi"
                  : "Open Bill"}
              </Button>
            </div>
          ) : null}

          {!isLoading &&
            message.role === "assistant" &&
            latestLegislationContext?.citations &&
            latestLegislationContext.citations.length > 0 && (
              <Citations
                citations={latestLegislationContext.citations}
                language={latestLegislationContext.language}
              />
            )}

          {!isLoading &&
            message.role === "assistant" &&
            latestLegislationContext?.hydratedSources &&
            latestLegislationContext.hydratedSources.length > 0 && (
              <LegislationContextPanel
                hydratedSources={latestLegislationContext.hydratedSources}
                language={latestLegislationContext.language}
                onOpenSource={openLegislationSourceArtifact}
              />
            )}

          {!isReadonly && (
            <MessageActions
              chatId={chatId}
              isLoading={isLoading}
              key={`action-${message.id}`}
              message={message}
              setMode={setMode}
              vote={vote}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) {
      return false;
    }
    if (prevProps.message.id !== nextProps.message.id) {
      return false;
    }
    if (prevProps.requiresScrollPadding !== nextProps.requiresScrollPadding) {
      return false;
    }
    if (!equal(prevProps.message.parts, nextProps.message.parts)) {
      return false;
    }
    if (!equal(prevProps.vote, nextProps.vote)) {
      return false;
    }

    return false;
  }
);

export const ThinkingMessage = () => {
  return (
    <div
      className="group/message fade-in w-full animate-in duration-300"
      data-role="assistant"
      data-testid="message-assistant-loading"
    >
      <div className="flex items-start justify-start gap-3">
        <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
          <div className="animate-pulse">
            <SparklesIcon size={14} />
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 md:gap-4">
          <div className="flex items-center gap-1 p-0 text-muted-foreground text-sm">
            <span className="animate-pulse">Thinking</span>
            <span className="inline-flex">
              <span className="animate-bounce [animation-delay:0ms]">.</span>
              <span className="animate-bounce [animation-delay:150ms]">.</span>
              <span className="animate-bounce [animation-delay:300ms]">.</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
