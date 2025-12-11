/**
 * Cross-Encoder Reranker for Legislation Search
 *
 * Uses Cohere's rerank-multilingual-v3.0 model to improve retrieval accuracy
 * by considering query-document pairs together, rather than comparing embeddings
 * separately. This is especially valuable for legal text where semantic nuance matters.
 */

import crypto from "node:crypto";
import { CohereClient } from "cohere-ai";
import { cacheGet, cacheSet } from "@/lib/cache/redis";
import {
  CACHE_TTL,
  isRagCacheDisabled,
  RERANKER_CONFIG,
} from "@/lib/rag/parliament/constants";
import { ragDebug } from "@/lib/rag/parliament/debug";
import type { LegislationSearchResult } from "./search";

const dbg = ragDebug("leg:rerank");

// Lazy-initialized Cohere client for better error messages
let _cohereClient: CohereClient | null = null;

/**
 * Get the Cohere client, initializing it on first use.
 * Throws a clear error if COHERE_API_KEY is not set.
 */
function getCohereClient(): CohereClient {
  if (!_cohereClient) {
    const apiKey = process.env.COHERE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "COHERE_API_KEY environment variable is required for legislation reranking. " +
          "Set it in your .env.local file or disable reranking in your search options."
      );
    }
    _cohereClient = new CohereClient({ token: apiKey });
  }
  return _cohereClient;
}

/**
 * Reranked search result with updated similarity score
 */
export type RerankedLegislationResult = LegislationSearchResult & {
  /** Original vector similarity score before reranking */
  originalSimilarity: number;
  /** Rerank relevance score (0-1, higher is better) */
  rerankScore: number;
};

/**
 * Rerank legislation search results using Cohere's cross-encoder model
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
export async function rerankLegislationResults(
  query: string,
  results: LegislationSearchResult[],
  topN: number = RERANKER_CONFIG.DEFAULT_TOP_N
): Promise<RerankedLegislationResult[]> {
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
        const parsed = JSON.parse(cached) as RerankedLegislationResult[];
        dbg("cache hit %s", cacheKey);
        return parsed;
      } catch {
        // ignore JSON parse errors, refetch
      }
    }
  }

  try {
    const response = await getCohereClient().v2.rerank({
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
    const reranked: RerankedLegislationResult[] = response.results.map((r) => ({
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
function buildRerankCacheKey(
  query: string,
  results: LegislationSearchResult[],
  topN: number
): string {
  // Include result metadata to ensure cache invalidation when results change
  const resultIds = results
    .map((r) => {
      const meta = r.metadata;
      return `${meta.sourceType}:${meta.actId ?? meta.regulationId ?? meta.termId ?? ""}:${meta.chunkIndex ?? 0}`;
    })
    .join(",");
  const hash = crypto
    .createHash("sha1")
    .update(`${query}|${resultIds}`)
    .digest("hex");
  return `leg:rerank:${topN}:${hash}`;
}

/**
 * Filter reranked results by minimum score threshold
 *
 * Uses RERANKER_CONFIG.MIN_RERANK_SCORE to filter out low-relevance results
 *
 * @param results - Reranked results to filter
 * @returns Results with rerankScore >= MIN_RERANK_SCORE
 */
export function filterByRerankScore(
  results: RerankedLegislationResult[]
): RerankedLegislationResult[] {
  return results.filter(
    (r) => r.rerankScore >= RERANKER_CONFIG.MIN_RERANK_SCORE
  );
}
