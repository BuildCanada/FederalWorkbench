/**
 * Shared Chunking Utilities
 *
 * Token approximation: 1 token ≈ 4 characters (conservative estimate)
 * Target chunk size: 1000-1500 tokens = 4000-6000 characters
 * Overlap: 200 tokens = 800 characters
 */
const CHARS_PER_TOKEN = 4;
const TARGET_CHUNK_SIZE_TOKENS = 1200; // Middle of 1000-1500 range
const OVERLAP_TOKENS = 200;

export const CHUNK_SIZE_CHARS = TARGET_CHUNK_SIZE_TOKENS * CHARS_PER_TOKEN; // 4800
export const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN; // 800

/**
 * Chunk representing a piece of content
 */
export type Chunk = {
  content: string;
  index: number;
};

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
 * @param chunkSize - Target chunk size in characters (default: 4800)
 * @param overlap - Overlap size in characters (default: 800)
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
      const searchStart = Math.max(startIndex, endIndex - 200); // Look back up to 200 chars
      const searchText = cleanText.slice(searchStart, endIndex + 200); // Look ahead up to 200 chars

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
 * Estimate token count from character count
 *
 * @param text - The text to estimate
 * @returns Approximate token count
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
