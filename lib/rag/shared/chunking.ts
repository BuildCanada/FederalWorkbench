/**
 * Shared Chunking Utilities
 *
 * Optimized for Cohere embed-multilingual-v3.0 (1024 dimensions)
 *
 * Uses gpt-tokenizer for accurate token counting. While Cohere uses its own
 * tokenizer, BPE tokenizers like cl100k_base provide a close approximation
 * and are more accurate than character-based estimates.
 *
 * Configuration:
 * - Target chunk size: 1536 tokens (optimal for embedding retrieval)
 * - Overlap: 256 tokens (~16% overlap for context continuity)
 * - Cohere max input: ~2048 tokens (we stay well under this)
 */
import { encode, isWithinTokenLimit } from "gpt-tokenizer";

// Precompiled regex patterns for performance
const WHITESPACE_REGEX = /\s+/;
const SENTENCE_SPLIT_REGEX = /(?<=[.!?])\s+/;

// Token-based configuration
export const TARGET_CHUNK_TOKENS = 1536; // Optimal for embedding models
export const OVERLAP_TOKENS = 256; // ~16% overlap

// Character-based fallbacks (for backward compatibility)
const CHARS_PER_TOKEN = 4; // Conservative estimate
export const CHUNK_SIZE_CHARS = TARGET_CHUNK_TOKENS * CHARS_PER_TOKEN; // 6144
export const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN; // 1024

// How far to search for sentence boundaries when breaking chunks
const SENTENCE_BOUNDARY_SEARCH_WINDOW = 200;

/**
 * Chunk representing a piece of content
 */
export type Chunk = {
  content: string;
  index: number;
};

/**
 * Normalize text for embedding consistency
 *
 * This normalization MUST be applied to content before storing so that
 * the stored content exactly matches what was used to generate the embedding.
 * This prevents semantic drift between stored content and its embedding.
 *
 * Normalization rules:
 * - Replace newlines with spaces (Cohere handles space-separated text better)
 * - Collapse multiple spaces to single space
 * - Trim leading/trailing whitespace
 *
 * @param text - The text to normalize
 * @returns Normalized text suitable for embedding
 */
export function normalizeForEmbedding(text: string): string {
  return text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Split text into overlapping chunks
 *
 * Uses a simple character-based approach with overlap to ensure concepts
 * spanning chunk boundaries are captured. Tries to break on sentence boundaries
 * when possible.
 *
 * Used for any long-form text content (bills, hansard statements, legislation sections, etc.)
 *
 * @param text - The text to chunk
 * @param chunkSize - Target chunk size in characters (default: 6144)
 * @param overlap - Overlap size in characters (default: 1024)
 * @returns Array of chunks with content and index
 */
export function chunkText(
  text: string,
  chunkSize: number = CHUNK_SIZE_CHARS,
  overlap: number = OVERLAP_CHARS
): Chunk[] {
  // Clean and normalize the text
  const cleanText = text
    .replace(/\r\n/g, "\n") // Normalize line endings
    .replace(/\n{3,}/g, "\n\n") // Collapse multiple newlines
    .trim();

  if (!cleanText) {
    return [];
  }

  // If text is smaller than chunk size, return as single chunk
  if (cleanText.length <= chunkSize) {
    return [
      {
        content: cleanText,
        index: 0,
      },
    ];
  }

  const chunks: Chunk[] = [];
  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < cleanText.length) {
    // Save position for progress check
    const prevStartIndex = startIndex;

    // Calculate end index for this chunk
    let endIndex = startIndex + chunkSize;

    // If this isn't the last chunk, try to break on sentence boundary
    if (endIndex < cleanText.length) {
      // Look for sentence endings near the target end index
      const searchStart = Math.max(
        startIndex,
        endIndex - SENTENCE_BOUNDARY_SEARCH_WINDOW
      );
      const searchText = cleanText.slice(
        searchStart,
        endIndex + SENTENCE_BOUNDARY_SEARCH_WINDOW
      );

      // Find the last sentence ending (period, exclamation, question mark followed by space or newline)
      const sentenceEndings = [...searchText.matchAll(/[.!?][\s\n]/g)];

      if (sentenceEndings.length > 0) {
        // Use the last sentence ending found
        const lastEnding = sentenceEndings.at(-1);
        if (lastEnding?.index !== undefined) {
          // Adjust endIndex to the position after the sentence ending
          endIndex = searchStart + lastEnding.index + 1;
        }
      }
    } else {
      // Last chunk - take everything remaining
      endIndex = cleanText.length;
    }

    // Extract chunk content
    const chunkContent = cleanText.slice(startIndex, endIndex).trim();

    if (chunkContent) {
      chunks.push({
        content: chunkContent,
        index: chunkIndex,
      });
      chunkIndex++;
    }

    // Move start index forward, accounting for overlap
    // For the next chunk, we back up by the overlap amount
    startIndex = endIndex - overlap;

    // Safety: if we're not making progress through the original text, break
    if (startIndex <= prevStartIndex) {
      break;
    }
  }

  return chunks;
}

/**
 * Count tokens accurately using gpt-tokenizer
 *
 * @param text - The text to count tokens for
 * @returns Actual token count
 */
export function countTokens(text: string): number {
  return encode(text).length;
}

/**
 * Check if text is within a token limit
 *
 * @param text - The text to check
 * @param limit - Maximum token count
 * @returns True if within limit
 */
export function isWithinLimit(text: string, limit: number): boolean {
  return isWithinTokenLimit(text, limit) !== false;
}

/**
 * Estimate token count from character count (deprecated - use countTokens instead)
 *
 * @param text - The text to estimate
 * @returns Approximate token count
 * @deprecated Use countTokens() for accurate token counting
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Split text into overlapping chunks based on token count
 *
 * Uses accurate token counting for precise chunk sizing. Pre-computes all
 * token counts once (O(n)) to avoid repeated encoding overhead.
 *
 * @param text - The text to chunk
 * @param maxTokens - Target chunk size in tokens (default: 1536)
 * @param overlapTokens - Overlap size in tokens (default: 256)
 * @returns Array of chunks with content and index
 */
export function chunkTextByTokens(
  text: string,
  maxTokens: number = TARGET_CHUNK_TOKENS,
  overlapTokens: number = OVERLAP_TOKENS
): Chunk[] {
  // Clean and normalize the text
  const cleanText = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleanText) {
    return [];
  }

  // Check if text fits in a single chunk
  const totalTokens = countTokens(cleanText);
  if (totalTokens <= maxTokens) {
    return [{ content: cleanText, index: 0 }];
  }

  const sentences = splitIntoSentences(cleanText);

  // Pre-compute all sentence token counts once - O(n) total
  const sentenceTokenCounts = sentences.map((s) => countTokens(s));

  const chunks: Chunk[] = [];
  let currentChunk: string[] = [];
  let currentChunkTokenCounts: number[] = [];
  let currentTokens = 0;
  let chunkIndex = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const sentenceTokens = sentenceTokenCounts[i];

    // If single sentence is too long, we need to force-split it
    if (sentenceTokens > maxTokens) {
      // First, flush current chunk if any
      if (currentChunk.length > 0) {
        chunks.push({
          content: currentChunk.join(" ").trim(),
          index: chunkIndex++,
        });
        currentChunk = [];
        currentChunkTokenCounts = [];
        currentTokens = 0;
      }

      // Split long sentence by words with pre-computed counts
      const words = sentence.split(WHITESPACE_REGEX);
      const wordTokenCounts = words.map((w) => countTokens(`${w} `));

      let wordChunk: string[] = [];
      let wordChunkTokenCounts: number[] = [];
      let wordTokens = 0;

      for (let j = 0; j < words.length; j++) {
        const word = words[j];
        const wordTokenCount = wordTokenCounts[j];

        if (wordTokens + wordTokenCount > maxTokens && wordChunk.length > 0) {
          chunks.push({
            content: wordChunk.join(" ").trim(),
            index: chunkIndex++,
          });
          // Keep overlap from end of previous chunk using pre-computed counts
          const overlap = getOverlapWithCounts(
            wordChunk,
            wordChunkTokenCounts,
            overlapTokens
          );
          wordChunk = overlap.items;
          wordChunkTokenCounts = overlap.tokenCounts;
          wordTokens = overlap.totalTokens;
        }
        wordChunk.push(word);
        wordChunkTokenCounts.push(wordTokenCount);
        wordTokens += wordTokenCount;
      }

      if (wordChunk.length > 0) {
        currentChunk = wordChunk;
        currentChunkTokenCounts = wordChunkTokenCounts;
        currentTokens = wordTokens;
      }
      continue;
    }

    // Check if adding this sentence would exceed the limit
    if (currentTokens + sentenceTokens > maxTokens && currentChunk.length > 0) {
      // Emit current chunk
      chunks.push({
        content: currentChunk.join(" ").trim(),
        index: chunkIndex++,
      });

      // Start new chunk with overlap from end of previous using pre-computed counts
      const overlap = getOverlapWithCounts(
        currentChunk,
        currentChunkTokenCounts,
        overlapTokens
      );
      currentChunk = overlap.items;
      currentChunkTokenCounts = overlap.tokenCounts;
      currentTokens = overlap.totalTokens;
    }

    currentChunk.push(sentence);
    currentChunkTokenCounts.push(sentenceTokens);
    currentTokens += sentenceTokens;
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push({
      content: currentChunk.join(" ").trim(),
      index: chunkIndex,
    });
  }

  return chunks;
}

/**
 * Split text into sentences (simple regex-based approach)
 */
function splitIntoSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace or end
  const parts = text.split(SENTENCE_SPLIT_REGEX);
  return parts.filter((s) => s.trim().length > 0);
}

/**
 * Get items from the end that fit within the overlap token budget.
 * Uses pre-computed token counts to avoid re-encoding (O(n) -> O(1) per call).
 *
 * @param items - Array of strings (sentences or words)
 * @param tokenCounts - Pre-computed token counts for each item
 * @param overlapTokens - Maximum tokens for overlap
 * @returns Object with overlap items, their counts, and total tokens
 */
function getOverlapWithCounts(
  items: string[],
  tokenCounts: number[],
  overlapTokens: number
): { items: string[]; tokenCounts: number[]; totalTokens: number } {
  const resultItems: string[] = [];
  const resultCounts: number[] = [];
  let tokens = 0;

  // Iterate from end to get overlap
  for (let i = items.length - 1; i >= 0; i--) {
    const itemTokens = tokenCounts[i];
    if (tokens + itemTokens > overlapTokens) {
      break;
    }
    resultItems.unshift(items[i]);
    resultCounts.unshift(itemTokens);
    tokens += itemTokens;
  }

  return { items: resultItems, tokenCounts: resultCounts, totalTokens: tokens };
}
