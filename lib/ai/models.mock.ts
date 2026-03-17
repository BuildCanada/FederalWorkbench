import type { LanguageModel } from "ai";
import { generateId } from "ai";

// Regex patterns for mock language detection (moved to top level for performance)
const TEXT_EXTRACT_PATTERN = /Text: "([^"]+)"/;
const QUERY_EXTRACT_PATTERN = /Query: "([^"]+)"/;
const FRENCH_CHARS_PATTERN = /[àâçéèêëîïôùûüÿœæ]/;
const FRENCH_WORDS_PATTERN =
  /\b(le|la|les|des|du|qu'est-ce|projet de loi|parlement)\b/i;

// Patterns for intent detection mock
const VOTE_PATTERN =
  /\b(vote[ds]?|voting|voted|yea|nay|favour|against|support|oppose|pass|fail|defeat)\b/i;
const DEBATE_PATTERN =
  /\b(debate[ds]?|said|spoke|speech|statement|hansard|house|commons)\b/i;
const COMMITTEE_PATTERN = /\b(committee|hearing|witness|testimony|report)\b/i;
const ELECTION_PATTERN = /\b(election|elected|candidate|campaign)\b/i;
const POLITICIAN_PATTERN =
  /\b(mp|member|politician|trudeau|poilievre|singh|blanchet|deputy|minister)\b/i;
const PARTY_PATTERN =
  /\b(liberal|conservative|ndp|bloc|green|party|parties)\b/i;
const BILL_PATTERN = /\b[CS]-\d+\b/i;

// Test prompt response patterns
const GRASS_PATTERN = /why is grass green/i;
const SKY_PATTERN = /why is the sky blue/i;
const WEATHER_SF_PATTERN = /weather in sf|weather in san francisco/i;
const BILL_C35_PATTERN = /bill c-35|44th parliament/i;
const MONET_PATTERN = /who painted this/i;

type StreamPart = {
  type: string;
  id?: string;
  delta?: string;
  finishReason?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  toolCallId?: string;
  toolName?: string;
  input?: string;
  result?: unknown;
};

/**
 * Convert text to stream deltas for mock responses.
 */
function textToDeltas(text: string): StreamPart[] {
  const id = generateId();
  const words = text.split(" ");
  const deltas: StreamPart[] = words.map((word) => ({
    id,
    type: "text-delta",
    delta: `${word} `,
  }));
  return [{ id, type: "text-start" }, ...deltas, { id, type: "text-end" }];
}

/**
 * Get canned response chunks based on the user's prompt.
 * Used by mock models in test environment.
 */
function getCannedResponseChunks(prompt: string): StreamPart[] {
  // Check for grass question
  if (GRASS_PATTERN.test(prompt)) {
    return [
      ...textToDeltas("It's just green duh!"),
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 3, outputTokens: 10, totalTokens: 13 },
      },
    ];
  }

  // Check for sky question
  if (SKY_PATTERN.test(prompt)) {
    return [
      ...textToDeltas("It's just blue duh!"),
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 3, outputTokens: 10, totalTokens: 13 },
      },
    ];
  }

  // Check for weather in SF (tool call)
  if (WEATHER_SF_PATTERN.test(prompt)) {
    return [
      {
        type: "tool-call",
        toolCallId: "call_456",
        toolName: "getWeather",
        input: JSON.stringify({ latitude: 37.7749, longitude: -122.4194 }),
      },
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 3, outputTokens: 10, totalTokens: 13 },
      },
    ];
  }

  // Check for Bill C-35 / parliament question (the suggestion button)
  if (BILL_C35_PATTERN.test(prompt)) {
    return [
      ...textToDeltas("With Next.js, you can ship fast!"),
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 3, outputTokens: 10, totalTokens: 13 },
      },
    ];
  }

  // Check for image attachment (Monet painting)
  if (MONET_PATTERN.test(prompt)) {
    return [
      ...textToDeltas("This painting is by Monet!"),
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 3, outputTokens: 10, totalTokens: 13 },
      },
    ];
  }

  // Check for weather tool result (after tool call)
  if (prompt.includes("getWeather") && prompt.includes("temperature_2m")) {
    return [
      ...textToDeltas("The current temperature in San Francisco is 17°C."),
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 3, outputTokens: 10, totalTokens: 13 },
      },
    ];
  }

  // Default fallback
  return [
    ...textToDeltas("Mock response"),
    {
      type: "finish",
      finishReason: "stop",
      usage: { inputTokens: 3, outputTokens: 10, totalTokens: 13 },
    },
  ];
}

/**
 * Extract text content from AI SDK v2 prompt format.
 * The prompt is an array of messages, each with content that may be text parts.
 */
function extractPromptText(prompt: unknown): string {
  if (!prompt || !Array.isArray(prompt)) {
    return "";
  }

  const texts: string[] = [];
  for (const message of prompt) {
    if (message && typeof message === "object" && "content" in message) {
      const content = message.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (
            part &&
            typeof part === "object" &&
            "type" in part &&
            part.type === "text" &&
            "text" in part
          ) {
            texts.push(String(part.text));
          }
        }
      }
    }
  }
  return texts.join("\n");
}

/**
 * Detect search types from query for mock intent model.
 * Returns a SearchTypes-compatible object based on regex patterns.
 */
function detectMockSearchTypes(query: string): Record<string, boolean> {
  const hasVote = VOTE_PATTERN.test(query);
  const hasDebate = DEBATE_PATTERN.test(query);
  const hasCommittee = COMMITTEE_PATTERN.test(query);
  const hasElection = ELECTION_PATTERN.test(query);
  const hasPolitician = POLITICIAN_PATTERN.test(query);
  const hasParty = PARTY_PATTERN.test(query);
  const hasBill = BILL_PATTERN.test(query);

  return {
    bills: hasBill,
    hansard: hasDebate,
    voteQuestions: hasVote,
    partyVotes: hasVote && hasParty,
    memberVotes: hasVote && hasPolitician,
    politicians: hasPolitician,
    committees: hasCommittee,
    committeeReports: hasCommittee,
    committeeMeetings: hasCommittee,
    parties: hasParty,
    elections: hasElection,
    candidacies: hasElection,
    sessions: false,
    ridings: hasElection,
  };
}

const createMockModel = (defaultResponse = "Hello, world!"): LanguageModel => {
  return {
    specificationVersion: "v2",
    provider: "mock",
    modelId: "mock-model-id",
    defaultObjectGenerationMode: "tool",
    supportedUrls: [],
    supportsImageUrls: false,
    supportsStructuredOutputs: false,
    doGenerate: (options: { prompt?: unknown }) => {
      // For language detection, analyze the prompt to determine response
      let text = defaultResponse;
      const prompt = extractPromptText(options.prompt);

      if (prompt.includes("Detect the language")) {
        // Extract the text being analyzed from the prompt
        const textMatch = prompt.match(TEXT_EXTRACT_PATTERN);
        const textToAnalyze = textMatch?.[1] || "";

        // Simple language detection for tests
        const hasFrenchIndicators =
          FRENCH_CHARS_PATTERN.test(textToAnalyze) ||
          FRENCH_WORDS_PATTERN.test(textToAnalyze);

        text = hasFrenchIndicators ? "french" : "english";
      }

      return Promise.resolve({
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        content: [{ type: "text", text }],
        warnings: [],
      });
    },
    doStream: (options: { prompt?: unknown }) => {
      const promptText = extractPromptText(options.prompt);
      const chunks = getCannedResponseChunks(promptText);

      return {
        stream: new ReadableStream({
          start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(chunk);
            }
            controller.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  } as unknown as LanguageModel;
};

/**
 * Detect language from text for mock model.
 * Returns structured output with language and confidence.
 */
function detectMockLanguage(text: string): {
  language: "en" | "fr";
  confidence: number;
} {
  const hasFrenchIndicators =
    FRENCH_CHARS_PATTERN.test(text) || FRENCH_WORDS_PATTERN.test(text);
  return {
    language: hasFrenchIndicators ? "fr" : "en",
    confidence: hasFrenchIndicators ? 0.95 : 0.9,
  };
}

/**
 * Create a unified small model that handles both language detection and intent detection.
 * Supports structured object generation for generateObject calls.
 */
const createSmallMockModel = (): LanguageModel => {
  return {
    specificationVersion: "v2",
    provider: "mock",
    modelId: "mock-small-model-id",
    defaultObjectGenerationMode: "json",
    supportedUrls: [],
    supportsImageUrls: false,
    supportsStructuredOutputs: true,
    doGenerate: (options: { prompt?: unknown }) => {
      const prompt = extractPromptText(options.prompt);

      // Handle language detection (structured output)
      if (prompt.includes("Detect the language")) {
        const textMatch = prompt.match(TEXT_EXTRACT_PATTERN);
        const textToAnalyze = textMatch?.[1] || "";
        const langResult = detectMockLanguage(textToAnalyze);

        return Promise.resolve({
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          content: [{ type: "text", text: JSON.stringify(langResult) }],
          warnings: [],
        });
      }

      // Handle intent detection (generateObject for search types)
      const queryMatch = prompt.match(QUERY_EXTRACT_PATTERN);
      const query = queryMatch?.[1] || prompt;
      const searchTypes = detectMockSearchTypes(query);

      return Promise.resolve({
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        content: [{ type: "text", text: JSON.stringify(searchTypes) }],
        warnings: [],
      });
    },
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "text-delta",
            id: "mock-id",
            delta: "{}",
          });
          controller.close();
        },
      }),
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  } as unknown as LanguageModel;
};

export const chatModel = createMockModel();
export const reasoningModel = createMockModel();
export const titleModel = createMockModel();
export const artifactModel = createMockModel();
export const analysisModel = createMockModel();
export const smallModel = createSmallMockModel();
export const smallModelStructured = createSmallMockModel();
