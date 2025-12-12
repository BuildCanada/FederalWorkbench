/**
 * Cross-Encoder Reranker using Cohere's rerank-multilingual-v3.0 model
 *
 * This module provides semantic reranking of search results using a cross-encoder
 * model, which considers query-document pairs together for more accurate relevance
 * scoring compared to bi-encoder (embedding) similarity alone.
 *
 * Based on RAG best practices: "topK values really high (100 for vector search
 * and 50 for post-reranking)" - retrieve more candidates, then rerank.
 */

import crypto from "node:crypto";
import { CohereClient } from "cohere-ai";
import { cacheGet, cacheSet } from "@/lib/cache/redis";
import {
  CACHE_TTL,
  isRagCacheDisabled,
  RERANKER_CONFIG,
} from "@/lib/rag/shared/constants";
import { ragDebug } from "./debug";
import type { SearchResult } from "./search-utils";

const dbg = ragDebug("parl:rerank");

// Initialize Cohere client with API key from env
const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

/**
 * Reranked search result with updated similarity score
 */
export type RerankedResult<T extends SearchResult = SearchResult> = T & {
  /** Original vector similarity score before reranking */
  originalSimilarity: number;
  /** Rerank relevance score (0-1, higher is better) */
  rerankScore: number;
};

/**
 * Rerank search results using Cohere's cross-encoder model
 *
 * Uses Cohere's v2 rerank API with the multilingual model for EN/FR support.
 * This cross-encoder approach considers query-document pairs together, providing
 * more accurate relevance scoring than bi-encoder similarity alone.
 *
 * @param query - The search query
 * @param results - Array of search results to rerank
 * @param topN - Number of top results to return (default: 10)
 * @returns Reranked results sorted by relevance, with updated similarity scores
 */
export async function rerankResults<T extends SearchResult>(
  query: string,
  results: T[],
  topN: number = RERANKER_CONFIG.DEFAULT_TOP_N
): Promise<RerankedResult<T>[]> {
  if (results.length === 0) {
    return [];
  }

  // If fewer results than topN, return all
  const effectiveTopN = Math.min(topN, results.length);

  // Check cache first (unless disabled)
  const cacheDisabled = isRagCacheDisabled();
  const cacheKey = buildRerankCacheKey(query, results, effectiveTopN);
  if (!cacheDisabled) {
    const cached = await cacheGet(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as RerankedResult<T>[];
        dbg("cache hit %s", cacheKey);
        return parsed;
      } catch {
        // ignore JSON parse errors, refetch
      }
    }
  }

  try {
    const response = await cohere.v2.rerank({
      model: RERANKER_CONFIG.MODEL,
      query,
      documents: results.map((r) => r.content),
      topN: effectiveTopN,
      maxTokensPerDoc: RERANKER_CONFIG.MAX_TOKENS_PER_DOC,
    });

    dbg(
      "reranked %d -> %d results, top score: %.3f",
      results.length,
      response.results.length,
      response.results[0]?.relevanceScore ?? 0
    );

    // Map ranking back to original results with updated scores
    const reranked: RerankedResult<T>[] = response.results.map((r) => ({
      ...results[r.index],
      originalSimilarity: results[r.index].similarity,
      similarity: r.relevanceScore, // Replace with rerank score for downstream use
      rerankScore: r.relevanceScore,
    }));

    // Cache results (unless disabled)
    if (!cacheDisabled) {
      await cacheSet(
        cacheKey,
        JSON.stringify(reranked),
        CACHE_TTL.RERANK_RESULTS
      );
    }

    return reranked;
  } catch (error) {
    dbg("rerank failed, falling back to similarity-sorted order: %O", error);
    // On error, sort by original similarity and return (graceful degradation)
    // This ensures results are in a sensible order even without cross-encoder reranking
    return results
      .map((r) => ({
        ...r,
        originalSimilarity: r.similarity,
        rerankScore: r.similarity,
      }))
      .sort((a, b) => b.similarity - a.similarity);
  }
}

/**
 * Build cache key for reranking results
 */
function buildRerankCacheKey<T extends SearchResult>(
  query: string,
  results: T[],
  topN: number
): string {
  // Include result IDs with sourceType to ensure cache invalidation when results change
  // and to prevent collisions between different source types (e.g., bill ID 123 vs party ID 123)
  const resultIds = results
    .map(
      (r) =>
        `${r.metadata.sourceType}:${r.metadata.sourceId}:${r.metadata.chunkIndex ?? 0}`
    )
    .join(",");
  const hash = crypto
    .createHash("sha1")
    .update(`${query}|${resultIds}`)
    .digest("hex");
  return `rerank:${topN}:${hash}`;
}

/**
 * Deduplicate results by (sourceType, sourceId, chunkIndex) before reranking
 *
 * Removes duplicate chunks from the same source to avoid redundant
 * reranking and ensure diverse results. The sourceType is included
 * to prevent collisions between different source types that share
 * the same numeric ID (e.g., bill ID 123 vs party ID 123).
 */
export function deduplicateResults<T extends SearchResult>(results: T[]): T[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    // Include sourceType to prevent collisions between different source types
    // (e.g., bill ID 123 vs party ID 123)
    const key = `${r.metadata.sourceType}:${r.metadata.sourceId}:${r.metadata.chunkIndex ?? -1}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Intent-Based Citation Slot Allocation
// ─────────────────────────────────────────────────────────────────────────────

import type { PriorityIntent } from "./query-analysis";

/**
 * Ensure source type diversity in reranked results.
 *
 * After Cohere reranking, high-verbosity sources (hansard) often dominate
 * because they have more matching text. This function ensures we preserve
 * at least `minPerType` results from each source type present in the input.
 *
 * @param results - Reranked results (already sorted by relevance)
 * @param allCandidates - All candidates before the rerank cutoff
 * @param minPerType - Minimum results to preserve per source type (default: 2)
 * @returns Diversified results maintaining overall relevance order
 */
export function ensureSourceDiversity<T extends SearchResult>(
  results: T[],
  allCandidates: T[],
  minPerType = 2
): T[] {
  // Count how many of each type we have in results
  const typeCounts: Record<string, number> = {};
  for (const r of results) {
    const t = r.metadata?.sourceType || "unknown";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  // Find source types that are underrepresented (< minPerType)
  // Look at candidates to see what types exist but are missing from results
  const candidateTypes = new Set<string>();
  const candidateTypeCounts: Record<string, number> = {};
  for (const c of allCandidates) {
    const t = c.metadata?.sourceType || "unknown";
    candidateTypes.add(t);
    candidateTypeCounts[t] = (candidateTypeCounts[t] || 0) + 1;
  }

  dbg(
    "diversity check: results=%d typeCounts=%o candidateTypeCounts=%o",
    results.length,
    typeCounts,
    candidateTypeCounts
  );

  // Build a set of result IDs for dedup
  const resultIds = new Set(
    results.map(
      (r) =>
        `${r.metadata?.sourceType}:${r.metadata?.sourceId}:${r.metadata?.chunkIndex ?? 0}`
    )
  );

  // Calculate minimum rerank score to assign to diversity additions
  // This ensures they survive adaptive filtering which uses relative thresholds
  const minRerankScore =
    results.length > 0
      ? Math.max(
          (results.at(-1)?.similarity ?? 0) * 0.9, // 90% of lowest reranked score
          0.1 // Absolute minimum
        )
      : 0.1;

  // Find missing candidates from underrepresented types
  const additions: T[] = [];
  for (const sourceType of candidateTypes) {
    const currentCount = typeCounts[sourceType] || 0;
    if (currentCount < minPerType) {
      // Find top candidates of this type not already in results
      const needed = minPerType - currentCount;
      let added = 0;
      let skippedDuplicate = 0;
      let candidatesOfType = 0;

      for (const c of allCandidates) {
        if (added >= needed) {
          break;
        }
        if (c.metadata?.sourceType !== sourceType) {
          continue;
        }
        candidatesOfType++;

        const cId = `${c.metadata?.sourceType}:${c.metadata?.sourceId}:${c.metadata?.chunkIndex ?? 0}`;
        if (resultIds.has(cId)) {
          skippedDuplicate++;
          continue;
        }

        // Assign minimum rerank score so it survives adaptive filtering
        const withScore = { ...c, similarity: minRerankScore };
        additions.push(withScore as T);
        resultIds.add(cId);
        added++;
      }

      dbg(
        "diversity: type=%s had=%d needed=%d found=%d added=%d skippedDup=%d",
        sourceType,
        currentCount,
        needed,
        candidatesOfType,
        added,
        skippedDuplicate
      );
    }
  }

  if (additions.length === 0) {
    dbg("diversity: no additions needed");
    return results;
  }

  dbg("diversity: total additions=%d", additions.length);
  // Merge: keep original order, append additions at end
  return [...results, ...additions];
}

/**
 * Configuration for citation slot allocation based on query intent.
 */
export type SlotConfig = {
  /** Source types that should fill the first citation slots */
  primary: string[];
  /** Source types for remaining slots (context/supporting info) */
  secondary: string[];
  /** Maximum number of secondary sources to include */
  secondaryCap: number;
};

/**
 * Get slot configuration based on priority intent.
 *
 * The key insight is: citations should answer the question first,
 * then provide supporting context. Different intents require
 * different source type priorities.
 *
 * @param intent - The priority intent from query analysis
 * @returns SlotConfig for citation allocation
 */
export function getSlotConfig(intent: PriorityIntent): SlotConfig {
  const configs: Record<PriorityIntent, SlotConfig> = {
    // Bill-focused: Lead with bill, then vote outcome only
    bill_focused: {
      primary: ["bill", "vote_question"],
      secondary: ["hansard", "committee"],
      secondaryCap: 2,
    },
    // Vote-focused: Lead with votes, then bill, minimal debate
    vote_focused: {
      primary: ["vote_question", "vote_member", "vote_party", "bill"],
      secondary: ["hansard"],
      secondaryCap: 1,
    },
    // MP Statement: Lead with what they said, then who they are
    mp_statement: {
      primary: ["hansard", "politician", "riding"],
      secondary: ["bill", "vote_question"],
      secondaryCap: 2,
    },
    // MP Info: Lead with profile info, no debate quotes
    mp_info: {
      primary: ["politician", "riding", "party"],
      secondary: [],
      secondaryCap: 0,
    },
    // Committee-focused: Lead with committee content
    committee_focused: {
      primary: ["committee", "committee_report", "committee_meeting"],
      secondary: ["bill"],
      secondaryCap: 2,
    },
    // General: No preference, balance all types
    general: {
      primary: [],
      secondary: [],
      secondaryCap: 10, // No cap for general queries
    },
  };
  return configs[intent];
}

/**
 * Allocate citation slots based on intent configuration.
 *
 * Takes reranked results and reorganizes them so that primary sources
 * (those that directly answer the query) appear first, followed by
 * a limited number of secondary sources for context.
 *
 * @param results - Reranked search results
 * @param config - Slot configuration from getSlotConfig
 * @param limit - Maximum total results to return
 * @returns Results reorganized by citation slot allocation
 */
export function allocateCitationSlots<T extends SearchResult>(
  results: T[],
  config: SlotConfig,
  limit: number
): T[] {
  if (results.length === 0) {
    return [];
  }

  // General intent: no reorganization, just enforce balance
  if (config.primary.length === 0) {
    return enforceBalance(results, limit, 0.4);
  }

  const primaryResults: T[] = [];
  const secondaryResults: T[] = [];
  const otherResults: T[] = [];

  for (const result of results) {
    const sourceType = result.metadata?.sourceType || "unknown";
    if (config.primary.includes(sourceType)) {
      primaryResults.push(result);
    } else if (config.secondary.includes(sourceType)) {
      secondaryResults.push(result);
    } else {
      otherResults.push(result);
    }
  }

  dbg(
    "slot allocation: primary=%d, secondary=%d, other=%d (cap=%d)",
    primaryResults.length,
    secondaryResults.length,
    otherResults.length,
    config.secondaryCap
  );

  // Allocate slots: primary first, then secondary up to cap
  const primarySlots = Math.max(0, limit - config.secondaryCap);
  const allocated = [
    ...primaryResults.slice(0, primarySlots),
    ...secondaryResults.slice(0, config.secondaryCap),
  ];

  // If we still have room, fill with remaining primary or secondary results
  // Do NOT fill with "other" results - those are outside the intent's scope
  const remaining = limit - allocated.length;
  if (remaining > 0) {
    const extras = [
      ...primaryResults.slice(primarySlots),
      ...secondaryResults.slice(config.secondaryCap),
    ];
    allocated.push(...extras.slice(0, remaining));
  }

  return allocated.slice(0, limit);
}

/**
 * Enforce balance across source types for general queries.
 *
 * Ensures no single source type dominates the results.
 * For example, prevents 9 hansard + 1 bill when the query
 * doesn't have a specific intent.
 *
 * @param results - Search results to balance
 * @param limit - Maximum results to return
 * @param maxRatio - Maximum ratio for any single source type (e.g., 0.4 = 40%)
 * @returns Balanced results respecting maxRatio per type
 */
export function enforceBalance<T extends SearchResult>(
  results: T[],
  limit: number,
  maxRatio: number
): T[] {
  const maxPerType = Math.floor(limit * maxRatio);
  const typeCounts: Record<string, number> = {};
  const balanced: T[] = [];
  const overflow: T[] = []; // Results that exceeded their type's quota

  // First pass: add results respecting maxPerType
  for (const result of results) {
    if (balanced.length >= limit) {
      break;
    }
    const sourceType = result.metadata?.sourceType || "unknown";
    const count = typeCounts[sourceType] || 0;
    if (count < maxPerType) {
      balanced.push(result);
      typeCounts[sourceType] = count + 1;
    } else {
      overflow.push(result);
    }
  }

  // Second pass: fill remaining slots with overflow if needed
  const remaining = limit - balanced.length;
  if (remaining > 0 && overflow.length > 0) {
    balanced.push(...overflow.slice(0, remaining));
  }

  dbg(
    "balance enforcement: %d results, maxPerType=%d, typeCounts=%o",
    balanced.length,
    maxPerType,
    typeCounts
  );

  return balanced;
}
