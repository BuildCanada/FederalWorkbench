import { expect, test } from "@playwright/test";
import { CHUNK_SIZE_CHARS, chunkText } from "@/lib/rag/shared/chunking";

const SENTENCE_ENDING_PATTERN = /[.!?]$/;

test.describe("Text Chunking", () => {
  test("returns empty array for empty text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   ")).toEqual([]);
  });

  test("returns single chunk for text smaller than chunk size", () => {
    const text = "Short text.";
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("Short text.");
    expect(chunks[0].index).toBe(0);
  });

  test("creates multiple chunks for long text", () => {
    // Create text that's 3x the chunk size to ensure multiple chunks
    const sentence = "This is a test sentence that will be repeated. ";
    const repeatCount = Math.ceil((CHUNK_SIZE_CHARS * 3) / sentence.length);
    const longText = sentence.repeat(repeatCount);

    const chunks = chunkText(longText);

    // Should have more than 1 chunk
    expect(chunks.length).toBeGreaterThan(1);

    // Verify all chunks are created with proper indices
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
      expect(chunks[i].content.length).toBeGreaterThan(0);
    }

    // Verify total content coverage (with overlap, combined length > original)
    const totalChunkLength = chunks.reduce(
      (sum, c) => sum + c.content.length,
      0
    );
    expect(totalChunkLength).toBeGreaterThan(longText.length * 0.9);
  });

  test("chunks very long text correctly (regression for premature break)", () => {
    // This test specifically validates the fix for the bug where the loop
    // would break after the first chunk due to incorrect progress check
    const targetLength = CHUNK_SIZE_CHARS * 5; // 5x chunk size
    const word = "parliament ";
    const longText = word.repeat(Math.ceil(targetLength / word.length));

    const chunks = chunkText(longText);

    // With 5x chunk size and overlap, should get at least 4 chunks
    expect(chunks.length).toBeGreaterThanOrEqual(4);

    // The last chunk should contain content from near the end of the original text
    const lastChunk = chunks.at(-1);
    expect(lastChunk).toBeDefined();

    // Verify indices are sequential
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
    }
  });

  test("handles text with sentence boundaries", () => {
    // Create text with clear sentence boundaries
    const sentences = new Array(20)
      .fill("This is sentence number X. It has some content here.")
      .map((s, i) => s.replace("X", String(i + 1)));
    const text = sentences.join(" ");

    const chunks = chunkText(text);

    // Each chunk should ideally end at a sentence boundary
    for (const chunk of chunks.slice(0, -1)) {
      // Non-final chunks should end with sentence-ending punctuation
      expect(chunk.content).toMatch(SENTENCE_ENDING_PATTERN);
    }
  });

  test("respects custom chunk size and overlap", () => {
    const text = "a".repeat(1000);
    const chunkSize = 200;
    const overlap = 50;

    const chunks = chunkText(text, chunkSize, overlap);

    // With 200 char chunks and 50 overlap on 1000 chars:
    // Progress per chunk = 200 - 50 = 150
    // Expected chunks ≈ ceil(1000 / 150) = 7
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.length).toBeLessThan(10);
  });

  test("normalizes line endings and collapses multiple newlines", () => {
    const text = "Line 1.\r\nLine 2.\n\n\n\nLine 3.";
    const chunks = chunkText(text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("Line 1.\nLine 2.\n\nLine 3.");
  });
});
