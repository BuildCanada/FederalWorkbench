import type { ResourceMetadata } from "@/lib/db/rag/schema";
import {
  executeVectorSearch,
  type SearchOptions,
  type SearchResult,
} from "@/lib/rag/parliament/search-utils";
import {
  type CandidacyCitation,
  type ElectionCitation,
  formatCandidacyCitation,
  formatElectionCitation,
} from "./citations";

/**
 * Election-specific metadata fields
 */
export type ElectionMetadata = ResourceMetadata & {
  sourceType: "election";
  electionId: number;
  date?: string;
  nameEn?: string;
  nameFr?: string;
};

/**
 * Candidacy-specific metadata fields
 */
export type CandidacyMetadata = ResourceMetadata & {
  sourceType: "candidacy";
  candidacyId: number;
  electionId?: number;
  politicianId?: number;
  politicianName?: string;
  ridingId?: number;
  ridingNameEn?: string;
  ridingNameFr?: string;
  result?: string; // elected, defeated
};

/**
 * Election search result with citation
 */
export type ElectionSearchResult = SearchResult<ElectionMetadata> & {
  citation: ElectionCitation;
};

/**
 * Candidacy search result with citation
 */
export type CandidacySearchResult = SearchResult<CandidacyMetadata> & {
  citation: CandidacyCitation;
};

/**
 * Search elections using vector similarity
 */
export async function searchElections(
  query: string,
  options: SearchOptions = {}
): Promise<ElectionSearchResult[]> {
  const results = await executeVectorSearch<ElectionMetadata>(
    query,
    "election",
    options
  );

  return results.map((result) => ({
    ...result,
    citation: formatElectionCitation(result.metadata),
  }));
}

/**
 * Search candidacies using vector similarity
 */
export async function searchCandidacies(
  query: string,
  options: SearchOptions = {}
): Promise<CandidacySearchResult[]> {
  const results = await executeVectorSearch<CandidacyMetadata>(
    query,
    "candidacy",
    options
  );

  return results.map((result) => ({
    ...result,
    citation: formatCandidacyCitation(result.metadata),
  }));
}
