/**
 * Declarative Intent Configuration
 *
 * Maps priority intent → search types + allowed citations.
 * This provides deterministic, predictable behavior:
 * - LLM only detects intent (what the user is asking about)
 * - Search types and citation types are derived from config
 * - No guessing, no slot allocation tricks needed
 */

import type { PriorityIntent } from "./query-analysis";
import type { SourceType } from "./search";

/**
 * Configuration for a specific intent
 */
export type IntentConfig = {
  /** Source types to search for this intent */
  searchTypes: SourceType[];
  /**
   * Citation types allowed in final results.
   * null = allow all types (for general queries)
   */
  allowedCitations: SourceType[] | null;
  /** Brief description for debugging/documentation */
  description: string;
};

/**
 * Intent configurations - defines exactly what each intent searches and returns
 *
 * Design principles:
 * - Be selective: only include what directly answers the question
 * - Avoid verbose sources (hansard) unless specifically needed
 * - Individual MP data (vote_member) only for vote/MP-specific queries
 * - Party-level data (vote_party) for general bill/vote context
 */
export const INTENT_CONFIG: Record<PriorityIntent, IntentConfig> = {
  /**
   * bill_focused: "Tell me about Bill C-35", "What is Bill C-11 about?"
   *
   * User wants:
   * - Bill content (summary, status, what it does)
   * - Final vote outcome (did it pass/fail)
   *
   * User does NOT want:
   * - Party vote breakdowns (use vote_focused for "How did X vote on...")
   * - Individual MP votes (too granular)
   * - Hansard debates (verbose)
   * - Every intermediate reading vote (just the key outcome)
   */
  bill_focused: {
    searchTypes: ["bill", "vote_question"],
    allowedCitations: ["bill", "vote_question"],
    description: "Bill content + vote outcome",
  },

  /**
   * vote_focused: "How did the NDP vote?", "Who voted against Bill C-11?"
   *
   * User wants:
   * - Vote question (overall result)
   * - Party votes (how each party voted)
   * - Member votes (individual MP votes - this IS what they're asking)
   * - Bill context (what the vote was about)
   *
   * User does NOT want:
   * - Hansard debates (not about what was said)
   * - Committee content
   */
  vote_focused: {
    searchTypes: ["vote_question", "vote_party", "vote_member", "bill"],
    allowedCitations: ["vote_question", "vote_party", "vote_member", "bill"],
    description: "Vote results + party/member breakdowns + bill context",
  },

  /**
   * mp_statement: "What did Trudeau say about climate?", "Pierre Poilievre on housing"
   *
   * User wants:
   * - Hansard (what they actually said in debates)
   * - Politician info (who they are, context)
   *
   * User does NOT want:
   * - Bill content (not asking about bills)
   * - Vote records (different from what they said)
   * - Committee content (House debates only)
   */
  mp_statement: {
    searchTypes: ["hansard", "politician"],
    allowedCitations: ["hansard", "politician"],
    description: "What MPs said in debates + who they are",
  },

  /**
   * mp_info: "Tell me about Jagmeet Singh", "Who is the MP for Toronto Centre?"
   *
   * User wants:
   * - Politician profile (bio, role, party, tenure)
   * - Riding info (if asking about constituency)
   * - Party info (context about their party)
   *
   * User does NOT want:
   * - Hansard (verbose quotes not needed for bio)
   * - Bills/votes (not asking about voting record)
   */
  mp_info: {
    searchTypes: ["politician", "riding", "party"],
    allowedCitations: ["politician", "riding", "party"],
    description: "MP biography + riding + party info",
  },

  /**
   * committee_focused: "What did the Finance Committee discuss?", "Health Committee reports"
   *
   * User wants:
   * - Committee info (mandate, members)
   * - Committee reports (findings, recommendations)
   * - Committee meetings (testimony, discussions)
   *
   * User does NOT want:
   * - Hansard (House debates, not committee)
   * - Individual votes
   * - General bill content (unless committee studied it)
   */
  committee_focused: {
    searchTypes: ["committee", "committee_report", "committee_meeting"],
    allowedCitations: ["committee", "committee_report", "committee_meeting"],
    description: "Committee work, reports, and meetings",
  },

  /**
   * general: Exploratory queries, mixed topics, unclear intent
   *
   * User might want anything - provide balanced mix.
   * No hard restrictions on citation types.
   */
  general: {
    searchTypes: [
      "bill",
      "hansard",
      "vote_question",
      "politician",
      "committee",
    ],
    allowedCitations: null, // Allow all - balanced/exploratory
    description: "Balanced mix for exploratory queries",
  },
};

/**
 * Get search types for a given intent
 */
export function getSearchTypesForIntent(intent: PriorityIntent): SourceType[] {
  return INTENT_CONFIG[intent].searchTypes;
}

/**
 * Get allowed citation types for a given intent
 * Returns null if all types are allowed
 */
export function getAllowedCitationsForIntent(
  intent: PriorityIntent
): SourceType[] | null {
  return INTENT_CONFIG[intent].allowedCitations;
}

/**
 * Filter results to only include allowed citation types for the intent
 */
export function filterByAllowedCitations<
  T extends { metadata?: { sourceType?: string } },
>(results: T[], intent: PriorityIntent): T[] {
  const allowed = INTENT_CONFIG[intent].allowedCitations;

  // null = allow all
  if (allowed === null) {
    return results;
  }

  const allowedSet = new Set(allowed);
  return results.filter((r) => {
    const sourceType = r.metadata?.sourceType;
    return sourceType && allowedSet.has(sourceType as SourceType);
  });
}
