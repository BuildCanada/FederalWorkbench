import { expect, test } from "@playwright/test";
import { HYBRID_SEARCH_CONFIG } from "@/lib/rag/parliament/constants";

/**
 * Regression tests for hybrid search functionality.
 *
 * The hybrid search combines vector similarity with keyword matching (ts_rank).
 * These tests verify the configuration is correct and that the keyword component
 * can contribute to scoring.
 */
test.describe("Hybrid Search Configuration", () => {
  test("hybrid weights sum to 1.0 for proper normalization", () => {
    const { VECTOR_WEIGHT, KEYWORD_WEIGHT } = HYBRID_SEARCH_CONFIG;

    // Weights should sum to 1.0 for proper score normalization
    expect(VECTOR_WEIGHT + KEYWORD_WEIGHT).toBe(1.0);
  });

  test("keyword weight is non-zero to enable hybrid search", () => {
    const { KEYWORD_WEIGHT } = HYBRID_SEARCH_CONFIG;

    // If KEYWORD_WEIGHT is 0, ts_rank would never contribute to scoring
    expect(KEYWORD_WEIGHT).toBeGreaterThan(0);
    expect(KEYWORD_WEIGHT).toBe(0.3); // Current config value
  });

  test("vector weight is the dominant factor", () => {
    const { VECTOR_WEIGHT, KEYWORD_WEIGHT } = HYBRID_SEARCH_CONFIG;

    // Vector similarity should be the primary ranking factor
    expect(VECTOR_WEIGHT).toBeGreaterThan(KEYWORD_WEIGHT);
    expect(VECTOR_WEIGHT).toBe(0.7); // Current config value
  });

  test("exact match boost is configured", () => {
    const { EXACT_MATCH_BOOST } = HYBRID_SEARCH_CONFIG;

    // Exact keyword matches should get a boost
    expect(EXACT_MATCH_BOOST).toBeGreaterThan(0);
  });
});

test.describe("Hybrid Score Calculation", () => {
  test("keyword-only match can produce non-zero score", () => {
    const { VECTOR_WEIGHT, KEYWORD_WEIGHT } = HYBRID_SEARCH_CONFIG;

    // Simulate a case where vector similarity is at threshold (0.4) but keyword matches perfectly (1.0)
    const vectorSimilarity = 0.4; // Minimum threshold
    const keywordRank = 1.0; // Perfect keyword match

    const hybridScore =
      VECTOR_WEIGHT * vectorSimilarity + KEYWORD_WEIGHT * keywordRank;

    // With keyword contributing, score should be higher than just vector
    expect(hybridScore).toBeGreaterThan(vectorSimilarity * VECTOR_WEIGHT);
    expect(hybridScore).toBeCloseTo(0.4 * 0.7 + 1.0 * 0.3, 5); // 0.28 + 0.3 = 0.58
  });

  test("keyword boost can elevate results above vector-only score", () => {
    const { VECTOR_WEIGHT, KEYWORD_WEIGHT } = HYBRID_SEARCH_CONFIG;

    // Two documents with same vector similarity but different keyword relevance
    const vectorSimilarity = 0.6;

    const docWithoutKeyword =
      VECTOR_WEIGHT * vectorSimilarity + KEYWORD_WEIGHT * 0;
    const docWithKeyword =
      VECTOR_WEIGHT * vectorSimilarity + KEYWORD_WEIGHT * 0.8;

    // Keyword match should boost the score
    expect(docWithKeyword).toBeGreaterThan(docWithoutKeyword);
    expect(docWithKeyword - docWithoutKeyword).toBeCloseTo(0.3 * 0.8, 5); // 0.24 boost
  });

  test("pure semantic match still scores well", () => {
    const { VECTOR_WEIGHT, KEYWORD_WEIGHT } = HYBRID_SEARCH_CONFIG;

    // Document with high vector similarity but no keyword match
    const vectorSimilarity = 0.9;
    const keywordRank = 0;

    const hybridScore =
      VECTOR_WEIGHT * vectorSimilarity + KEYWORD_WEIGHT * keywordRank;

    // Should still be a high score due to vector weight
    expect(hybridScore).toBeCloseTo(0.63, 2); // 0.9 * 0.7 = 0.63
    expect(hybridScore).toBeGreaterThan(0.5);
  });
});
