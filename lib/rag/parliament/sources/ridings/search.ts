import type { ResourceMetadata } from "@/lib/db/rag/schema";
import {
  executeVectorSearch,
  type SearchOptions,
  type SearchResult,
} from "@/lib/rag/parliament/search-utils";
import { formatRidingCitation, type RidingCitation } from "./citations";

/**
 * Riding-specific metadata fields
 */
export type RidingMetadata = ResourceMetadata & {
  sourceType: "riding";
  ridingId: number;
  ridingNameEn?: string;
  ridingNameFr?: string;
  province?: string;
};

/**
 * Riding search result with citation
 */
export type RidingSearchResult = SearchResult<RidingMetadata> & {
  citation: RidingCitation;
};

/**
 * Search ridings (electoral districts) using vector similarity
 */
export async function searchRidings(
  query: string,
  options: SearchOptions = {}
): Promise<RidingSearchResult[]> {
  const results = await executeVectorSearch<RidingMetadata>(
    query,
    "riding",
    options
  );

  return results.map((result) => ({
    ...result,
    citation: formatRidingCitation(result.metadata),
  }));
}
