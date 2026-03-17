import { adaptiveFilter } from "./adaptive-filter";
import { RERANKER_CONFIG } from "./constants";
import { ragDebug } from "./debug";
import type { PriorityIntent } from "./query-analysis";
import {
  allocateCitationSlots,
  deduplicateResults,
  ensureSourceDiversity,
  getSlotConfig,
  rerankResults,
} from "./reranker";
import type { SearchResult } from "./search-utils";

const dbg = ragDebug("parl:reranking");

const HANSARD_PATTERN = /\b(hansard|debate|débat)\b/i;
const COMMITTEE_PATTERN = /\b(committee|comité)\b/i;

/**
 * Analysis context for reranking decisions
 */
export type RerankAnalysis = {
  intent?: string;
  priorityIntent?: PriorityIntent;
  language: "en" | "fr" | "unknown";
  originalQuery?: string;
};

/**
 * Deduplicate and rerank results using cross-encoder model
 *
 * This is the main entry point for reranking. It:
 * 1. Deduplicates results by (sourceId, chunkIndex)
 * 2. Applies cross-encoder reranking via Cohere's rerank-v3.5
 * 3. Falls back to heuristic scoring if reranking fails
 *
 * @param results - Search results to rerank
 * @param limit - Maximum number of results to return
 * @param analysis - Query analysis with language and intent
 * @returns Reranked and deduplicated results
 */
export async function deduplicateAndRerank<T extends SearchResult>(
  results: T[],
  limit: number,
  analysis: RerankAnalysis
): Promise<T[]> {
  if (results.length === 0) {
    return [];
  }

  // Step 1: Deduplicate
  const dedup = deduplicateResults(results);
  dbg("deduped %d -> %d results", results.length, dedup.length);

  // Step 2: Apply cross-encoder reranking
  const query = analysis.originalQuery ?? "";
  if (!query) {
    // No query to rerank against - use heuristic fallback
    return deduplicateAndRankHeuristic(results, limit, analysis);
  }

  try {
    // Request 3x limit from Cohere to ensure we have diverse source types
    // High-verbosity sources (hansard) often dominate semantic ranking
    const expandedLimit = Math.min(dedup.length, limit * 3);
    const reranked = await rerankResults(query, dedup, expandedLimit);

    // Ensure source type diversity - bring back underrepresented types
    // This prevents bill_focused queries from losing all bill results
    const diverse = ensureSourceDiversity(reranked, dedup, 2);

    // Apply slot allocation BEFORE adaptive filtering if we have a priority intent
    // This ensures intent-aligned results aren't filtered out by adaptive thresholds
    let slotAllocated = diverse;
    if (analysis.priorityIntent && analysis.priorityIntent !== "general") {
      const slotConfig = getSlotConfig(analysis.priorityIntent);
      // Get more candidates than needed - adaptive filter will trim
      slotAllocated = allocateCitationSlots(diverse, slotConfig, limit * 2);
      dbg(
        "slot allocation (pre-filter): intent=%s, diverse=%d -> allocated=%d",
        analysis.priorityIntent,
        diverse.length,
        slotAllocated.length
      );
    }

    // Apply adaptive filtering based on relative scores
    const filtered = adaptiveFilter(slotAllocated, {
      absoluteMinimum: RERANKER_CONFIG.MIN_RERANK_SCORE,
    });

    dbg(
      "reranked: %d results, diverse: %d, slotAlloc: %d, filtered: %d",
      reranked.length,
      diverse.length,
      slotAllocated.length,
      filtered.length
    );

    // Return with original type (strip rerank-specific fields for backward compat)
    return filtered.slice(0, limit) as T[];
  } catch (error) {
    dbg("cross-encoder reranking failed, using heuristic fallback: %O", error);
    return deduplicateAndRankHeuristic(results, limit, analysis);
  }
}

/**
 * Legacy heuristic-based reranking (fallback)
 *
 * Used when cross-encoder reranking fails or is unavailable.
 * Applies small additive boosts based on:
 * - Language match
 * - Query intent
 * - Source type keywords
 * - Recency
 *
 * @deprecated Prefer deduplicateAndRerank with cross-encoder
 */
export function deduplicateAndRankHeuristic<T extends SearchResult>(
  results: T[],
  limit: number,
  analysis: RerankAnalysis
): T[] {
  const seen = new Set<string>();
  const dedup = results.filter((r) => {
    // Include sourceType to prevent collisions between different source types
    // (e.g., bill ID 123 vs party ID 123)
    const key = `${r.metadata.sourceType}:${r.metadata.sourceId}:${r.metadata.chunkIndex ?? -1}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  const isFr = analysis.language === "fr";
  const scored = dedup.map((r) => {
    const langMatch = (r as any).metadata?.language === (isFr ? "fr" : "en");
    const langBoost = langMatch ? 0.12 : 0;
    const isMetadataChunk = (r.metadata?.chunkIndex ?? 1) === 0;
    const intentBoost =
      analysis.intent === "factual" && isMetadataChunk ? 0.03 : 0;

    let typeBoost = 0;
    const t = (r.metadata as any).sourceType as string;
    const q = analysis.originalQuery;
    const mentionsHansard = q ? HANSARD_PATTERN.test(q) : false;
    const mentionsCommittee = q ? COMMITTEE_PATTERN.test(q) : false;
    if (mentionsHansard && t === "hansard") {
      typeBoost += 0.03;
    }
    if (
      mentionsCommittee &&
      (t === "committee" ||
        t === "committee_report" ||
        t === "committee_meeting")
    ) {
      typeBoost += 0.03;
    }

    let recencyBoost = 0;
    const d = (r.metadata as any).billStatusDate || (r.metadata as any).date;
    if (typeof d === "string" && d >= "2022-01-01") {
      recencyBoost = 0.01;
    }

    return {
      r,
      score: r.similarity + langBoost + intentBoost + typeBoost + recencyBoost,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  // Map back to results with updated similarity for adaptive filtering
  const rankedResults = scored.map((s) => ({
    ...s.r,
    similarity: s.score, // Use boosted score for filtering
  }));

  // Apply adaptive filtering
  const filtered = adaptiveFilter(rankedResults);

  return filtered.slice(0, limit) as T[];
}

/**
 * Synchronous deduplication and heuristic ranking
 *
 * @deprecated Use deduplicateAndRerank for cross-encoder support
 */
export function deduplicateAndRank<T extends SearchResult>(
  results: T[],
  limit: number,
  analysis: RerankAnalysis
): T[] {
  return deduplicateAndRankHeuristic(results, limit, analysis);
}
