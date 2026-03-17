import type { ResourceMetadata } from "@/lib/db/rag/schema";
import {
  executeVectorSearch,
  type SearchOptions,
  type SearchResult,
} from "@/lib/rag/parliament/search-utils";
import { formatHansardCitation, type HansardCitation } from "./citations";

/**
 * Hansard-specific metadata fields
 */
export type HansardMetadata = ResourceMetadata & {
  sourceType: "hansard";
  documentId?: number;
  statementId?: number;
  speakerNameEn?: string;
  speakerNameFr?: string;
  date?: string;
};

/**
 * Hansard search result with citation
 */
export type HansardSearchResult = SearchResult<HansardMetadata> & {
  citation: HansardCitation;
};

/**
 * Search Hansard statements using vector similarity
 *
 * Performs semantic search across parliamentary debate records (Hansard)
 * and returns results with similarity scores and citations.
 *
 * @param query - The search query text
 * @param options - Search options (limit, threshold, language)
 * @returns Array of search results with citations
 */
export async function searchHansard(
  query: string,
  options: SearchOptions = {}
): Promise<HansardSearchResult[]> {
  const results = await executeVectorSearch<HansardMetadata>(
    query,
    "hansard",
    options
  );

  // Add citations to results
  return results.map((result) => ({
    ...result,
    citation: formatHansardCitation(result.metadata),
  }));
}
