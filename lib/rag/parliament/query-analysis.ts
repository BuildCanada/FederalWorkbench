import { generateObject } from "ai";
import { z } from "zod";
import { myProvider } from "@/lib/ai/providers";
import { ENABLED_SOURCES } from "./constants";
import { ragDebug } from "./debug";
import { getSearchTypesForIntent } from "./intent-config";
import type { SourceType } from "./search";

const dbg = ragDebug("parl:query");

/**
 * Search types that can be enabled based on query intent
 */
export type SearchTypes = {
  bills: boolean;
  hansard: boolean;
  voteQuestions: boolean;
  partyVotes: boolean;
  memberVotes: boolean;
  politicians: boolean;
  committees: boolean;
  committeeReports: boolean;
  committeeMeetings: boolean;
  parties: boolean;
  elections: boolean;
  candidacies: boolean;
  sessions: boolean;
  ridings: boolean;
};

/** All search types set to false */
const EMPTY_TYPES: SearchTypes = {
  bills: false,
  hansard: false,
  voteQuestions: false,
  partyVotes: false,
  memberVotes: false,
  politicians: false,
  committees: false,
  committeeReports: false,
  committeeMeetings: false,
  parties: false,
  elections: false,
  candidacies: false,
  sessions: false,
  ridings: false,
};

/** Set of enabled sources for O(1) lookup */
const enabledSet = new Set(ENABLED_SOURCES);

/**
 * Filter search types to only include enabled sources.
 * Disabled sources are masked out regardless of LLM detection.
 */
function filterEnabledTypes(types: SearchTypes): SearchTypes {
  const filtered = { ...types };
  for (const key of Object.keys(filtered) as (keyof SearchTypes)[]) {
    if (!enabledSet.has(key)) {
      filtered[key] = false;
    }
  }
  return filtered;
}

/**
 * Map from SourceType to SearchTypes key
 */
const SOURCE_TYPE_TO_SEARCH_KEY: Record<SourceType, keyof SearchTypes> = {
  bill: "bills",
  hansard: "hansard",
  vote_question: "voteQuestions",
  vote_party: "partyVotes",
  vote_member: "memberVotes",
  politician: "politicians",
  committee: "committees",
  committee_report: "committeeReports",
  committee_meeting: "committeeMeetings",
  party: "parties",
  election: "elections",
  candidacy: "candidacies",
  session: "sessions",
  riding: "ridings",
};

/**
 * Convert array of SourceType to SearchTypes boolean object.
 * Used to derive search types from intent config.
 */
function sourceTypesToSearchTypes(sourceTypes: SourceType[]): SearchTypes {
  const types = { ...EMPTY_TYPES };
  for (const sourceType of sourceTypes) {
    const key = SOURCE_TYPE_TO_SEARCH_KEY[sourceType];
    if (key) {
      types[key] = true;
    }
  }
  return filterEnabledTypes(types);
}

/**
 * Priority intent for citation slot allocation.
 * Determines which source types should appear first in citations.
 */
export type PriorityIntent =
  | "bill_focused" // Query is primarily about a specific bill
  | "vote_focused" // Query is about how entities voted
  | "mp_statement" // Query is about what someone said
  | "mp_info" // Query is about who someone is (biography, riding, party)
  | "committee_focused" // Query is about committee work
  | "general"; // Balanced/exploratory query

/**
 * Unified schema for LLM-based query analysis.
 *
 * NOTE: Search types are NOT included here - they are derived deterministically
 * from the priorityIntent using INTENT_CONFIG. This makes behavior predictable
 * and reduces LLM decision-making to just intent classification.
 */
const UnifiedQueryAnalysisSchema = z.object({
  // Language detection
  language: z
    .enum(["en", "fr"])
    .describe("The language of the query - English or French"),

  // Priority intent - THIS is the key decision the LLM makes
  // Everything else (search types, citation types) derives from this
  priorityIntent: z
    .enum([
      "bill_focused",
      "vote_focused",
      "mp_statement",
      "mp_info",
      "committee_focused",
      "general",
    ])
    .describe("The primary focus of the query"),

  // Query reformulations for search coverage
  reformulations: z
    .array(z.string())
    .min(2)
    .max(2)
    .describe("Two alternative phrasings of the query for search"),

  // Enumeration detection (for complete list queries)
  enumeration: z.object({
    isEnumeration: z
      .boolean()
      .describe("True if user wants a complete list of items"),
    type: z
      .enum(["vote", "politician", "committee", "none"])
      .describe("Type of enumeration requested"),
    billNumber: z
      .string()
      .nullable()
      .describe("Bill number if query is about a specific bill (e.g., C-35)"),
    parliamentNumber: z
      .number()
      .nullable()
      .describe("Parliament number (e.g., 44 for 44th Parliament)"),
    sessionNumber: z
      .number()
      .nullable()
      .describe(
        "Session number within the parliament (e.g., 1 for 1st Session)"
      ),
    partySlug: z
      .enum([
        "liberal",
        "conservative",
        "ndp",
        "bq",
        "green",
        "independent",
        "",
      ])
      .describe("Party abbreviation if filtering by party"),
    voteType: z
      .enum(["Y", "N", "A", "P", ""])
      .describe("Vote type filter: Y=yea, N=nay, A=abstain, P=paired"),
  }),
});

export const QueryAnalysisSchema = z.object({
  intent: z
    .enum(["factual", "comparison", "explanation", "procedural", "general"])
    .default("general"),
  entities: z.object({
    billNumbers: z.array(z.string()).optional(),
    politicians: z.array(z.string()).optional(),
    committees: z.array(z.string()).optional(),
    dates: z.array(z.string()).optional(),
    topics: z.array(z.string()).optional(),
  }),
  searchStrategy: z.enum(["exact", "semantic", "hybrid"]).default("hybrid"),
  reformulatedQueries: z.array(z.string()).min(1).max(3),
});

/**
 * Language detection result with confidence score
 */
export type LanguageDetection = {
  language: "en" | "fr";
  confidence: number;
};

/**
 * Enumeration intent info - when user wants a complete list
 */
export type EnumerationIntent = {
  isEnumeration: boolean;
  type?: "vote" | "politician" | "committee";
  billNumber?: string;
  parliamentNumber?: number;
  sessionNumber?: number;
  partySlug?: string;
  voteType?: "Y" | "N" | "A" | "P";
};

export type QueryAnalysis = z.infer<typeof QueryAnalysisSchema> & {
  originalQuery: string;
  language: "en" | "fr";
  languageConfidence: number;
  priorityIntent: PriorityIntent;
  searchTypes: SearchTypes;
  enumeration: EnumerationIntent;
};

const BILL_NUMBER_PATTERN = /\b([CS]-\d+)\b/i;

// French language detection patterns (moved to top level for performance)
const FRENCH_WORD_PATTERN =
  /\b(le|la|les|de|du|des|un|une|que|qui|est|sont|pour|dans|avec|sur|par|ce|cette|ces|au|aux|en|et|ou|mais|donc|projet de loi|parlement|député|gouvernement|ministre)\b/gi;
const FRENCH_ACCENT_PATTERN = /[àâäéèêëïîôùûüÿœæç]/i;

/**
 * Unified prompt for query analysis.
 *
 * The LLM's main job is to classify the INTENT. Search types and citation
 * types are derived deterministically from the intent using INTENT_CONFIG.
 */
function unifiedAnalysisPrompt(query: string): string {
  return `Analyze this Canadian Parliament query.

Query: "${query}"

Determine:

1. LANGUAGE: Is this English (en) or French (fr)?

2. PRIORITY INTENT: What is the user primarily asking about?
   - bill_focused: About a specific bill - what it does, its status, if it passed
     Examples: "Tell me about Bill C-35", "What is Bill C-11?", "Did Bill C-18 pass?"
   - vote_focused: About how someone/something voted
     Examples: "How did the NDP vote on X?", "Who voted against Bill C-35?", "What was the vote count?"
   - mp_statement: About what someone SAID in Parliament
     Examples: "What did Trudeau say about climate?", "Pierre Poilievre's speech on housing"
   - mp_info: About WHO someone is (biography, not their statements)
     Examples: "Tell me about Jagmeet Singh", "Who is the MP for Toronto Centre?", "NDP leader"
   - committee_focused: About committee work, reports, meetings
     Examples: "Finance Committee discussions", "Health Committee report on X"
   - general: Exploratory/mixed - doesn't fit above categories

3. REFORMULATIONS: Generate 2 alternative phrasings (same language) to improve search.

4. ENUMERATION: Is user asking for a COMPLETE LIST?
   - "How did each MP vote on Bill C-35?" → isEnumeration: true, type: "vote", billNumber: "C-35"
   - "List all NDP MPs" → isEnumeration: true, type: "politician", partySlug: "ndp"
   - Most queries are NOT enumerations. Only true when user explicitly wants ALL items.`;
}

function extractBillNumbers(query: string): string[] {
  const m = query.match(BILL_NUMBER_PATTERN);
  return m ? [m[1].toUpperCase()] : [];
}

/**
 * Quick language detection using simple heuristics.
 * For more accurate detection, use the unified analyzeQuery().
 *
 * @param text - Text to analyze for language
 * @returns Language detection result with confidence score (0-1)
 */
export function detectLanguage(text: string): LanguageDetection {
  if (!text?.trim()) {
    return { language: "en", confidence: 0 };
  }

  // Simple heuristic: check for common French words/patterns
  const frenchCount = (text.match(FRENCH_WORD_PATTERN) || []).length;

  // Check for French accents
  const hasAccents = FRENCH_ACCENT_PATTERN.test(text);

  if (frenchCount >= 2 || (frenchCount >= 1 && hasAccents)) {
    dbg("Language detected: fr (heuristic) for text: %s", text.slice(0, 50));
    return { language: "fr", confidence: 0.8 };
  }

  dbg("Language detected: en (default) for text: %s", text.slice(0, 50));
  return { language: "en", confidence: 0.7 };
}

/**
 * Schema for standalone search type detection (backward compatibility)
 */
const SearchTypesSchema = z.object({
  bills: z.boolean().describe("Query is about legislation, bills, or laws"),
  hansard: z
    .boolean()
    .describe("Query is about parliamentary debates or speeches"),
  voteQuestions: z.boolean().describe("Query is about vote results"),
  partyVotes: z.boolean().describe("Query is about how parties voted"),
  memberVotes: z.boolean().describe("Query is about how individual MPs voted"),
  politicians: z.boolean().describe("Query is about specific MPs or ministers"),
  committees: z.boolean().describe("Query is about parliamentary committees"),
  committeeReports: z.boolean().describe("Query is about committee reports"),
  committeeMeetings: z.boolean().describe("Query is about committee meetings"),
  parties: z.boolean().describe("Query is about political parties"),
  elections: z.boolean().describe("Query is about elections"),
  candidacies: z.boolean().describe("Query is about candidates"),
  sessions: z.boolean().describe("Query is about parliamentary sessions"),
  ridings: z.boolean().describe("Query is about electoral districts"),
});

/**
 * Detect which search types are relevant using LLM-based classification.
 * Standalone function for backward compatibility with search.ts.
 *
 * @param query - The user's search query
 * @returns SearchTypes object with boolean flags for each source type
 */
export async function detectSearchTypes(query: string): Promise<SearchTypes> {
  if (!query?.trim()) {
    return { ...EMPTY_TYPES };
  }

  try {
    const model = myProvider.languageModel("small-model-structured");
    const { object } = await generateObject({
      model,
      schema: SearchTypesSchema,
      prompt: `Analyze this Canadian Parliament query and determine which data sources are relevant.
Set each source type to true if the query relates to that type of information.
A query can match multiple source types.

Query: "${query}"`,
    });

    dbg("Search types detected: %o for query: %s", object, query.slice(0, 50));

    const filtered = filterEnabledTypes(object);
    const hasAnyType = Object.values(filtered).some(Boolean);
    if (!hasAnyType) {
      dbg("No enabled sources matched for query");
      return { ...EMPTY_TYPES };
    }

    return filtered;
  } catch (err) {
    dbg("Search type detection failed: %O", err);
    return { ...EMPTY_TYPES };
  }
}

/**
 * Generate query reformulations using LLM.
 * Standalone function for backward compatibility.
 *
 * @param query - The original search query
 * @param language - The detected language of the query
 * @returns Array of reformulated queries
 */
export async function generateQueryReformulations(
  query: string,
  language: "en" | "fr"
): Promise<string[]> {
  if (!query?.trim()) {
    return [];
  }

  try {
    const model = myProvider.languageModel("small-model-structured");
    const { object } = await generateObject({
      model,
      schema: z.object({
        queries: z
          .array(z.string())
          .min(2)
          .max(3)
          .describe("Alternative search query variations"),
      }),
      prompt: `Generate 2-3 alternative search queries for the following Canadian Parliament query.
Each variation should use synonyms and different phrasings.
Be in ${language === "fr" ? "French" : "English"} (same as original).

Original query: "${query}"`,
    });

    dbg("Query reformulations: %o", object.queries);
    return object.queries;
  } catch (err) {
    dbg("Query reformulation failed, using fallback: %O", err);
    return fallbackReformulations(query, language);
  }
}

/**
 * Fallback reformulations when LLM is unavailable
 */
function fallbackReformulations(
  query: string,
  lang: "en" | "fr" | "unknown"
): string[] {
  const bills = extractBillNumbers(query);
  if (bills.length > 0) {
    const bill = bills[0];
    return lang === "fr"
      ? [
          `Résumé du projet de loi ${bill}`,
          `Contexte et statut du projet de loi ${bill}`,
        ]
      : [`Summary of Bill ${bill}`, `Context and status of Bill ${bill}`];
  }
  return lang === "fr"
    ? ["Contexte parlementaire lié", "Informations officielles pertinentes"]
    : ["Related parliamentary context", "Relevant official information"];
}

/**
 * Analyze a user query using a single unified LLM call.
 *
 * Consolidates language detection, priority intent, search types,
 * reformulations, and enumeration detection into one structured call.
 * This reduces latency compared to multiple separate LLM calls.
 *
 * @param query - The user's search query
 * @returns Complete query analysis including priority intent for citation allocation
 */
export async function analyzeQuery(query: string): Promise<QueryAnalysis> {
  const billNumbers = extractBillNumbers(query);

  if (!query?.trim()) {
    return {
      intent: "general",
      entities: {
        billNumbers: [],
        politicians: [],
        committees: [],
        dates: [],
        topics: [],
      },
      searchStrategy: "hybrid",
      reformulatedQueries: [],
      originalQuery: query,
      language: "en",
      languageConfidence: 0,
      priorityIntent: "general",
      searchTypes: { ...EMPTY_TYPES },
      enumeration: { isEnumeration: false },
    };
  }

  try {
    // Use medium model for better search type detection
    const model = myProvider.languageModel("medium-model");
    const { object } = await generateObject({
      model,
      schema: UnifiedQueryAnalysisSchema,
      prompt: unifiedAnalysisPrompt(query),
    });

    dbg(
      "Unified analysis: lang=%s, intent=%s, enum=%s for query: %s",
      object.language,
      object.priorityIntent,
      object.enumeration.isEnumeration,
      query.slice(0, 50)
    );

    // Derive search types deterministically from intent
    // This is the key change: intent → searchTypes (not LLM-picked)
    const intentSourceTypes = getSearchTypesForIntent(object.priorityIntent);
    const searchTypes = sourceTypesToSearchTypes(intentSourceTypes);

    dbg(
      "Derived search types from intent=%s: %o",
      object.priorityIntent,
      intentSourceTypes
    );

    // Build enumeration result
    const enumeration: EnumerationIntent =
      object.enumeration.isEnumeration && object.enumeration.type !== "none"
        ? {
            isEnumeration: true,
            type: object.enumeration.type as
              | "vote"
              | "politician"
              | "committee",
            billNumber: object.enumeration.billNumber || undefined,
            parliamentNumber: object.enumeration.parliamentNumber || undefined,
            sessionNumber: object.enumeration.sessionNumber || undefined,
            partySlug: object.enumeration.partySlug || undefined,
            voteType:
              (object.enumeration.voteType as "Y" | "N" | "A" | "P") ||
              undefined,
          }
        : { isEnumeration: false };

    if (enumeration.isEnumeration) {
      dbg(
        "Enumeration intent detected: type=%s, bill=%s, parliament=%s, session=%s, party=%s, voteType=%s",
        enumeration.type,
        enumeration.billNumber,
        enumeration.parliamentNumber,
        enumeration.sessionNumber,
        enumeration.partySlug,
        enumeration.voteType
      );
    }

    return {
      intent: "general",
      entities: {
        billNumbers,
        politicians: [],
        committees: [],
        dates: [],
        topics: [],
      },
      searchStrategy: "hybrid",
      reformulatedQueries: object.reformulations,
      originalQuery: query,
      language: object.language,
      languageConfidence: 0.95, // LLM is more reliable than franc
      priorityIntent: object.priorityIntent,
      searchTypes,
      enumeration,
    };
  } catch (err) {
    dbg("Unified query analysis failed, using fallback: %O", err);

    // Fallback with default values - use general intent's search types
    const fallbackSourceTypes = getSearchTypesForIntent("general");
    const langDetection = detectLanguage(query);
    return {
      intent: "general",
      entities: {
        billNumbers,
        politicians: [],
        committees: [],
        dates: [],
        topics: [],
      },
      searchStrategy: "hybrid",
      reformulatedQueries: fallbackReformulations(
        query,
        langDetection.language
      ),
      originalQuery: query,
      language: langDetection.language,
      languageConfidence: langDetection.confidence,
      priorityIntent: "general",
      searchTypes: sourceTypesToSearchTypes(fallbackSourceTypes),
      enumeration: { isEnumeration: false },
    };
  }
}
