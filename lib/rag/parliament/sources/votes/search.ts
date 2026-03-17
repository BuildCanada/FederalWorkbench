import { sql } from "drizzle-orm";
import type { ResourceMetadata } from "@/lib/db/rag/schema";
import { parlResources } from "@/lib/db/rag/schema";
import {
  executeVectorSearch,
  extractBillNumber,
  type SearchOptions,
  type SearchResult,
} from "@/lib/rag/parliament/search-utils";
import {
  formatMemberVoteCitation,
  formatPartyVoteCitation,
  formatVoteQuestionCitation,
  type MemberVoteCitation,
  type PartyVoteCitation,
  type VoteQuestionCitation,
} from "./citations";

/**
 * Vote question metadata fields
 */
export type VoteQuestionMetadata = ResourceMetadata & {
  sourceType: "vote_question";
  voteQuestionId: number;
  billNumber?: string;
  result: string;
  date?: string;
};

/**
 * Party vote metadata fields
 */
export type PartyVoteMetadata = ResourceMetadata & {
  sourceType: "vote_party";
  voteQuestionId: number;
  partyId: number;
  partyNameEn?: string;
  partyNameFr?: string;
  result: string;
  date?: string;
};

/**
 * Member vote metadata fields
 */
export type MemberVoteMetadata = ResourceMetadata & {
  sourceType: "vote_member";
  voteQuestionId: number;
  politicianId: number;
  politicianName?: string;
  result: string;
  date?: string;
};

/**
 * Vote question search result with citation
 */
export type VoteQuestionSearchResult = SearchResult<VoteQuestionMetadata> & {
  citation: VoteQuestionCitation;
};

/**
 * Party vote search result with citation
 */
export type PartyVoteSearchResult = SearchResult<PartyVoteMetadata> & {
  citation: PartyVoteCitation;
};

/**
 * Member vote search result with citation
 */
export type MemberVoteSearchResult = SearchResult<MemberVoteMetadata> & {
  citation: MemberVoteCitation;
};

/**
 * Search vote questions using vector similarity
 *
 * @param query - The search query text
 * @param options - Search options (limit, threshold, language)
 * @returns Array of search results with citations
 */
export async function searchVoteQuestions(
  query: string,
  options: SearchOptions = {}
): Promise<VoteQuestionSearchResult[]> {
  // Check if query contains a specific bill number
  const billNumber = extractBillNumber(query);

  // Build additional where clause for bill number filtering
  const additionalWhere = billNumber
    ? sql`${parlResources.metadata}->>'billNumber' = ${billNumber}`
    : undefined;

  const results = await executeVectorSearch<VoteQuestionMetadata>(
    query,
    "vote_question",
    {
      ...options,
      additionalWhere,
      cacheKeyExtras: { billNumber: billNumber ?? undefined },
    }
  );

  return results.map((result) => ({
    ...result,
    citation: formatVoteQuestionCitation(result.metadata),
  }));
}

/**
 * Search party votes using vector similarity
 *
 * @param query - The search query text
 * @param options - Search options (limit, threshold, language)
 * @returns Array of search results with citations
 */
export async function searchPartyVotes(
  query: string,
  options: SearchOptions = {}
): Promise<PartyVoteSearchResult[]> {
  const results = await executeVectorSearch<PartyVoteMetadata>(
    query,
    "vote_party",
    options
  );

  return results.map((result) => ({
    ...result,
    citation: formatPartyVoteCitation(result.metadata),
  }));
}

/**
 * Search member votes using vector similarity
 *
 * @param query - The search query text
 * @param options - Search options (limit, threshold, language)
 * @returns Array of search results with citations
 */
export async function searchMemberVotes(
  query: string,
  options: SearchOptions = {}
): Promise<MemberVoteSearchResult[]> {
  const results = await executeVectorSearch<MemberVoteMetadata>(
    query,
    "vote_member",
    options
  );

  return results.map((result) => ({
    ...result,
    citation: formatMemberVoteCitation(result.metadata),
  }));
}
