import type { ResourceMetadata } from "@/lib/db/rag/schema";
import {
  executeVectorSearch,
  type SearchOptions,
  type SearchResult,
} from "@/lib/rag/parliament/search-utils";
import { formatPartyCitation, type PartyCitation } from "./citations";

/**
 * Party-specific metadata fields
 */
export type PartyMetadata = ResourceMetadata & {
  sourceType: "party";
  partyId: number;
  partyNameEn?: string;
  partyNameFr?: string;
  partyShortEn?: string;
  partyShortFr?: string;
};

/**
 * Party search result with citation
 */
export type PartySearchResult = SearchResult<PartyMetadata> & {
  citation: PartyCitation;
};

/**
 * Search political parties using vector similarity
 */
export async function searchParties(
  query: string,
  options: SearchOptions = {}
): Promise<PartySearchResult[]> {
  const results = await executeVectorSearch<PartyMetadata>(
    query,
    "party",
    options
  );

  return results.map((result) => ({
    ...result,
    citation: formatPartyCitation(result.metadata),
  }));
}
