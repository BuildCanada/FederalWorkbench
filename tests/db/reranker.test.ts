import { expect, test } from "@playwright/test";
import type { ResourceMetadata } from "@/lib/db/rag/schema";
import {
  allocateCitationSlots,
  deduplicateResults,
  enforceBalance,
  getSlotConfig,
} from "@/lib/rag/parliament/reranker";
import type { SearchResult } from "@/lib/rag/parliament/search-utils";

/**
 * Helper to create a mock SearchResult with the given metadata
 */
function createMockResult(
  metadata: Partial<ResourceMetadata> &
    Pick<ResourceMetadata, "sourceType" | "sourceId">
): SearchResult<ResourceMetadata> {
  return {
    content: `Content for ${metadata.sourceType} ${metadata.sourceId}`,
    metadata: {
      chunkIndex: 0,
      ...metadata,
    } as ResourceMetadata,
    similarity: 0.9,
  };
}

test.describe("deduplicateResults", () => {
  test("does not deduplicate results with same sourceId but different sourceType", () => {
    // This is the regression test for the cross-type collision bug
    // A bill with ID 123 should NOT be deduplicated with a party with ID 123
    const results: SearchResult<ResourceMetadata>[] = [
      createMockResult({ sourceType: "bill", sourceId: 123 }),
      createMockResult({ sourceType: "party", sourceId: 123 }),
      createMockResult({ sourceType: "politician", sourceId: 123 }),
    ];

    const deduped = deduplicateResults(results);

    // All three should be preserved since they have different sourceTypes
    expect(deduped).toHaveLength(3);
    expect(deduped.map((r) => r.metadata.sourceType)).toEqual([
      "bill",
      "party",
      "politician",
    ]);
  });

  test("deduplicates results with same sourceType, sourceId, and chunkIndex", () => {
    const results: SearchResult<ResourceMetadata>[] = [
      createMockResult({ sourceType: "bill", sourceId: 123, chunkIndex: 0 }),
      createMockResult({ sourceType: "bill", sourceId: 123, chunkIndex: 0 }), // duplicate
      createMockResult({ sourceType: "bill", sourceId: 456, chunkIndex: 0 }),
    ];

    const deduped = deduplicateResults(results);

    expect(deduped).toHaveLength(2);
    expect(deduped.map((r) => r.metadata.sourceId)).toEqual([123, 456]);
  });

  test("preserves results with same sourceType and sourceId but different chunkIndex", () => {
    const results: SearchResult<ResourceMetadata>[] = [
      createMockResult({ sourceType: "bill", sourceId: 123, chunkIndex: 0 }),
      createMockResult({ sourceType: "bill", sourceId: 123, chunkIndex: 1 }),
      createMockResult({ sourceType: "bill", sourceId: 123, chunkIndex: 2 }),
    ];

    const deduped = deduplicateResults(results);

    expect(deduped).toHaveLength(3);
    expect(deduped.map((r) => r.metadata.chunkIndex)).toEqual([0, 1, 2]);
  });

  test("returns empty array for empty input", () => {
    const deduped = deduplicateResults([]);
    expect(deduped).toEqual([]);
  });

  test("preserves order of first occurrence when deduplicating", () => {
    const results: SearchResult<ResourceMetadata>[] = [
      createMockResult({ sourceType: "bill", sourceId: 1 }),
      createMockResult({ sourceType: "party", sourceId: 2 }),
      createMockResult({ sourceType: "bill", sourceId: 1 }), // duplicate, should be removed
      createMockResult({ sourceType: "hansard", sourceId: 3 }),
    ];

    const deduped = deduplicateResults(results);

    expect(deduped).toHaveLength(3);
    expect(
      deduped.map((r) => ({
        type: r.metadata.sourceType,
        id: r.metadata.sourceId,
      }))
    ).toEqual([
      { type: "bill", id: 1 },
      { type: "party", id: 2 },
      { type: "hansard", id: 3 },
    ]);
  });

  test("handles string sourceId correctly", () => {
    // Some source types like session use string IDs (e.g., "45-1")
    const results: SearchResult<ResourceMetadata>[] = [
      createMockResult({ sourceType: "session", sourceId: "45-1" }),
      createMockResult({ sourceType: "session", sourceId: "45-1" }), // duplicate
      createMockResult({ sourceType: "session", sourceId: "44-2" }),
    ];

    const deduped = deduplicateResults(results);

    expect(deduped).toHaveLength(2);
    expect(deduped.map((r) => r.metadata.sourceId)).toEqual(["45-1", "44-2"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Citation Slot Allocation Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe("getSlotConfig", () => {
  test("returns bill_focused config with bill and vote as primary", () => {
    const config = getSlotConfig("bill_focused");
    expect(config.primary).toContain("bill");
    expect(config.primary).toContain("vote_question");
    expect(config.secondary).toContain("hansard");
    expect(config.secondaryCap).toBe(2);
  });

  test("returns vote_focused config with vote types as primary", () => {
    const config = getSlotConfig("vote_focused");
    expect(config.primary).toContain("vote_question");
    expect(config.primary).toContain("vote_member");
    expect(config.primary).toContain("vote_party");
    expect(config.secondaryCap).toBe(1);
  });

  test("returns mp_info config with no secondary sources", () => {
    const config = getSlotConfig("mp_info");
    expect(config.primary).toContain("politician");
    expect(config.primary).toContain("riding");
    expect(config.secondary).toHaveLength(0);
    expect(config.secondaryCap).toBe(0);
  });

  test("returns general config with empty primary (no preference)", () => {
    const config = getSlotConfig("general");
    expect(config.primary).toHaveLength(0);
    expect(config.secondaryCap).toBe(10);
  });
});

test.describe("allocateCitationSlots", () => {
  test("prioritizes primary sources for bill_focused intent", () => {
    // Simulate search results: 5 hansard, 2 bills, 2 votes
    const results: SearchResult<ResourceMetadata>[] = [
      createMockResult({ sourceType: "hansard", sourceId: 1 }),
      createMockResult({ sourceType: "hansard", sourceId: 2 }),
      createMockResult({ sourceType: "bill", sourceId: 10 }),
      createMockResult({ sourceType: "hansard", sourceId: 3 }),
      createMockResult({ sourceType: "vote_question", sourceId: 20 }),
      createMockResult({ sourceType: "hansard", sourceId: 4 }),
      createMockResult({ sourceType: "bill", sourceId: 11 }),
      createMockResult({ sourceType: "hansard", sourceId: 5 }),
      createMockResult({ sourceType: "vote_question", sourceId: 21 }),
    ];

    const config = getSlotConfig("bill_focused");
    const allocated = allocateCitationSlots(results, config, 5);

    // Should prioritize bills and votes, with max 2 hansard
    expect(allocated).toHaveLength(5);

    // Count by type
    const types = allocated.map((r) => r.metadata.sourceType);
    const hansardCount = types.filter((t) => t === "hansard").length;
    const billCount = types.filter((t) => t === "bill").length;
    const voteCount = types.filter((t) => t === "vote_question").length;

    expect(billCount).toBeGreaterThanOrEqual(1);
    expect(voteCount).toBeGreaterThanOrEqual(1);
    expect(hansardCount).toBeLessThanOrEqual(2); // secondaryCap = 2
  });

  test("excludes hansard for mp_info intent", () => {
    const results: SearchResult<ResourceMetadata>[] = [
      createMockResult({ sourceType: "hansard", sourceId: 1 }),
      createMockResult({ sourceType: "politician", sourceId: 10 }),
      createMockResult({ sourceType: "hansard", sourceId: 2 }),
      createMockResult({ sourceType: "riding", sourceId: 20 }),
      createMockResult({ sourceType: "party", sourceId: 30 }),
      createMockResult({ sourceType: "hansard", sourceId: 3 }),
    ];

    const config = getSlotConfig("mp_info");
    const allocated = allocateCitationSlots(results, config, 5);

    // Should only include politician, riding, party (primary sources)
    // No hansard (not in primary or secondary for mp_info)
    // Will only get 3 results since we only have 3 primary sources
    expect(allocated).toHaveLength(3);
    const types = allocated.map((r) => r.metadata.sourceType);
    expect(types).not.toContain("hansard");
    expect(types).toContain("politician");
    expect(types).toContain("riding");
    expect(types).toContain("party");
  });

  test("returns empty array for empty input", () => {
    const config = getSlotConfig("bill_focused");
    const allocated = allocateCitationSlots([], config, 10);
    expect(allocated).toEqual([]);
  });

  test("uses enforceBalance for general intent", () => {
    // For general intent with diverse results, balance is enforced
    const results: SearchResult<ResourceMetadata>[] = [
      createMockResult({ sourceType: "hansard", sourceId: 1 }),
      createMockResult({ sourceType: "hansard", sourceId: 2 }),
      createMockResult({ sourceType: "hansard", sourceId: 3 }),
      createMockResult({ sourceType: "bill", sourceId: 10 }),
      createMockResult({ sourceType: "bill", sourceId: 11 }),
      createMockResult({ sourceType: "vote_question", sourceId: 20 }),
      createMockResult({ sourceType: "vote_question", sourceId: 21 }),
      createMockResult({ sourceType: "politician", sourceId: 30 }),
    ];

    const config = getSlotConfig("general");
    const allocated = allocateCitationSlots(results, config, 6);

    // With diverse results and 40% max per type, no type should dominate
    expect(allocated).toHaveLength(6);
    const types = allocated.map((r) => r.metadata.sourceType);
    const hansardCount = types.filter((t) => t === "hansard").length;
    const billCount = types.filter((t) => t === "bill").length;
    // Each type should be limited (40% of 6 = 2)
    expect(hansardCount).toBeLessThanOrEqual(2);
    expect(billCount).toBeLessThanOrEqual(2);
  });
});

test.describe("enforceBalance", () => {
  test("limits each source type to maxRatio in first pass", () => {
    // With enough diverse results, no type should exceed ratio
    const results: SearchResult<ResourceMetadata>[] = [
      createMockResult({ sourceType: "hansard", sourceId: 1 }),
      createMockResult({ sourceType: "hansard", sourceId: 2 }),
      createMockResult({ sourceType: "hansard", sourceId: 3 }),
      createMockResult({ sourceType: "bill", sourceId: 10 }),
      createMockResult({ sourceType: "bill", sourceId: 11 }),
      createMockResult({ sourceType: "bill", sourceId: 12 }),
      createMockResult({ sourceType: "vote_question", sourceId: 20 }),
      createMockResult({ sourceType: "vote_question", sourceId: 21 }),
      createMockResult({ sourceType: "politician", sourceId: 30 }),
      createMockResult({ sourceType: "politician", sourceId: 31 }),
    ];

    // Limit 6, maxRatio 0.4 = max 2 per type
    const balanced = enforceBalance(results, 6, 0.4);

    expect(balanced).toHaveLength(6);
    const types = balanced.map((r) => r.metadata.sourceType);
    const hansardCount = types.filter((t) => t === "hansard").length;
    const billCount = types.filter((t) => t === "bill").length;
    expect(hansardCount).toBeLessThanOrEqual(2);
    expect(billCount).toBeLessThanOrEqual(2);
  });

  test("preserves all results when no type exceeds ratio", () => {
    const results: SearchResult<ResourceMetadata>[] = [
      createMockResult({ sourceType: "hansard", sourceId: 1 }),
      createMockResult({ sourceType: "bill", sourceId: 10 }),
      createMockResult({ sourceType: "vote_question", sourceId: 20 }),
      createMockResult({ sourceType: "politician", sourceId: 30 }),
    ];

    const balanced = enforceBalance(results, 4, 0.4);

    expect(balanced).toHaveLength(4);
    expect(balanced.map((r) => r.metadata.sourceType)).toEqual([
      "hansard",
      "bill",
      "vote_question",
      "politician",
    ]);
  });

  test("fills remaining slots with overflow results", () => {
    const results: SearchResult<ResourceMetadata>[] = [
      createMockResult({ sourceType: "hansard", sourceId: 1 }),
      createMockResult({ sourceType: "hansard", sourceId: 2 }),
      createMockResult({ sourceType: "hansard", sourceId: 3 }),
    ];

    // Limit 3, maxRatio 0.4 = max 1 per type, but only 1 type present
    // Should fill with overflow
    const balanced = enforceBalance(results, 3, 0.4);

    expect(balanced).toHaveLength(3);
  });

  test("returns empty array for empty input", () => {
    const balanced = enforceBalance([], 10, 0.4);
    expect(balanced).toEqual([]);
  });
});
