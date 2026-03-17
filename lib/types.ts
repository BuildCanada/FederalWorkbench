import type { InferUITool, UIMessage } from "ai";
import { z } from "zod";
import type { ArtifactKind } from "@/components/artifact";
import type { createDocument } from "./ai/tools/create-document";
import type { getWeather } from "./ai/tools/get-weather";
import type { requestSuggestions } from "./ai/tools/request-suggestions";
import type {
  LegislationContextResult,
  retrieveLegislationContext,
} from "./ai/tools/retrieve-legislation-context";
import type {
  ParliamentContextResult,
  retrieveParliamentContext,
} from "./ai/tools/retrieve-parliament-context";
import type { updateDocument } from "./ai/tools/update-document";
import type { MessageContext, Suggestion } from "./db/schema";
import type { AppUsage } from "./usage";

export type DataPart = { type: "append-message"; message: string };

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type weatherTool = InferUITool<typeof getWeather>;
type createDocumentTool = InferUITool<ReturnType<typeof createDocument>>;
type updateDocumentTool = InferUITool<ReturnType<typeof updateDocument>>;
type requestSuggestionsTool = InferUITool<
  ReturnType<typeof requestSuggestions>
>;
type retrieveParliamentContextTool = InferUITool<
  typeof retrieveParliamentContext
>;
type retrieveLegislationContextTool = InferUITool<
  typeof retrieveLegislationContext
>;

export type ChatTools = {
  getWeather: weatherTool;
  createDocument: createDocumentTool;
  updateDocument: updateDocumentTool;
  requestSuggestions: requestSuggestionsTool;
  retrieveParliamentContext: retrieveParliamentContextTool;
  retrieveLegislationContext: retrieveLegislationContextTool;
};

export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  usage: AppUsage;
  parliamentContext: ParliamentContextResult;
  legislationContext: LegislationContextResult;
};

// Extend UIMessage with our custom context field
export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
> & {
  context?: MessageContext | null;
};

export type Attachment = {
  name: string;
  url: string;
  contentType: string;
};
