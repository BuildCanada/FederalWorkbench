import type { QueryAnalysis } from "@/lib/rag/parliament/query-analysis";
import { deduplicateAndRerank } from "@/lib/rag/parliament/reranking";
import {
  type ParliamentSearchResult,
  type SourceType,
  searchParliament,
} from "@/lib/rag/parliament/search";

/**
 * Convert SearchTypes boolean flags to SourceType[] array
 */
const SOURCE_TYPE_MAP: Record<string, SourceType> = {
  bills: "bill",
  hansard: "hansard",
  voteQuestions: "vote_question",
  partyVotes: "vote_party",
  memberVotes: "vote_member",
  politicians: "politician",
  committees: "committee",
  committeeReports: "committee_report",
  committeeMeetings: "committee_meeting",
  parties: "party",
  elections: "election",
  candidacies: "candidacy",
  sessions: "session",
  ridings: "riding",
};

function searchTypesToSourceTypes(
  searchTypes: QueryAnalysis["searchTypes"]
): SourceType[] {
  return Object.entries(searchTypes)
    .filter(([, enabled]) => enabled)
    .map(([key]) => SOURCE_TYPE_MAP[key])
    .filter(Boolean);
}

/**
 * Perform multi-query search using the original query and its reformulations.
 *
 * Searches all relevant source types (bills, hansard, votes, committees, etc.)
 * based on the detected search types in the analysis. Uses LLM-generated
 * query reformulations and cross-encoder reranking for better relevance.
 *
 * @param analysis - Query analysis with detected search types and reformulations
 * @param limit - Maximum results to return after reranking
 * @param candidatesPerQuery - Candidates to fetch per query variation (default: 20)
 */
export async function multiQuerySearch(
  analysis: QueryAnalysis,
  limit = 10,
  candidatesPerQuery = 20
): Promise<ParliamentSearchResult[]> {
  const queries = [analysis.originalQuery, ...analysis.reformulatedQueries];

  // If a bill number was detected, ensure we search for bill sources too
  // This guarantees bill content is available for hydration even when the
  // query is about votes, hansard, etc. related to that bill
  const effectiveSearchTypes = { ...analysis.searchTypes };
  if (
    analysis.entities.billNumbers &&
    analysis.entities.billNumbers.length > 0
  ) {
    effectiveSearchTypes.bills = true;
  }

  const sourceTypes = searchTypesToSourceTypes(effectiveSearchTypes);

  // Search all relevant source types with each query variation in parallel
  const sets = await Promise.all(
    queries.map((q) =>
      searchParliament(q, {
        limit: candidatesPerQuery,
        language: analysis.language,
        sourceTypes, // Pass source types to avoid duplicate LLM calls
      })
    )
  );

  return (await deduplicateAndRerank(
    sets.flat(),
    limit,
    analysis
  )) as ParliamentSearchResult[];
}
