import type { ResourceMetadata } from "@/lib/db/rag/schema";
import { ragDebug } from "./debug";
import { detectSearchTypes, type SearchTypes } from "./query-analysis";
import type { SearchOptions } from "./search-utils";
import { type BillSearchResult, searchBills } from "./sources/bills/search";
import {
  type CommitteeMeetingSearchResult,
  type CommitteeReportSearchResult,
  type CommitteeSearchResult,
  searchCommitteeMeetings,
  searchCommitteeReports,
  searchCommittees,
} from "./sources/committees/search";
import {
  type CandidacySearchResult,
  type ElectionSearchResult,
  searchCandidacies,
  searchElections,
} from "./sources/elections/search";
import {
  type HansardSearchResult,
  searchHansard,
} from "./sources/hansard/search";
import {
  type PartySearchResult,
  searchParties,
} from "./sources/parties/search";
import {
  type PoliticianSearchResult,
  searchPoliticians,
} from "./sources/politicians/search";
import {
  type RidingSearchResult,
  searchRidings,
} from "./sources/ridings/search";
import {
  type SessionSearchResult,
  searchSessions,
} from "./sources/sessions/search";
import {
  type MemberVoteSearchResult,
  type PartyVoteSearchResult,
  searchMemberVotes,
  searchPartyVotes,
  searchVoteQuestions,
  type VoteQuestionSearchResult,
} from "./sources/votes/search";

const dbg = ragDebug("parl:search");

/**
 * All possible source types
 */
export type SourceType = ResourceMetadata["sourceType"];

/**
 * Union of all search result types
 */
export type ParliamentSearchResult =
  | BillSearchResult
  | HansardSearchResult
  | VoteQuestionSearchResult
  | PartyVoteSearchResult
  | MemberVoteSearchResult
  | PoliticianSearchResult
  | CommitteeSearchResult
  | CommitteeReportSearchResult
  | CommitteeMeetingSearchResult
  | PartySearchResult
  | ElectionSearchResult
  | CandidacySearchResult
  | SessionSearchResult
  | RidingSearchResult;

/**
 * Parliament search options
 */
export type SearchParliamentOptions = SearchOptions & {
  /** Override automatic type detection */
  sourceTypes?: SourceType[];
};

/**
 * Smart Parliament search that selects appropriate sources based on query intent
 *
 * Automatically detects whether the query is about:
 * - Votes (who voted how, vote results)
 * - Debates (what was said, speeches)
 * - Bills (bill content, status)
 * - Politicians (MP profiles, voting records)
 * - Committees (committee work, reports)
 * - Elections (election results, candidates)
 * - Sessions (parliamentary sessions)
 * - Ridings (electoral districts)
 *
 * @param query - The search query text
 * @param options - Search options
 * @returns Array of search results with citations, sorted by relevance
 */
export async function searchParliament(
  query: string,
  options: SearchParliamentOptions = {}
): Promise<ParliamentSearchResult[]> {
  const {
    limit = 10,
    similarityThreshold = 0.4,
    language,
    sourceTypes,
  } = options;

  const searchOptions: SearchOptions = { limit, similarityThreshold, language };

  // Use provided source types or detect from query using LLM
  const types: SearchTypes = sourceTypes
    ? {
        bills: sourceTypes.includes("bill"),
        hansard: sourceTypes.includes("hansard"),
        voteQuestions: sourceTypes.includes("vote_question"),
        partyVotes: sourceTypes.includes("vote_party"),
        memberVotes: sourceTypes.includes("vote_member"),
        politicians: sourceTypes.includes("politician"),
        committees: sourceTypes.includes("committee"),
        committeeReports: sourceTypes.includes("committee_report"),
        committeeMeetings: sourceTypes.includes("committee_meeting"),
        parties: sourceTypes.includes("party"),
        elections: sourceTypes.includes("election"),
        candidacies: sourceTypes.includes("candidacy"),
        sessions: sourceTypes.includes("session"),
        ridings: sourceTypes.includes("riding"),
      }
    : await detectSearchTypes(query);

  dbg("searchParliament types: %o", types);

  // Run appropriate searches in parallel
  const searches: Promise<ParliamentSearchResult[]>[] = [];

  if (types.bills) {
    searches.push(searchBills(query, searchOptions));
  }
  if (types.hansard) {
    searches.push(searchHansard(query, searchOptions));
  }
  if (types.voteQuestions) {
    searches.push(searchVoteQuestions(query, searchOptions));
  }
  if (types.partyVotes) {
    searches.push(searchPartyVotes(query, searchOptions));
  }
  if (types.memberVotes) {
    searches.push(searchMemberVotes(query, searchOptions));
  }
  if (types.politicians) {
    searches.push(searchPoliticians(query, searchOptions));
  }
  if (types.committees) {
    searches.push(searchCommittees(query, searchOptions));
  }
  if (types.committeeReports) {
    searches.push(searchCommitteeReports(query, searchOptions));
  }
  if (types.committeeMeetings) {
    searches.push(searchCommitteeMeetings(query, searchOptions));
  }
  if (types.parties) {
    searches.push(searchParties(query, searchOptions));
  }
  if (types.elections) {
    searches.push(searchElections(query, searchOptions));
  }
  if (types.candidacies) {
    searches.push(searchCandidacies(query, searchOptions));
  }
  if (types.sessions) {
    searches.push(searchSessions(query, searchOptions));
  }
  if (types.ridings) {
    searches.push(searchRidings(query, searchOptions));
  }

  // If no types selected, return empty results (no default to bills)
  if (searches.length === 0) {
    dbg("searchParliament: no search types detected, returning empty results");
    return [];
  }

  const allResults = await Promise.all(searches);

  // Flatten and sort by similarity
  const combined = allResults
    .flat()
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  dbg(
    "searchParliament: %d results from %d sources",
    combined.length,
    searches.length
  );

  return combined;
}
