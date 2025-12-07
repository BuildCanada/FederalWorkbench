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
  /**
   * Filter defined terms by scope type.
   * - "act" or "regulation": terms that apply to the entire document
   * - "part": terms that apply to a specific part
   * - "section": terms that apply to specific section(s)
   */
  scopeType?: string;
  /**
   * Filter defined terms to only those applicable to a specific section.
   * Returns terms where:
   * - scopeType is "act"/"regulation" (applies to all sections), OR
   * - scopeSections array contains this section label
   */
  sectionScope?: string;
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
    options.scopeType ?? "NA",
    options.sectionScope ?? "NA",
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
    scopeType,
    sectionScope,
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

  // Scope filtering for defined terms (Task 2.2)
  if (scopeType) {
    // Filter by exact scope type
    conditions.push(sql`${legResources.metadata}->>'scopeType' = ${scopeType}`);
  }
  if (sectionScope) {
    // Return terms where either:
    // 1. scopeType is "act" or "regulation" (applies to all sections), OR
    // 2. scopeSections array contains the specified section label
    conditions.push(
      sql`(
        ${legResources.metadata}->>'scopeType' IN ('act', 'regulation')
        OR ${legResources.metadata}->'scopeSections' ? ${sectionScope}
      )`
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
    // Include scope filters in fallback (Task 2.2)
    if (scopeType) {
      fallbackConditions.push(
        sql`${legResources.metadata}->>'scopeType' = ${scopeType}`
      );
    }
    if (sectionScope) {
      fallbackConditions.push(
        sql`(
          ${legResources.metadata}->>'scopeType' IN ('act', 'regulation')
          OR ${legResources.metadata}->'scopeSections' ? ${sectionScope}
        )`
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
    "search: %d results (lang=%s, type=%s, actId=%s, regId=%s, scopeType=%s, sectionScope=%s)",
    results.length,
    language ?? "any",
    sourceType ?? "all",
    actId ?? "NA",
    regulationId ?? "NA",
    scopeType ?? "NA",
    sectionScope ?? "NA"
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
  "schedule",
  "defined_term",
  "preamble",
  "treaty",
  "cross_reference",
  "table_of_provisions",
  "signature_block",
  "related_provisions",
  "footnote",
  "marginal_note",
];

/**
 * Regulation-related source types to search
 * Includes all content types that can be associated with a regulation
 */
const REGULATION_SOURCE_TYPES: LegResourceMetadata["sourceType"][] = [
  "regulation",
  "regulation_section",
  "schedule",
  "defined_term",
  "treaty",
  "cross_reference",
  "table_of_provisions",
  "signature_block",
  "related_provisions",
  "footnote",
  "marginal_note",
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
 *
 * Supports scope filtering:
 * - scopeType: filter by scope type ("act", "regulation", "part", "section")
 * - sectionScope: filter to terms applicable to a specific section
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
 * Fetch paired (opposite language) resources for search results (Task 2.3).
 *
 * For each result that has a pairedResourceKey, looks up the corresponding
 * resource in the opposite language. This enables cross-lingual discovery:
 * a user searching in English can also see French versions of relevant content.
 *
 * @param results - Search results to find pairs for
 * @returns Map of original resource key to paired result (if found)
 */
export async function fetchPairedResources(
  results: LegislationSearchResult[]
): Promise<Map<string, LegislationSearchResult>> {
  const db = getDb();
  const pairedMap = new Map<string, LegislationSearchResult>();

  // Collect all paired resource keys that exist
  const pairedKeys = results
    .map((r) => r.metadata.pairedResourceKey)
    .filter((key): key is string => key != null);

  if (pairedKeys.length === 0) {
    return pairedMap;
  }

  // Fetch all paired resources in one query
  const pairedResults = await db
    .select({
      resourceKey: legResources.resourceKey,
      content: legResources.content,
      metadata: legResources.metadata,
    })
    .from(legResources)
    .where(sql`${legResources.resourceKey} = ANY(${pairedKeys})`);

  // Build reverse lookup map: pairedKey -> original result's resourceKey
  const reverseMap = new Map<string, string>();
  for (const r of results) {
    if (r.metadata.pairedResourceKey) {
      // The metadata's resourceKey isn't stored directly, so we reconstruct it
      // from the sourceType, relevant IDs, language, and chunkIndex
      const originalKey = buildResourceKeyFromMetadata(r.metadata);
      if (originalKey) {
        reverseMap.set(r.metadata.pairedResourceKey, originalKey);
      }
    }
  }

  // Map paired resources to their originals
  for (const paired of pairedResults) {
    const originalKey = reverseMap.get(paired.resourceKey);
    if (originalKey) {
      const metadata = paired.metadata as LegResourceMetadata;
      pairedMap.set(originalKey, {
        content: paired.content,
        metadata,
        // Use a neutral similarity (pairs inherit relevance from original)
        similarity: 0,
        citation: buildCitation(metadata, 0),
      });
    }
  }

  dbg(
    "fetched %d paired resources for %d results",
    pairedMap.size,
    results.length
  );
  return pairedMap;
}

/**
 * Reconstruct resource key from metadata.
 * Used internally for cross-lingual pairing lookups.
 */
function buildResourceKeyFromMetadata(
  meta: LegResourceMetadata
): string | null {
  const { sourceType, language, chunkIndex } = meta;
  if (!sourceType || !language) {
    return null;
  }

  let sourceId: string | null = null;

  switch (sourceType) {
    case "act":
      sourceId = meta.actId ?? null;
      break;
    case "regulation":
      sourceId = meta.regulationId ?? null;
      break;
    case "act_section":
    case "regulation_section":
    case "marginal_note":
    case "schedule":
      sourceId = meta.sectionId ?? null;
      break;
    case "defined_term":
      sourceId = meta.termId ?? null;
      break;
    case "cross_reference":
      sourceId = meta.crossRefId ?? null;
      break;
    case "preamble":
      if (meta.actId && meta.preambleIndex != null) {
        sourceId = `${meta.actId}:${meta.preambleIndex}`;
      }
      break;
    case "treaty":
      if (meta.actId && meta.treatyTitle) {
        // Treaties use act:actId:index or reg:regId:index format
        // We can't fully reconstruct without the index, so use treatyTitle
        sourceId = meta.actId
          ? `act:${meta.actId}`
          : `reg:${meta.regulationId}`;
      }
      break;
    case "table_of_provisions":
      sourceId = meta.actId ? `act:${meta.actId}` : `reg:${meta.regulationId}`;
      break;
    case "signature_block":
      sourceId = meta.actId ? `act:${meta.actId}` : `reg:${meta.regulationId}`;
      break;
    case "related_provisions":
      sourceId = meta.actId ? `act:${meta.actId}` : `reg:${meta.regulationId}`;
      break;
    case "footnote":
      if (meta.sectionId && meta.footnoteId) {
        sourceId = `${meta.sectionId}:${meta.footnoteId}`;
      }
      break;
    default:
      return null;
  }

  if (!sourceId) {
    return null;
  }
  return `${sourceType}:${sourceId}:${language}:${chunkIndex ?? 0}`;
}

/**
 * Search legislation with optional bilingual pairing (Task 2.3).
 *
 * When includePairedLanguage is true, results include a `pairedResult` field
 * containing the same content in the opposite language (if available).
 *
 * @param query - The search query text
 * @param options - Search options
 * @returns Array of search results with optional paired results
 */
export async function searchLegislationBilingual(
  query: string,
  options: LegislationSearchOptions & { includePairedLanguage?: boolean } = {}
): Promise<
  (LegislationSearchResult & { pairedResult?: LegislationSearchResult })[]
> {
  const { includePairedLanguage = false, ...searchOptions } = options;

  // Perform the base search
  const results = await searchLegislation(query, searchOptions);

  if (!includePairedLanguage || results.length === 0) {
    return results;
  }

  // Fetch paired resources
  const pairedMap = await fetchPairedResources(results);

  // Attach paired results to originals
  return results.map((r) => {
    const originalKey = buildResourceKeyFromMetadata(r.metadata);
    const paired = originalKey ? pairedMap.get(originalKey) : undefined;
    return paired ? { ...r, pairedResult: paired } : r;
  });
}

// ---------- Metadata-Only Search (Task 3.1) ----------

/**
 * Date range filter for metadata queries.
 * - before: exclusive upper bound (date < before)
 * - after: exclusive lower bound (date > after)
 * - on: exact date match
 * - between: inclusive range [start, end]
 */
export type DateFilter =
  | { before: string }
  | { after: string }
  | { on: string }
  | { between: { start: string; end: string } };

/**
 * Options for metadata-only search.
 * These queries use functional indexes and don't require vector similarity.
 */
export type LegislationMetadataSearchOptions = {
  // Pagination
  limit?: number;
  offset?: number;

  // Filtering by document type and language
  language?: "en" | "fr";
  sourceType?:
    | LegResourceMetadata["sourceType"]
    | LegResourceMetadata["sourceType"][];

  // Document identifiers
  actId?: string;
  regulationId?: string;

  // Status filtering
  status?: string; // "in-force", "repealed", "not-in-force"
  sectionStatus?: string; // "in-force", "repealed"

  // Date filtering - uses indexed JSONB fields
  lastAmendedDate?: DateFilter;
  enactedDate?: DateFilter;
  inForceDate?: DateFilter;
  consolidationDate?: DateFilter;
  registrationDate?: DateFilter;

  // Section-specific
  sectionLabel?: string;

  // Sorting
  orderBy?:
    | "lastAmendedDate"
    | "enactedDate"
    | "inForceDate"
    | "consolidationDate"
    | "registrationDate";
  orderDirection?: "asc" | "desc";
};

/**
 * Result from metadata-only search.
 * Includes content, metadata, and citation but no similarity score.
 */
export type LegislationMetadataResult = {
  content: string;
  metadata: LegResourceMetadata;
  citation: LegislationCitation;
};

/**
 * Build SQL condition for a date filter.
 * Uses the indexed JSONB extraction for efficient queries.
 */
function buildDateCondition(
  field: ReturnType<typeof sql>,
  filter: DateFilter
): ReturnType<typeof sql> {
  if ("before" in filter) {
    return sql`${field} < ${filter.before}`;
  }
  if ("after" in filter) {
    return sql`${field} > ${filter.after}`;
  }
  if ("on" in filter) {
    return sql`${field} = ${filter.on}`;
  }
  if ("between" in filter) {
    return sql`${field} BETWEEN ${filter.between.start} AND ${filter.between.end}`;
  }
  // Should never reach here due to type constraints
  throw new Error("Invalid date filter");
}

/**
 * Search legislation by metadata only (no vector similarity).
 *
 * This function is optimized for queries like:
 * - "acts amended in 2023"
 * - "all in-force regulations"
 * - "repealed sections of the Criminal Code"
 *
 * Uses functional indexes on JSONB fields for fast execution.
 *
 * @param options - Filter and pagination options
 * @returns Array of results with content, metadata, and citations
 */
export async function searchLegislationByMetadata(
  options: LegislationMetadataSearchOptions = {}
): Promise<LegislationMetadataResult[]> {
  const db = getDb();
  const {
    limit: rawLimit = SEARCH_LIMITS.DEFAULT_LIMIT,
    offset = 0,
    language,
    sourceType,
    actId,
    regulationId,
    status,
    sectionStatus,
    lastAmendedDate,
    enactedDate,
    inForceDate,
    consolidationDate,
    registrationDate,
    sectionLabel,
    orderBy,
    orderDirection = "desc",
  } = options;

  // Enforce limit bounds
  const limit = Math.min(Math.max(1, rawLimit), SEARCH_LIMITS.MAX_LIMIT);

  // Build WHERE conditions
  const conditions: ReturnType<typeof sql>[] = [];

  // Language filter (uses denormalized column)
  if (language) {
    conditions.push(sql`${legResources.language} = ${language}`);
  }

  // Source type filter (uses denormalized column)
  if (sourceType) {
    if (Array.isArray(sourceType)) {
      conditions.push(sql`${legResources.sourceType} = ANY(${sourceType})`);
    } else {
      conditions.push(sql`${legResources.sourceType} = ${sourceType}`);
    }
  }

  // Document ID filters (use indexed JSONB fields)
  if (actId) {
    conditions.push(sql`${legResources.metadata}->>'actId' = ${actId}`);
  }
  if (regulationId) {
    conditions.push(
      sql`${legResources.metadata}->>'regulationId' = ${regulationId}`
    );
  }

  // Status filters (use indexed JSONB fields)
  if (status) {
    conditions.push(sql`${legResources.metadata}->>'status' = ${status}`);
  }
  if (sectionStatus) {
    conditions.push(
      sql`${legResources.metadata}->>'sectionStatus' = ${sectionStatus}`
    );
  }

  // Section label filter
  if (sectionLabel) {
    conditions.push(
      sql`${legResources.metadata}->>'sectionLabel' = ${sectionLabel}`
    );
  }

  // Date filters (use indexed JSONB fields)
  if (lastAmendedDate) {
    conditions.push(
      buildDateCondition(
        sql`${legResources.metadata}->>'lastAmendedDate'`,
        lastAmendedDate
      )
    );
  }
  if (enactedDate) {
    conditions.push(
      buildDateCondition(
        sql`${legResources.metadata}->>'enactedDate'`,
        enactedDate
      )
    );
  }
  if (inForceDate) {
    conditions.push(
      buildDateCondition(
        sql`${legResources.metadata}->>'inForceDate'`,
        inForceDate
      )
    );
  }
  if (consolidationDate) {
    conditions.push(
      buildDateCondition(
        sql`${legResources.metadata}->>'consolidationDate'`,
        consolidationDate
      )
    );
  }
  if (registrationDate) {
    conditions.push(
      buildDateCondition(
        sql`${legResources.metadata}->>'registrationDate'`,
        registrationDate
      )
    );
  }

  // Build WHERE clause (if no conditions, select all)
  const whereClause =
    conditions.length > 0 ? sql.join(conditions, sql` AND `) : sql`TRUE`;

  // Build ORDER BY clause
  let orderClause: ReturnType<typeof sql>;
  if (orderBy) {
    const orderField = sql`${legResources.metadata}->>'${sql.raw(orderBy)}'`;
    orderClause =
      orderDirection === "asc"
        ? sql`${orderField} ASC NULLS LAST`
        : sql`${orderField} DESC NULLS LAST`;
  } else {
    // Default: order by updatedAt descending
    orderClause = sql`${legResources.updatedAt} DESC`;
  }

  // Execute query
  const results = await db
    .select({
      content: legResources.content,
      metadata: legResources.metadata,
    })
    .from(legResources)
    .where(whereClause)
    .orderBy(orderClause)
    .limit(limit)
    .offset(offset);

  dbg(
    "metadata search: %d results (lang=%s, type=%s, actId=%s, regId=%s, status=%s)",
    results.length,
    language ?? "any",
    Array.isArray(sourceType) ? sourceType.join(",") : (sourceType ?? "all"),
    actId ?? "NA",
    regulationId ?? "NA",
    status ?? "NA"
  );

  // Map to results with citations
  return results.map((r, idx) => ({
    content: r.content,
    metadata: r.metadata as LegResourceMetadata,
    citation: buildCitation(r.metadata as LegResourceMetadata, idx + 1),
  }));
}

/**
 * Count legislation resources matching metadata filters.
 * Useful for pagination and understanding result set size.
 *
 * @param options - Filter options (same as searchLegislationByMetadata, minus pagination)
 * @returns Total count of matching resources
 */
export async function countLegislationByMetadata(
  options: Omit<
    LegislationMetadataSearchOptions,
    "limit" | "offset" | "orderBy" | "orderDirection"
  > = {}
): Promise<number> {
  const db = getDb();
  const {
    language,
    sourceType,
    actId,
    regulationId,
    status,
    sectionStatus,
    lastAmendedDate,
    enactedDate,
    inForceDate,
    consolidationDate,
    registrationDate,
    sectionLabel,
  } = options;

  // Build WHERE conditions (same as searchLegislationByMetadata)
  const conditions: ReturnType<typeof sql>[] = [];

  if (language) {
    conditions.push(sql`${legResources.language} = ${language}`);
  }
  if (sourceType) {
    if (Array.isArray(sourceType)) {
      conditions.push(sql`${legResources.sourceType} = ANY(${sourceType})`);
    } else {
      conditions.push(sql`${legResources.sourceType} = ${sourceType}`);
    }
  }
  if (actId) {
    conditions.push(sql`${legResources.metadata}->>'actId' = ${actId}`);
  }
  if (regulationId) {
    conditions.push(
      sql`${legResources.metadata}->>'regulationId' = ${regulationId}`
    );
  }
  if (status) {
    conditions.push(sql`${legResources.metadata}->>'status' = ${status}`);
  }
  if (sectionStatus) {
    conditions.push(
      sql`${legResources.metadata}->>'sectionStatus' = ${sectionStatus}`
    );
  }
  if (sectionLabel) {
    conditions.push(
      sql`${legResources.metadata}->>'sectionLabel' = ${sectionLabel}`
    );
  }
  if (lastAmendedDate) {
    conditions.push(
      buildDateCondition(
        sql`${legResources.metadata}->>'lastAmendedDate'`,
        lastAmendedDate
      )
    );
  }
  if (enactedDate) {
    conditions.push(
      buildDateCondition(
        sql`${legResources.metadata}->>'enactedDate'`,
        enactedDate
      )
    );
  }
  if (inForceDate) {
    conditions.push(
      buildDateCondition(
        sql`${legResources.metadata}->>'inForceDate'`,
        inForceDate
      )
    );
  }
  if (consolidationDate) {
    conditions.push(
      buildDateCondition(
        sql`${legResources.metadata}->>'consolidationDate'`,
        consolidationDate
      )
    );
  }
  if (registrationDate) {
    conditions.push(
      buildDateCondition(
        sql`${legResources.metadata}->>'registrationDate'`,
        registrationDate
      )
    );
  }

  const whereClause =
    conditions.length > 0 ? sql.join(conditions, sql` AND `) : sql`TRUE`;

  const result = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(legResources)
    .where(whereClause);

  return result[0]?.count ?? 0;
}

/**
 * List unique values for a metadata field.
 * Useful for building filter UIs (e.g., dropdowns of available statuses).
 *
 * @param field - The metadata field to get distinct values for
 * @param options - Optional filters to narrow scope
 * @returns Array of unique values (strings), sorted alphabetically
 */
export async function listDistinctMetadataValues(
  field:
    | "status"
    | "sectionStatus"
    | "billOrigin"
    | "billType"
    | "regulationType",
  options: Pick<
    LegislationMetadataSearchOptions,
    "language" | "sourceType"
  > = {}
): Promise<string[]> {
  const db = getDb();
  const { language, sourceType } = options;

  const conditions: ReturnType<typeof sql>[] = [];

  // Ensure the field is not null
  conditions.push(
    sql`${legResources.metadata}->>'${sql.raw(field)}' IS NOT NULL`
  );

  if (language) {
    conditions.push(sql`${legResources.language} = ${language}`);
  }
  if (sourceType) {
    if (Array.isArray(sourceType)) {
      conditions.push(sql`${legResources.sourceType} = ANY(${sourceType})`);
    } else {
      conditions.push(sql`${legResources.sourceType} = ${sourceType}`);
    }
  }

  const whereClause = sql.join(conditions, sql` AND `);

  const result = await db
    .selectDistinct({
      value: sql<string>`${legResources.metadata}->>'${sql.raw(field)}'`,
    })
    .from(legResources)
    .where(whereClause)
    .orderBy(sql`${legResources.metadata}->>'${sql.raw(field)}' ASC`);

  return result.map((r) => r.value).filter((v): v is string => v != null);
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
    // Include language to properly distinguish EN/FR versions of cross-references
    const key = [
      meta.sourceType,
      meta.actId ?? "",
      meta.regulationId ?? "",
      meta.sectionId ?? "",
      meta.termId ?? "",
      meta.crossRefId ?? "",
      meta.preambleIndex ?? "",
      meta.chunkIndex ?? 0,
      meta.language ?? "",
      // Related provisions: distinguish by label/source
      meta.relatedProvisionLabel ?? "",
      meta.relatedProvisionSource ?? "",
      // Footnotes: distinguish by footnote ID within section
      meta.footnoteId ?? "",
    ].join(":");

    const existing = seen.get(key);
    if (!existing || r.similarity > existing.similarity) {
      seen.set(key, r);
    }
  }

  return Array.from(seen.values());
}
