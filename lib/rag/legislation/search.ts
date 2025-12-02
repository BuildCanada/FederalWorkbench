/**
 * Legislation Search
 *
 * Hybrid vector + keyword search for acts and regulations.
 * Uses the same patterns as parliament search but against leg_* tables.
 */

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { generateEmbedding } from "@/lib/ai/embeddings";
import { cacheGet, cacheSet } from "@/lib/cache/redis";
import { getDb } from "@/lib/db/connection";
import {
  type LegResourceMetadata,
  legEmbeddings,
  legResources,
} from "@/lib/db/rag/schema";
import {
  CACHE_TTL,
  HYBRID_SEARCH_CONFIG,
  isRagCacheDisabled,
  SEARCH_LIMITS,
} from "@/lib/rag/parliament/constants";
import { ragDebug } from "@/lib/rag/parliament/debug";
import { buildCitation, type LegislationCitation } from "./citations";

const dbg = ragDebug("leg:search");

/**
 * Search result with content, metadata, similarity score, and citation
 */
export type LegislationSearchResult = {
  content: string;
  metadata: LegResourceMetadata;
  similarity: number;
  citation: LegislationCitation;
};

/**
 * Search options for legislation
 */
export type LegislationSearchOptions = {
  limit?: number;
  similarityThreshold?: number;
  language?: "en" | "fr";
  sourceType?: LegResourceMetadata["sourceType"];
  actId?: string;
  regulationId?: string;
};

/**
 * Build cache key for legislation search
 */
function buildCacheKey(
  query: string,
  options: LegislationSearchOptions
): string {
  const parts = [
    "leg:search",
    options.language ?? "any",
    options.sourceType ?? "all",
    options.actId ?? "NA",
    options.regulationId ?? "NA",
    options.similarityThreshold ?? SEARCH_LIMITS.DEFAULT_SIMILARITY_THRESHOLD,
    options.limit ?? SEARCH_LIMITS.DEFAULT_LIMIT,
  ];
  parts.push(crypto.createHash("sha1").update(query).digest("hex"));
  return parts.join(":");
}

/**
 * Search legislation using hybrid vector + keyword search
 *
 * Combines:
 * - Vector similarity (semantic meaning)
 * - Keyword matching (exact terms, section numbers)
 *
 * @param query - The search query text
 * @param options - Search options (limit, language, filters)
 * @returns Array of search results with citations
 */
export async function searchLegislation(
  query: string,
  options: LegislationSearchOptions = {}
): Promise<LegislationSearchResult[]> {
  const db = getDb();
  const {
    limit: rawLimit = SEARCH_LIMITS.DEFAULT_LIMIT,
    similarityThreshold = SEARCH_LIMITS.DEFAULT_SIMILARITY_THRESHOLD,
    language,
    sourceType,
    actId,
    regulationId,
  } = options;

  // Enforce limit bounds
  const limit = Math.min(Math.max(1, rawLimit), SEARCH_LIMITS.MAX_LIMIT);

  // Check cache first (unless disabled)
  const cacheDisabled = isRagCacheDisabled();
  const cacheKey = buildCacheKey(query, { ...options, limit });
  if (!cacheDisabled) {
    const cached = await cacheGet(cacheKey);
    if (cached) {
      try {
        const arr = JSON.parse(cached) as LegislationSearchResult[];
        dbg("cache hit %s", cacheKey);
        return arr;
      } catch {
        // ignore JSON parse errors, refetch
      }
    }
  }

  // Generate embedding for query
  const queryEmbedding = await generateEmbedding(query);
  const embeddingVector = `[${queryEmbedding.join(",")}]`;

  // Hybrid search weights
  const { VECTOR_WEIGHT, KEYWORD_WEIGHT } = HYBRID_SEARCH_CONFIG;

  // Build WHERE conditions
  const conditions: ReturnType<typeof sql>[] = [];

  // Base condition: vector OR keyword match
  conditions.push(
    sql`(
      (1 - (${legEmbeddings.embedding} <=> ${embeddingVector}::vector)) >= ${similarityThreshold}
      OR (${legEmbeddings.tsv} IS NOT NULL AND ${legEmbeddings.tsv} @@ plainto_tsquery('simple', ${query}))
    )`
  );

  // Optional filters - use denormalized columns for language/sourceType (faster)
  if (language) {
    conditions.push(sql`${legResources.language} = ${language}`);
  }
  if (sourceType) {
    conditions.push(sql`${legResources.sourceType} = ${sourceType}`);
  }
  // actId and regulationId still use JSONB (less frequently filtered)
  if (actId) {
    conditions.push(sql`${legResources.metadata}->>'actId' = ${actId}`);
  }
  if (regulationId) {
    conditions.push(
      sql`${legResources.metadata}->>'regulationId' = ${regulationId}`
    );
  }

  const whereClause = sql.join(conditions, sql` AND `);

  // Hybrid score
  const hybridScore = sql<number>`(
    ${VECTOR_WEIGHT} * (1 - (${legEmbeddings.embedding} <=> ${embeddingVector}::vector))
    + ${KEYWORD_WEIGHT} * COALESCE(ts_rank(${legEmbeddings.tsv}, plainto_tsquery('simple', ${query})), 0)
  )`;

  // Execute search
  let results = await db
    .select({
      content: legEmbeddings.content,
      metadata: legResources.metadata,
      similarity: hybridScore,
    })
    .from(legEmbeddings)
    .innerJoin(
      legResources,
      sql`${legEmbeddings.resourceId} = ${legResources.id}`
    )
    .where(whereClause)
    .orderBy(sql`${hybridScore} DESC`)
    .limit(limit);

  // Fallback: if language filter produced zero hits, retry without language filter
  if (language && results.length === 0) {
    // Rebuild conditions without language filter
    const fallbackConditions: ReturnType<typeof sql>[] = [];
    fallbackConditions.push(
      sql`(
        (1 - (${legEmbeddings.embedding} <=> ${embeddingVector}::vector)) >= ${similarityThreshold}
        OR (${legEmbeddings.tsv} IS NOT NULL AND ${legEmbeddings.tsv} @@ plainto_tsquery('simple', ${query}))
      )`
    );
    if (sourceType) {
      fallbackConditions.push(
        sql`${legResources.metadata}->>'sourceType' = ${sourceType}`
      );
    }
    if (actId) {
      fallbackConditions.push(
        sql`${legResources.metadata}->>'actId' = ${actId}`
      );
    }
    if (regulationId) {
      fallbackConditions.push(
        sql`${legResources.metadata}->>'regulationId' = ${regulationId}`
      );
    }

    const fallbackWhere = sql.join(fallbackConditions, sql` AND `);
    results = await db
      .select({
        content: legEmbeddings.content,
        metadata: legResources.metadata,
        similarity: hybridScore,
      })
      .from(legEmbeddings)
      .innerJoin(
        legResources,
        sql`${legEmbeddings.resourceId} = ${legResources.id}`
      )
      .where(fallbackWhere)
      .orderBy(sql`${hybridScore} DESC`)
      .limit(limit);
  }

  dbg(
    "search: %d results (lang=%s, type=%s, actId=%s, regId=%s)",
    results.length,
    language ?? "any",
    sourceType ?? "all",
    actId ?? "NA",
    regulationId ?? "NA"
  );

  // Map to results with citations
  const mapped: LegislationSearchResult[] = results.map((r, idx) => ({
    content: r.content,
    metadata: r.metadata as LegResourceMetadata,
    similarity: r.similarity,
    citation: buildCitation(r.metadata as LegResourceMetadata, idx + 1),
  }));

  // Cache results (unless disabled)
  if (!cacheDisabled) {
    await cacheSet(cacheKey, JSON.stringify(mapped), CACHE_TTL.SEARCH_RESULTS);
  }

  return mapped;
}

/**
 * Act-related source types to search
 * Includes all content types that can be associated with an act
 */
const ACT_SOURCE_TYPES: LegResourceMetadata["sourceType"][] = [
  "act",
  "act_section",
  "defined_term",
  "preamble",
  "treaty",
  "table_of_provisions",
  "signature_block",
];

/**
 * Regulation-related source types to search
 * Includes all content types that can be associated with a regulation
 */
const REGULATION_SOURCE_TYPES: LegResourceMetadata["sourceType"][] = [
  "regulation",
  "regulation_section",
  "defined_term",
  "treaty",
  "table_of_provisions",
  "signature_block",
];

/**
 * Search specifically for acts and all associated content
 * Includes: act metadata, sections, defined terms, preambles, treaties,
 * table of provisions, and signature blocks
 */
export async function searchActs(
  query: string,
  options: Omit<LegislationSearchOptions, "sourceType" | "regulationId"> = {}
): Promise<LegislationSearchResult[]> {
  // Search all act-related source types in parallel
  const searchPromises = ACT_SOURCE_TYPES.map((sourceType) =>
    searchLegislation(query, { ...options, sourceType })
  );

  const results = await Promise.all(searchPromises);

  // Merge, deduplicate, sort by similarity, and limit
  const allResults = results.flat();
  const deduplicated = deduplicateByResourceKey(allResults);

  return deduplicated
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, options.limit ?? SEARCH_LIMITS.DEFAULT_LIMIT);
}

/**
 * Search specifically for regulations and all associated content
 * Includes: regulation metadata, sections, defined terms, treaties,
 * table of provisions, and signature blocks
 */
export async function searchRegulations(
  query: string,
  options: Omit<LegislationSearchOptions, "sourceType" | "actId"> = {}
): Promise<LegislationSearchResult[]> {
  // Search all regulation-related source types in parallel
  const searchPromises = REGULATION_SOURCE_TYPES.map((sourceType) =>
    searchLegislation(query, { ...options, sourceType })
  );

  const results = await Promise.all(searchPromises);

  // Merge, deduplicate, sort by similarity, and limit
  const allResults = results.flat();
  const deduplicated = deduplicateByResourceKey(allResults);

  return deduplicated
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, options.limit ?? SEARCH_LIMITS.DEFAULT_LIMIT);
}

/**
 * Search specifically for defined terms
 * Useful for "what does X mean" type queries
 */
export function searchDefinedTerms(
  query: string,
  options: Omit<LegislationSearchOptions, "sourceType"> = {}
): Promise<LegislationSearchResult[]> {
  return searchLegislation(query, { ...options, sourceType: "defined_term" });
}

/**
 * Search that prioritizes defined terms for definition-type queries
 *
 * This is ideal for queries like "what does 'barrier' mean" or "define 'disability'".
 * It searches defined terms first, then includes relevant act/regulation sections
 * for additional context.
 *
 * Results are sorted with defined terms boosted to appear first, followed by
 * contextual sections from the same documents.
 */
export async function searchWithDefinitions(
  query: string,
  options: Omit<LegislationSearchOptions, "sourceType"> = {}
): Promise<LegislationSearchResult[]> {
  const limit = options.limit ?? SEARCH_LIMITS.DEFAULT_LIMIT;

  // Search defined terms and sections in parallel
  const [termResults, sectionResults] = await Promise.all([
    searchDefinedTerms(query, { ...options, limit }),
    searchLegislation(query, { ...options, limit }),
  ]);

  // Boost defined term similarity scores to prioritize them
  const TERM_BOOST = 0.15;
  const boostedTerms = termResults.map((r) => ({
    ...r,
    similarity: Math.min(1, r.similarity + TERM_BOOST),
  }));

  // Merge results, with terms getting priority
  const allResults = [...boostedTerms, ...sectionResults];

  // Deduplicate - defined terms from boostedTerms will win due to higher similarity
  const deduplicated = deduplicateByResourceKey(allResults);

  // Sort by similarity and limit
  return deduplicated
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Deduplicate results by building a unique key from metadata
 * Prefers higher similarity scores when duplicates are found
 */
function deduplicateByResourceKey(
  results: LegislationSearchResult[]
): LegislationSearchResult[] {
  const seen = new Map<string, LegislationSearchResult>();

  for (const r of results) {
    const meta = r.metadata;
    // Build unique key from source type and identifying fields
    const key = [
      meta.sourceType,
      meta.actId ?? "",
      meta.regulationId ?? "",
      meta.sectionId ?? "",
      meta.termId ?? "",
      meta.crossRefId ?? "",
      meta.preambleIndex ?? "",
      meta.chunkIndex ?? 0,
    ].join(":");

    const existing = seen.get(key);
    if (!existing || r.similarity > existing.similarity) {
      seen.set(key, r);
    }
  }

  return Array.from(seen.values());
}
