/**
 * Legislation Chunking
 *
 * Handles chunking of legislation sections for embedding.
 * Uses token-based chunking for accurate sizing with Cohere embeddings.
 */

import type { Section } from "@/lib/db/legislation/schema";
import {
  chunkTextByTokens,
  countTokens,
  OVERLAP_TOKENS,
  TARGET_CHUNK_TOKENS,
} from "@/lib/rag/shared/chunking";

export type LegislationChunk = {
  content: string;
  chunkIndex: number;
  totalChunks: number;
};

/**
 * Chunk a legislation section for embedding.
 * Prepends document title and section label for context.
 * Uses token-based chunking for accurate sizing.
 */
export function chunkSection(
  section: Section,
  documentTitle: string
): LegislationChunk[] {
  // Context prefix for each chunk
  const prefix = `${documentTitle}\nSection ${section.sectionLabel}${
    section.marginalNote ? `: ${section.marginalNote}` : ""
  }`;

  const fullContent = `${prefix}\n\n${section.content}`;

  // Check if content fits in a single chunk using token count
  const totalTokens = countTokens(fullContent);
  if (totalTokens <= TARGET_CHUNK_TOKENS) {
    return [{ content: fullContent, chunkIndex: 0, totalChunks: 1 }];
  }

  // Calculate token budget for content (subtract prefix tokens + buffer)
  const prefixTokens = countTokens(`${prefix}\n\n`);
  const contentBudget = TARGET_CHUNK_TOKENS - prefixTokens - 10; // 10 token buffer

  // Split large sections using token-based chunking
  const chunks = chunkTextByTokens(
    section.content,
    contentBudget,
    OVERLAP_TOKENS
  );

  return chunks.map((chunk, idx) => ({
    content: `${prefix}\n\n${chunk.content}`,
    chunkIndex: idx,
    totalChunks: chunks.length,
  }));
}

/**
 * Check if section should be skipped (only truly empty sections)
 * We embed everything including repealed sections - they're part of the legal record.
 */
export function shouldSkipSection(section: Section): boolean {
  if (!section.content?.trim()) {
    return true;
  }
  return false;
}
