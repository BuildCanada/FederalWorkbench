/**
 * Parliament RAG System Constants
 *
 * Parliament-specific configuration for the RAG (Retrieval-Augmented Generation) system.
 * Shared constants (CACHE_TTL, SEARCH_LIMITS, RERANKER_CONFIG, HYBRID_SEARCH_CONFIG,
 * isRagCacheDisabled) are in lib/rag/shared/constants.ts.
 */

/**
 * Source types that can be searched.
 * Comment out sources to disable them during development/testing.
 */
export const ENABLED_SOURCES = [
  "bills",
  "hansard",
  "voteQuestions",
  "partyVotes",
  "memberVotes",
  "politicians",
  "committees",
  "committeeReports",
  "committeeMeetings",
  "parties",
  "elections",
  "candidacies",
  "sessions",
  "ridings",
] as const;

export type EnabledSource = (typeof ENABLED_SOURCES)[number];

/**
 * Display limits for hydrated content (parliament-specific)
 */
export const DISPLAY_LIMITS = {
  /** Maximum previous MPs to show for a riding */
  PREVIOUS_MPS: 5,

  /** Maximum speeches to show in Hansard context */
  SPEECHES: 10,

  /** Maximum party votes to show */
  PARTY_VOTES: 5,

  /** Maximum report/meeting items to show */
  COMMITTEE_ITEMS: 10,
} as const;

/**
 * Adaptive filtering configuration (parliament-specific)
 *
 * Instead of fixed thresholds, use relative filtering based on top scores.
 * This handles queries that naturally produce lower similarity scores.
 */
export const ADAPTIVE_FILTER_CONFIG = {
  /**
   * Keep results within this ratio of the top score.
   * E.g., 0.7 means keep results with scores >= 70% of the top score.
   */
  RELATIVE_THRESHOLD_RATIO: 0.7,

  /**
   * Absolute minimum score floor (0-1 scale).
   * Even with relative filtering, never include results below this score.
   */
  ABSOLUTE_MINIMUM_SCORE: 0.05,

  /**
   * Minimum number of results to return, even if below threshold.
   * Ensures we always have some context for the LLM.
   */
  MINIMUM_RESULTS: 3,
} as const;
