import type { ResourceMetadata } from "@/lib/db/rag/schema";
import {
  executeVectorSearch,
  type SearchOptions,
  type SearchResult,
} from "@/lib/rag/parliament/search-utils";
import { formatSessionCitation, type SessionCitation } from "./citations";

/**
 * Session-specific metadata fields
 */
export type SessionMetadata = ResourceMetadata & {
  sourceType: "session";
  sessionId: string;
  sessionName?: string;
  parliamentnum?: number;
  sessnum?: number;
};

/**
 * Session search result with citation
 */
export type SessionSearchResult = SearchResult<SessionMetadata> & {
  citation: SessionCitation;
};

/**
 * Search parliamentary sessions using vector similarity
 */
export async function searchSessions(
  query: string,
  options: SearchOptions = {}
): Promise<SessionSearchResult[]> {
  const results = await executeVectorSearch<SessionMetadata>(
    query,
    "session",
    options
  );

  return results.map((result) => ({
    ...result,
    citation: formatSessionCitation(result.metadata),
  }));
}
