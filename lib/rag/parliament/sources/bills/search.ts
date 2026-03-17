import { sql } from "drizzle-orm";
import type { ResourceMetadata } from "@/lib/db/rag/schema";
import { parlResources } from "@/lib/db/rag/schema";
import {
  executeVectorSearch,
  extractBillNumber,
  type SearchOptions,
  type SearchResult,
} from "@/lib/rag/parliament/search-utils";
import { type BillCitation, formatBillCitation } from "./citations";

/**
 * Bill-specific metadata fields
 */
export type BillMetadata = ResourceMetadata & {
  sourceType: "bill";
  billNumber: string;
  sessionId: string;
  billTitle?: string;
};

/**
 * Bill search result with citation
 */
export type BillSearchResult = SearchResult<BillMetadata> & {
  citation: BillCitation;
};

/**
 * Search bills using vector similarity
 *
 * Performs semantic search across bill content and returns results with
 * similarity scores and properly formatted citations.
 *
 * Special handling: If query contains a specific bill number (e.g., "Bill C-11"),
 * filters results to only that bill to provide exact matches.
 *
 * @param query - The search query text
 * @param options - Search options (limit, threshold, language)
 * @returns Array of search results with citations
 */
export async function searchBills(
  query: string,
  options: SearchOptions = {}
): Promise<BillSearchResult[]> {
  // Check if query contains a specific bill number
  const billNumber = extractBillNumber(query);

  // For exact bill-number queries, apply a stricter similarity cutoff
  const strictCutoff = 0.5;
  const effectiveThreshold = billNumber
    ? Math.max(options.similarityThreshold ?? 0.4, strictCutoff)
    : options.similarityThreshold;

  // Build additional where clause for bill number filtering
  const additionalWhere = billNumber
    ? sql`${parlResources.metadata}->>'billNumber' = ${billNumber}`
    : undefined;

  const results = await executeVectorSearch<BillMetadata>(query, "bill", {
    ...options,
    similarityThreshold: effectiveThreshold,
    additionalWhere,
    cacheKeyExtras: { billNumber: billNumber ?? undefined },
  });

  // Add citations to results
  return results.map((result) => ({
    ...result,
    citation: formatBillCitation(result.metadata),
  }));
}
