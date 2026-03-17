import type { ResourceMetadata } from "@/lib/db/rag/schema";
import {
  executeVectorSearch,
  type SearchOptions,
  type SearchResult,
} from "@/lib/rag/parliament/search-utils";
import { formatPoliticianCitation, type PoliticianCitation } from "./citations";

/**
 * Politician-specific metadata fields
 */
export type PoliticianMetadata = ResourceMetadata & {
  sourceType: "politician";
  politicianId: number;
  politicianName?: string;
  politicianSlug?: string;
  partyId?: number;
  partyNameEn?: string;
  partyNameFr?: string;
  ridingId?: number;
  ridingNameEn?: string;
  ridingNameFr?: string;
};

/**
 * Politician search result with citation
 */
export type PoliticianSearchResult = SearchResult<PoliticianMetadata> & {
  citation: PoliticianCitation;
};

/**
 * Search politicians using vector similarity
 *
 * Performs semantic search across politician profiles and returns results
 * with similarity scores and citations.
 *
 * @param query - The search query text
 * @param options - Search options (limit, threshold, language)
 * @returns Array of search results with citations
 */
export async function searchPoliticians(
  query: string,
  options: SearchOptions = {}
): Promise<PoliticianSearchResult[]> {
  const results = await executeVectorSearch<PoliticianMetadata>(
    query,
    "politician",
    options
  );

  return results.map((result) => ({
    ...result,
    citation: formatPoliticianCitation(result.metadata),
  }));
}
