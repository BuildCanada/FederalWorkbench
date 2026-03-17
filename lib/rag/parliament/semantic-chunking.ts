/**
 * Semantic Chunking Module
 *
 * Implements document-structure-aware chunking for different content types.
 * Instead of arbitrary character-based splitting, this module respects
 * semantic boundaries like sections, parts, and speaker turns.
 *
 * This improves retrieval quality by:
 * 1. Keeping related content together
 * 2. Adding contextual headers so chunks are self-contained
 * 3. Breaking at meaningful boundaries (not mid-sentence)
 */

import {
  CHUNK_SIZE_CHARS,
  chunkText,
  OVERLAP_CHARS,
} from "@/lib/rag/shared/chunking";

// Regex for paragraph splitting (defined at module level for performance)
const PARAGRAPH_SPLIT_REGEX = /\n\n+/;

/**
 * Extended chunk with optional section context
 */
export type SemanticChunk = {
  content: string;
  index: number;
  /** Section/part identifier if available (e.g., "PART 1", "SUMMARY") */
  section?: string;
};

/**
 * Context to prepend to bill chunks
 */
export type BillContext = {
  number: string;
  nameEn?: string;
  nameFr?: string;
  sessionId?: string;
};

/**
 * Context to prepend to hansard chunks
 */
export type HansardContext = {
  speakerName?: string;
  date?: string;
  documentNumber?: string;
};

// ============================================================================
// BILL CHUNKING
// ============================================================================

/**
 * Split bill text into semantic sections based on document structure
 *
 * Bills have a hierarchical structure:
 * - Header (Parliament, Session info)
 * - RECOMMENDATION
 * - SUMMARY
 * - TABLE OF PROVISIONS
 * - PART 1, PART 2, etc. (each with sections and subsections)
 * - SCHEDULE(S)
 *
 * This function splits at major boundaries (PART, SUMMARY, etc.)
 * then applies size-based chunking within each section if needed.
 */
export function chunkBill(
  text: string,
  context?: BillContext,
  language: "en" | "fr" = "en"
): SemanticChunk[] {
  if (!text?.trim()) {
    return [];
  }

  const cleanText = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");

  // Define section markers in order of precedence
  const sectionMarkers = [
    { pattern: /^(PART\s+\d+(?:\s+.+)?)\s*$/gm, type: "PART" },
    { pattern: /^(DIVISION\s+\d+(?:\s+.+)?)\s*$/gm, type: "DIVISION" },
    { pattern: /^(SCHEDULE\s*\d*)\s*$/gim, type: "SCHEDULE" },
    { pattern: /^(SUMMARY)\s*$/gm, type: "SUMMARY" },
    { pattern: /^(RECOMMENDATION)\s*$/gm, type: "RECOMMENDATION" },
    { pattern: /^(TABLE OF PROVISIONS)\s*$/gm, type: "TABLE" },
    { pattern: /^(SHORT TITLE)\s*$/gm, type: "SHORT_TITLE" },
    { pattern: /^(INTERPRETATION)\s*$/gm, type: "INTERPRETATION" },
  ];

  // Find all section boundaries
  const boundaries: Array<{ index: number; section: string; type: string }> =
    [];

  for (const { pattern, type } of sectionMarkers) {
    // Reset lastIndex for each pattern
    pattern.lastIndex = 0;
    let match = pattern.exec(cleanText);
    while (match !== null) {
      boundaries.push({
        index: match.index,
        section: match[1].trim(),
        type,
      });
      match = pattern.exec(cleanText);
    }
  }

  // Sort boundaries by position
  boundaries.sort((a, b) => a.index - b.index);

  // If no boundaries found, fall back to regular chunking
  if (boundaries.length === 0) {
    return chunkWithContext(cleanText, context, language);
  }

  const chunks: SemanticChunk[] = [];

  // Handle content before first section (header, preamble)
  if (boundaries[0].index > 100) {
    const headerContent = cleanText.slice(0, boundaries[0].index).trim();
    if (headerContent) {
      const headerChunks = chunkWithContext(
        headerContent,
        context,
        language,
        "PREAMBLE"
      );
      chunks.push(...headerChunks);
    }
  }

  // Process each section
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].index;
    const end = boundaries[i + 1]?.index ?? cleanText.length;
    const sectionContent = cleanText.slice(start, end).trim();

    if (sectionContent) {
      const sectionChunks = chunkWithContext(
        sectionContent,
        context,
        language,
        boundaries[i].section
      );
      chunks.push(...sectionChunks);
    }
  }

  // Re-index chunks sequentially
  return chunks.map((chunk, index) => ({ ...chunk, index }));
}

/**
 * Apply size-based chunking with contextual header
 */
function chunkWithContext(
  text: string,
  context: BillContext | undefined,
  language: "en" | "fr",
  section?: string
): SemanticChunk[] {
  // Build contextual header
  const headerParts: string[] = [];

  if (context?.number) {
    const label = language === "fr" ? "Projet de loi" : "Bill";
    headerParts.push(`${label} ${context.number}`);
  }

  const name = language === "fr" ? context?.nameFr : context?.nameEn;
  if (name) {
    headerParts.push(name);
  }

  if (context?.sessionId) {
    const label = language === "fr" ? "Session" : "Session";
    headerParts.push(`${label}: ${context.sessionId}`);
  }

  if (section) {
    headerParts.push(section);
  }

  const header = headerParts.length > 0 ? `${headerParts.join(" | ")}\n\n` : "";

  // If content with header fits in one chunk, return as-is
  const fullContent = `${header}${text}`;
  if (fullContent.length <= CHUNK_SIZE_CHARS) {
    return [{ content: fullContent, index: 0, section }];
  }

  // Otherwise, chunk the content and prepend header to each
  const rawChunks = chunkText(
    text,
    CHUNK_SIZE_CHARS - header.length,
    OVERLAP_CHARS
  );

  return rawChunks.map((chunk) => ({
    content: header + chunk.content,
    index: chunk.index,
    section,
  }));
}

// ============================================================================
// HANSARD CHUNKING
// ============================================================================

/**
 * Chunk hansard statement with speaker context
 *
 * Hansard statements are already per-speaker, but long speeches
 * may need to be split. This ensures each chunk has speaker context.
 */
export function chunkHansard(
  text: string,
  context?: HansardContext,
  language: "en" | "fr" = "en"
): SemanticChunk[] {
  if (!text?.trim()) {
    return [];
  }

  const cleanText = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    // Strip HTML tags that may be in hansard content
    .replace(/<\/?p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();

  // Build contextual header
  const headerParts: string[] = [];

  if (context?.speakerName) {
    const label = language === "fr" ? "Intervenant" : "Speaker";
    headerParts.push(`${label}: ${context.speakerName}`);
  }

  if (context?.date) {
    headerParts.push(context.date);
  }

  if (context?.documentNumber) {
    const label = language === "fr" ? "Débat nº" : "Debate #";
    headerParts.push(`${label}${context.documentNumber}`);
  }

  const header = headerParts.length > 0 ? `${headerParts.join(" | ")}\n\n` : "";

  // If content with header fits in one chunk, return as-is
  const fullContent = `${header}${cleanText}`;
  if (fullContent.length <= CHUNK_SIZE_CHARS) {
    return [{ content: fullContent, index: 0 }];
  }

  // Try to split at paragraph boundaries first
  const paragraphs = cleanText.split(PARAGRAPH_SPLIT_REGEX);

  if (paragraphs.length > 1) {
    return chunkByParagraphs(paragraphs, header);
  }

  // Fall back to sentence-aware character chunking
  const rawChunks = chunkText(
    cleanText,
    CHUNK_SIZE_CHARS - header.length,
    OVERLAP_CHARS
  );

  return rawChunks.map((chunk) => ({
    content: header + chunk.content,
    index: chunk.index,
  }));
}

/**
 * Group paragraphs into chunks that fit size limit
 */
function chunkByParagraphs(
  paragraphs: string[],
  header: string
): SemanticChunk[] {
  const chunks: SemanticChunk[] = [];
  let currentContent = "";
  let chunkIndex = 0;
  const maxContentSize = CHUNK_SIZE_CHARS - header.length;

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) {
      continue;
    }

    // If adding this paragraph exceeds limit, save current and start new
    if (
      currentContent &&
      currentContent.length + trimmedPara.length + 2 > maxContentSize
    ) {
      chunks.push({
        content: header + currentContent.trim(),
        index: chunkIndex++,
      });
      currentContent = "";
    }

    // If single paragraph is too large, chunk it
    if (trimmedPara.length > maxContentSize) {
      if (currentContent) {
        chunks.push({
          content: header + currentContent.trim(),
          index: chunkIndex++,
        });
        currentContent = "";
      }

      const subChunks = chunkText(trimmedPara, maxContentSize, OVERLAP_CHARS);
      for (const sub of subChunks) {
        chunks.push({
          content: header + sub.content,
          index: chunkIndex++,
        });
      }
    } else {
      currentContent += (currentContent ? "\n\n" : "") + trimmedPara;
    }
  }

  // Don't forget the last chunk
  if (currentContent.trim()) {
    chunks.push({
      content: header + currentContent.trim(),
      index: chunkIndex,
    });
  }

  return chunks;
}

// ============================================================================
// GENERIC SEMANTIC CHUNKING
// ============================================================================

/**
 * Generic semantic chunking with optional context header
 *
 * Use this for content that doesn't have specific structure patterns
 * but should still have contextual headers.
 */
export function chunkWithHeader(
  text: string,
  header: string,
  chunkSize: number = CHUNK_SIZE_CHARS,
  overlap: number = OVERLAP_CHARS
): SemanticChunk[] {
  if (!text?.trim()) {
    return [];
  }

  const cleanText = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const fullHeader = header ? `${header}\n\n` : "";
  const fullContent = `${fullHeader}${cleanText}`;

  // If fits in one chunk, return as-is
  if (fullContent.length <= chunkSize) {
    return [{ content: fullContent, index: 0 }];
  }

  // Chunk content with header prepended to each
  const maxContentSize = chunkSize - fullHeader.length;
  const rawChunks = chunkText(cleanText, maxContentSize, overlap);

  return rawChunks.map((chunk) => ({
    content: fullHeader + chunk.content,
    index: chunk.index,
  }));
}
