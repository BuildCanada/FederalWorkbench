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

  // Optional filters
  if (language) {
    conditions.push(sql`${legResources.metadata}->>'language' = ${language}`);
  }
  if (sourceType) {
    conditions.push(
      sql`${legResources.metadata}->>'sourceType' = ${sourceType}`
    );
  }
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
 * Search specifically for acts
 */
export async function searchActs(
  query: string,
  options: Omit<LegislationSearchOptions, "sourceType" | "regulationId"> = {}
): Promise<LegislationSearchResult[]> {
  // Search both act metadata and act sections
  const [actResults, sectionResults] = await Promise.all([
    searchLegislation(query, { ...options, sourceType: "act" }),
    searchLegislation(query, { ...options, sourceType: "act_section" }),
  ]);

  // Merge and sort by similarity
  return [...actResults, ...sectionResults]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, options.limit ?? SEARCH_LIMITS.DEFAULT_LIMIT);
}

/**
 * Search specifically for regulations
 */
export async function searchRegulations(
  query: string,
  options: Omit<LegislationSearchOptions, "sourceType" | "actId"> = {}
): Promise<LegislationSearchResult[]> {
  // Search both regulation metadata and regulation sections
  const [regResults, sectionResults] = await Promise.all([
    searchLegislation(query, { ...options, sourceType: "regulation" }),
    searchLegislation(query, { ...options, sourceType: "regulation_section" }),
  ]);

  // Merge and sort by similarity
  return [...regResults, ...sectionResults]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, options.limit ?? SEARCH_LIMITS.DEFAULT_LIMIT);
}
