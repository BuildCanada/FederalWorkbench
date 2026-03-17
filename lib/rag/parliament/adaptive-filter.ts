/**
 * Adaptive Filtering Module
 *
 * Implements confidence-based filtering that uses relative thresholds
 * instead of fixed absolute thresholds. This handles queries that
 * naturally produce lower similarity scores without discarding
 * potentially useful results.
 *
 * The key insight: a result at 0.35 might be excellent if the top result
 * is 0.40, but poor if the top result is 0.90.
 */

import { ADAPTIVE_FILTER_CONFIG } from "./constants";
import { ragDebug } from "./debug";
import type { SearchResult } from "./search-utils";

const dbg = ragDebug("parl:filter");

/**
 * Filter results using adaptive (relative) thresholds
 *
 * Instead of a fixed threshold, keeps results that are within a
 * configurable ratio of the top score. This handles cases where:
 * - Obscure queries produce uniformly low but valid scores
 * - Popular queries produce high scores with clear differentiation
 *
 * @param results - Search results sorted by score (highest first)
 * @param options - Optional override configuration
 * @returns Filtered results based on relative scoring
 */
export function adaptiveFilter<T extends SearchResult>(
  results: T[],
  options?: {
    /** Override the relative threshold ratio (default: 0.7) */
    relativeThreshold?: number;
    /** Override the absolute minimum score (default: 0.05) */
    absoluteMinimum?: number;
    /** Override the minimum results count (default: 3) */
    minimumResults?: number;
  }
): T[] {
  if (results.length === 0) {
    return [];
  }

  const {
    relativeThreshold = ADAPTIVE_FILTER_CONFIG.RELATIVE_THRESHOLD_RATIO,
    absoluteMinimum = ADAPTIVE_FILTER_CONFIG.ABSOLUTE_MINIMUM_SCORE,
    minimumResults = ADAPTIVE_FILTER_CONFIG.MINIMUM_RESULTS,
  } = options ?? {};

  // Get the top score to calculate relative threshold
  const topScore = results[0].similarity;

  // Calculate the adaptive threshold: percentage of top score
  const adaptiveThreshold = topScore * relativeThreshold;

  // Use the higher of adaptive threshold and absolute minimum
  const effectiveThreshold = Math.max(adaptiveThreshold, absoluteMinimum);

  // Filter results above the threshold
  const filtered = results.filter((r) => r.similarity >= effectiveThreshold);

  // Ensure we return at least minimumResults if available
  const minCount = Math.min(minimumResults, results.length);
  const finalResults =
    filtered.length >= minCount ? filtered : results.slice(0, minCount);

  dbg(
    "adaptive filter: top=%.3f, threshold=%.3f (%.0f%%), %d -> %d results",
    topScore,
    effectiveThreshold,
    relativeThreshold * 100,
    results.length,
    finalResults.length
  );

  return finalResults;
}

/**
 * Calculate the score gap between results
 *
 * Useful for detecting natural clustering in scores.
 * A large gap may indicate a semantic boundary between relevant and irrelevant results.
 *
 * @param results - Search results sorted by score
 * @returns Array of gaps between consecutive scores
 */
export function calculateScoreGaps<T extends SearchResult>(
  results: T[]
): number[] {
  if (results.length < 2) {
    return [];
  }

  const gaps: number[] = [];
  for (let i = 0; i < results.length - 1; i++) {
    gaps.push(results[i].similarity - results[i + 1].similarity);
  }

  return gaps;
}

/**
 * Find natural cutoff based on score gaps
 *
 * Looks for the largest gap in scores, which may indicate a natural
 * boundary between highly relevant and less relevant results.
 *
 * @param results - Search results sorted by score
 * @param minResults - Minimum results to keep even if gap found earlier
 * @returns Index of the cutoff point (exclusive)
 */
export function findNaturalCutoff<T extends SearchResult>(
  results: T[],
  minResults: number = ADAPTIVE_FILTER_CONFIG.MINIMUM_RESULTS
): number {
  if (results.length <= minResults) {
    return results.length;
  }

  const gaps = calculateScoreGaps(results);
  if (gaps.length === 0) {
    return results.length;
  }

  // Find the largest gap, but only consider gaps after minResults
  let maxGap = 0;
  let maxGapIndex = -1;

  for (let i = minResults - 1; i < gaps.length; i++) {
    if (gaps[i] > maxGap) {
      maxGap = gaps[i];
      maxGapIndex = i;
    }
  }

  // Only use gap-based cutoff if the gap is significant (> 0.05)
  if (maxGap > 0.05 && maxGapIndex >= 0) {
    dbg("natural cutoff at index %d (gap: %.3f)", maxGapIndex + 1, maxGap);
    return maxGapIndex + 1;
  }

  return results.length;
}

/**
 * Combined adaptive filter using both relative threshold and gap detection
 *
 * This is the recommended function for most use cases. It applies:
 * 1. Relative threshold filtering (keep results within X% of top score)
 * 2. Gap-based natural cutoff detection
 * 3. Minimum results guarantee
 *
 * @param results - Search results sorted by score
 * @param options - Configuration options
 * @returns Filtered results
 */
export function smartFilter<T extends SearchResult>(
  results: T[],
  options?: {
    relativeThreshold?: number;
    absoluteMinimum?: number;
    minimumResults?: number;
    useGapDetection?: boolean;
  }
): T[] {
  if (results.length === 0) {
    return [];
  }

  const { useGapDetection = true, ...filterOptions } = options ?? {};

  // First apply adaptive threshold filtering
  let filtered = adaptiveFilter(results, filterOptions);

  // Optionally apply gap-based cutoff
  if (useGapDetection && filtered.length > 0) {
    const cutoff = findNaturalCutoff(
      filtered,
      filterOptions?.minimumResults ?? ADAPTIVE_FILTER_CONFIG.MINIMUM_RESULTS
    );
    if (cutoff < filtered.length) {
      filtered = filtered.slice(0, cutoff);
    }
  }

  return filtered;
}
