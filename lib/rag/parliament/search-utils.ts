import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { generateEmbedding } from "@/lib/ai/embeddings";
import { cacheGet, cacheSet } from "@/lib/cache/redis";
import { getDb } from "@/lib/db/connection";
import type { ResourceMetadata } from "@/lib/db/rag/schema";
import { parlEmbeddings, parlResources } from "@/lib/db/rag/schema";
import {
  CACHE_TTL,
  HYBRID_SEARCH_CONFIG,
  isRagCacheDisabled,
  SEARCH_LIMITS,
} from "@/lib/rag/shared/constants";
import { ragDebug } from "./debug";

const dbg = ragDebug("parl:search-utils");

/**
 * Search result with content, metadata, similarity score, and citation info
 */
export type SearchResult<T = ResourceMetadata> = {
  content: string;
  metadata: T;
  similarity: number;
};

/**
 * Standard search options shared across all source types
 */
export type SearchOptions = {
  limit?: number;
  similarityThreshold?: number;
  language?: "en" | "fr";
};

/**
 * Extended search options for executeVectorSearch
 */
export type VectorSearchOptions = SearchOptions & {
  additionalWhere?: ReturnType<typeof sql>;
  cacheKeyExtras?: Record<string, string | number | undefined>;
};

/**
 * Default search configuration
 */
export const DEFAULT_SEARCH_OPTIONS: Required<
  Omit<SearchOptions, "language">
> & { language: "en" | "fr" | undefined } = {
  limit: SEARCH_LIMITS.DEFAULT_LIMIT,
  similarityThreshold: SEARCH_LIMITS.DEFAULT_SIMILARITY_THRESHOLD,
  language: undefined,
};

/**
 * Generate a cache key for a search query
 */
export function buildCacheKey(
  prefix: string,
  query: string,
  options: SearchOptions,
  extras?: Record<string, string | number | undefined>
): string {
  const parts = [
    prefix,
    options.language ?? "any",
    options.similarityThreshold ?? DEFAULT_SEARCH_OPTIONS.similarityThreshold,
    options.limit ?? DEFAULT_SEARCH_OPTIONS.limit,
  ];

  if (extras) {
    for (const [key, val] of Object.entries(extras)) {
      parts.push(`${key}:${val ?? "NA"}`);
    }
  }

  parts.push(crypto.createHash("sha1").update(query).digest("hex"));
  return parts.join(":");
}

/**
 * Execute a hybrid search combining vector similarity and keyword matching
 *
 * This is the core search function used by all source-specific search functions.
 * It handles:
 * - Embedding generation for semantic search
 * - Full-text search for keyword matching (when tsv column is populated)
 * - Hybrid score combining both approaches
 * - Cache lookup/storage
 * - Language fallback (retry without language filter if no results)
 *
 * @param query - The search query text
 * @param sourceType - The source type to filter by
 * @param options - Search options (limit, threshold, language, additionalWhere, cacheKeyExtras)
 * @returns Array of search results sorted by hybrid score
 */
export async function executeVectorSearch<T extends ResourceMetadata>(
  query: string,
  sourceType: ResourceMetadata["sourceType"],
  options: VectorSearchOptions = {}
): Promise<SearchResult<T>[]> {
  const db = getDb();
  const {
    limit: rawLimit = DEFAULT_SEARCH_OPTIONS.limit,
    similarityThreshold = DEFAULT_SEARCH_OPTIONS.similarityThreshold,
    language,
    additionalWhere,
    cacheKeyExtras,
  } = options;

  // Enforce limit bounds to prevent over-fetching
  const limit = Math.min(Math.max(1, rawLimit), SEARCH_LIMITS.MAX_LIMIT);

  // Check cache first (unless disabled)
  const cacheDisabled = isRagCacheDisabled();
  const cacheKey = buildCacheKey(
    `search:${sourceType}`,
    query,
    options,
    cacheKeyExtras
  );
  if (!cacheDisabled) {
    const cached = await cacheGet(cacheKey);
    if (cached) {
      try {
        const arr = JSON.parse(cached) as Array<{
          content: string;
          metadata: T;
          similarity: number;
        }>;
        dbg("cache hit %s", cacheKey);
        return arr;
      } catch {
        // ignore JSON parse errors, refetch results
      }
    }
  }

  // Generate embedding for the query
  const queryEmbedding = await generateEmbedding(query);
  const embeddingVector = `[${queryEmbedding.join(",")}]`;

  // Hybrid search weights
  const { VECTOR_WEIGHT, KEYWORD_WEIGHT } = HYBRID_SEARCH_CONFIG;

  // Build base where clause - include results that match either vector OR keyword search
  // Vector similarity must meet threshold, OR keyword search must match
  const baseWhere = additionalWhere
    ? sql`${parlResources.metadata}->>'sourceType' = ${sourceType}
          AND (
            (1 - (${parlEmbeddings.embedding} <=> ${embeddingVector}::vector)) >= ${similarityThreshold}
            OR (${parlEmbeddings.tsv} IS NOT NULL AND ${parlEmbeddings.tsv} @@ plainto_tsquery('simple', ${query}))
          )
          AND ${additionalWhere}`
    : sql`${parlResources.metadata}->>'sourceType' = ${sourceType}
          AND (
            (1 - (${parlEmbeddings.embedding} <=> ${embeddingVector}::vector)) >= ${similarityThreshold}
            OR (${parlEmbeddings.tsv} IS NOT NULL AND ${parlEmbeddings.tsv} @@ plainto_tsquery('simple', ${query}))
          )`;

  const whereClause = language
    ? sql`${baseWhere} AND ${parlResources.metadata}->>'language' = ${language}`
    : baseWhere;

  // Hybrid score: weighted combination of vector similarity and keyword rank
  // ts_rank returns 0-1 range normalized, COALESCE handles NULL tsv
  const hybridScore = sql<number>`(
    ${VECTOR_WEIGHT} * (1 - (${parlEmbeddings.embedding} <=> ${embeddingVector}::vector))
    + ${KEYWORD_WEIGHT} * COALESCE(ts_rank(${parlEmbeddings.tsv}, plainto_tsquery('simple', ${query})), 0)
  )`;

  // Execute hybrid search
  let results = await db
    .select({
      resourceId: parlResources.id,
      content: parlEmbeddings.content,
      metadata: parlResources.metadata,
      similarity: hybridScore,
    })
    .from(parlEmbeddings)
    .innerJoin(
      parlResources,
      sql`${parlEmbeddings.resourceId} = ${parlResources.id}`
    )
    .where(whereClause)
    .orderBy(sql`${hybridScore} DESC`)
    .limit(limit);

  // Fallback: if language filter produced zero hits, retry without language filter
  if (language && results.length === 0) {
    results = await db
      .select({
        resourceId: parlResources.id,
        content: parlEmbeddings.content,
        metadata: parlResources.metadata,
        similarity: hybridScore,
      })
      .from(parlEmbeddings)
      .innerJoin(
        parlResources,
        sql`${parlEmbeddings.resourceId} = ${parlResources.id}`
      )
      .where(baseWhere)
      .orderBy(sql`${hybridScore} DESC`)
      .limit(limit);
  }

  dbg(
    "hybrid search: %d results for sourceType=%s (vector=%.1f, keyword=%.1f)",
    results.length,
    sourceType,
    VECTOR_WEIGHT,
    KEYWORD_WEIGHT
  );

  // Map to SearchResult format
  const mapped: SearchResult<T>[] = results.map((result) => ({
    content: result.content,
    metadata: result.metadata as T,
    similarity: result.similarity,
  }));

  // Cache results (unless disabled)
  if (!cacheDisabled) {
    await cacheSet(cacheKey, JSON.stringify(mapped), CACHE_TTL.SEARCH_RESULTS);
  }

  return mapped;
}

/**
 * Bill number pattern regex for extraction
 * Matches patterns like "Bill C-11", "C-11", "bill s-203", etc.
 */
const BILL_NUMBER_PATTERN = /\b([CS]-\d+)\b/i;

/**
 * Extract bill number from query text
 *
 * @param query - The search query
 * @returns Bill number if found (e.g., "C-11"), or null
 */
export function extractBillNumber(query: string): string | null {
  const match = query.match(BILL_NUMBER_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Format an ordinal number (1st, 2nd, 3rd, 4th, etc.)
 */
export function formatOrdinal(num: string | number): string {
  const n = typeof num === "string" ? Number.parseInt(num, 10) : num;
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  // Handle 11-13 specially (they're all "th")
  if (v >= 11 && v <= 13) {
    return `${n}th`;
  }
  // Use the last digit to determine suffix
  const lastDigit = v % 10;
  return `${n}${suffixes[lastDigit] || suffixes[0]}`;
}
