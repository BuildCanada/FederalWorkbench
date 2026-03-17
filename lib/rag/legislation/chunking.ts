/**
 * Legislation Chunking
 *
 * Handles chunking of legislation sections for embedding.
 * Reuses shared chunking utilities.
 */

import type { Section } from "@/lib/db/legislation/schema";
import {
  CHUNK_SIZE_CHARS,
  chunkText,
  OVERLAP_CHARS,
} from "@/lib/rag/shared/chunking";

export type LegislationChunk = {
  content: string;
  chunkIndex: number;
  totalChunks: number;
};

/**
 * Chunk a legislation section for embedding.
 * Prepends document title and section label for context.
 */
export function chunkSection(
  section: Section,
  documentTitle: string
): LegislationChunk[] {
  // Simple context prefix
  const prefix = `${documentTitle}\nSection ${section.sectionLabel}${
    section.marginalNote ? `: ${section.marginalNote}` : ""
  }`;

  const fullContent = `${prefix}\n\n${section.content}`;

  // Single chunk if small enough
  if (fullContent.length <= CHUNK_SIZE_CHARS) {
    return [{ content: fullContent, chunkIndex: 0, totalChunks: 1 }];
  }

  // Split large sections
  const chunks = chunkText(
    section.content,
    CHUNK_SIZE_CHARS - prefix.length - 50,
    OVERLAP_CHARS
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
