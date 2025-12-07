/**
 * Legislation Chunking
 *
 * Handles chunking of legislation sections for embedding.
 * Uses token-based chunking for accurate sizing with Cohere embeddings.
 *
 * Legal Structure Awareness:
 * Canadian legislation follows a hierarchical structure with markers:
 * - Subsections: (1), (2), (3) - numbered provisions
 * - Paragraphs: (a), (b), (c) - lettered items
 * - Subparagraphs: (i), (ii), (iii) - roman numerals
 * - Clauses: (A), (B), (C) - capital letters
 *
 * This module prefers splitting at these legal boundaries rather than
 * arbitrary sentence boundaries to preserve semantic coherence.
 */

import type { HistoricalNoteItem, Section } from "@/lib/db/legislation/schema";
import {
  countTokens,
  OVERLAP_TOKENS,
  TARGET_CHUNK_TOKENS,
} from "@/lib/rag/shared/chunking";

export type LegislationChunk = {
  content: string;
  chunkIndex: number;
  totalChunks: number;
};

export type ChunkSectionOptions = {
  /** Historical notes to append to section content for searchability */
  historicalNotes?: HistoricalNoteItem[] | null;
  /** Language for historical notes label (defaults to 'en') */
  language?: "en" | "fr";
};

/**
 * Legal marker hierarchy (highest to lowest priority for splitting):
 * 1. Subsections: (1), (2), (3), etc.
 * 2. Paragraphs: (a), (b), (c), etc.
 * 3. Subparagraphs: (i), (ii), (iii), (iv), etc.
 * 4. Clauses: (A), (B), (C), etc.
 */
export type LegalMarkerType =
  | "subsection"
  | "paragraph"
  | "subparagraph"
  | "clause";

export type LegalUnit = {
  content: string;
  markerType: LegalMarkerType | null;
  marker: string | null;
};

// Combined pattern to find any legal marker
// Matches: (1), (2), (a), (b), (i), (ii), (A), (B), etc.
const LEGAL_MARKER_REGEX =
  /(?:^|\s)(\(\d+\)|\([a-z]\)|\([ivxlcdm]+\)|\([A-Z]\))(?=\s|[A-Z])/g;

// Pre-compiled regex patterns for marker type identification (performance optimization)
const SUBSECTION_MARKER_REGEX = /^\d+$/;
const PARAGRAPH_MARKER_REGEX = /^[a-z]$/;
// Multi-character roman numerals (ii, iii, iv, vi, etc.) or single practical roman numerals (i, v, x)
// Note: Single c, d, l, m are treated as paragraphs (100, 500, 50, 1000 would be unrealistic subparagraph numbers)
const SUBPARAGRAPH_MULTI_REGEX =
  /^[ivx]{2,}$|^i{1,3}$|^iv$|^v$|^vi{0,3}$|^ix$|^x{1,3}$|^xi{0,3}$|^xiv$|^xv$/i;
const CLAUSE_MARKER_REGEX = /^[A-Z]$/;
const WHITESPACE_SPLIT_REGEX = /\s+/;

/**
 * Identify the type of a legal marker.
 * Canadian legislation uses:
 * - (1), (2), (3)... for subsections
 * - (a), (b), (c)... for paragraphs (lowercase letters)
 * - (i), (ii), (iii), (iv), (v)... for subparagraphs (roman numerals)
 * - (A), (B), (C)... for clauses (uppercase letters)
 */
export function identifyMarkerType(marker: string): LegalMarkerType | null {
  const inner = marker.slice(1, -1); // Remove parentheses

  if (SUBSECTION_MARKER_REGEX.test(inner)) {
    return "subsection";
  }
  // Check for common roman numeral patterns used in legislation (i-xv, typically up to 15)
  // Multi-char patterns like (ii), (iii), (iv) are clearly subparagraphs
  // Single (i), (v), (x) are also subparagraphs (common starting points: 1, 5, 10)
  if (SUBPARAGRAPH_MULTI_REGEX.test(inner)) {
    return "subparagraph";
  }
  // Single lowercase letters are paragraphs (including c, d, l, m which are technically
  // roman numerals but would represent 100, 500, 50, 1000 - unrealistic for subparagraphs)
  if (PARAGRAPH_MARKER_REGEX.test(inner)) {
    return "paragraph";
  }
  if (CLAUSE_MARKER_REGEX.test(inner)) {
    return "clause";
  }
  return null;
}

/**
 * Split text into legal units at marker boundaries.
 * Each unit starts with a legal marker (except possibly the first unit).
 */
export function splitIntoLegalUnits(text: string): LegalUnit[] {
  const units: LegalUnit[] = [];

  // Find all marker positions
  const markers: Array<{
    index: number;
    marker: string;
    type: LegalMarkerType | null;
  }> = [];

  // Reset regex state and find all markers
  LEGAL_MARKER_REGEX.lastIndex = 0;
  for (
    let match = LEGAL_MARKER_REGEX.exec(text);
    match !== null;
    match = LEGAL_MARKER_REGEX.exec(text)
  ) {
    const fullMatch = match[0];
    const marker = match[1];
    // Adjust index to point to the marker itself (skip leading whitespace)
    const markerIndex = match.index + fullMatch.indexOf(marker);
    const type = identifyMarkerType(marker);
    markers.push({ index: markerIndex, marker, type });
  }

  if (markers.length === 0) {
    // No legal markers found - return entire text as single unit
    return [{ content: text.trim(), markerType: null, marker: null }];
  }

  // Extract units between markers
  let lastIndex = 0;

  for (let i = 0; i < markers.length; i++) {
    const { index, marker, type } = markers[i];

    // Content before this marker (or first marker)
    if (index > lastIndex) {
      const beforeContent = text.slice(lastIndex, index).trim();
      if (beforeContent) {
        // This is preamble content or continuation from previous marker
        if (units.length === 0) {
          units.push({
            content: beforeContent,
            markerType: null,
            marker: null,
          });
        } else {
          // Append to previous unit
          const lastUnit = units.at(-1);
          if (lastUnit) {
            lastUnit.content += ` ${beforeContent}`;
          }
        }
      }
    }

    // Find end of this unit (start of next marker or end of text)
    const nextMarkerIndex =
      i + 1 < markers.length ? markers[i + 1].index : text.length;
    const unitContent = text.slice(index, nextMarkerIndex).trim();

    if (unitContent) {
      units.push({ content: unitContent, markerType: type, marker });
    }

    lastIndex = nextMarkerIndex;
  }

  return units;
}

/**
 * Chunk text by tokens while respecting legal boundaries.
 * Prefers splitting at legal marker boundaries rather than mid-provision.
 */
export function chunkLegalText(
  text: string,
  maxTokens: number = TARGET_CHUNK_TOKENS,
  overlapTokens: number = OVERLAP_TOKENS
): Array<{ content: string; index: number }> {
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

  // Split into legal units
  const units = splitIntoLegalUnits(cleanText);

  // Pre-compute token counts for all units
  const unitTokenCounts = units.map((u) => countTokens(u.content));

  const chunks: Array<{ content: string; index: number }> = [];
  let currentUnits: LegalUnit[] = [];
  let currentTokenCounts: number[] = [];
  let currentTokens = 0;
  let chunkIndex = 0;

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const unitTokens = unitTokenCounts[i];

    // If single unit exceeds max tokens, we need to force-split it
    if (unitTokens > maxTokens) {
      // Flush current chunk if any
      if (currentUnits.length > 0) {
        chunks.push({
          content: currentUnits
            .map((u) => u.content)
            .join(" ")
            .trim(),
          index: chunkIndex++,
        });
        currentUnits = [];
        currentTokenCounts = [];
        currentTokens = 0;
      }

      // Force-split the large unit by words
      const words = unit.content.split(WHITESPACE_SPLIT_REGEX);
      const wordTokenCounts = words.map((w) => countTokens(`${w} `));

      let wordChunk: string[] = [];
      let wordTokens = 0;

      for (let j = 0; j < words.length; j++) {
        const word = words[j];
        const wordTokenCount = wordTokenCounts[j];

        if (wordTokens + wordTokenCount > maxTokens && wordChunk.length > 0) {
          chunks.push({
            content: wordChunk.join(" ").trim(),
            index: chunkIndex++,
          });
          // Keep overlap
          const overlap = getOverlapWords(
            wordChunk,
            wordTokenCounts.slice(j - wordChunk.length, j),
            overlapTokens
          );
          wordChunk = overlap.words;
          wordTokens = overlap.tokens;
        }
        wordChunk.push(word);
        wordTokens += wordTokenCount;
      }

      if (wordChunk.length > 0) {
        currentUnits = [
          {
            content: wordChunk.join(" "),
            markerType: unit.markerType,
            marker: unit.marker,
          },
        ];
        currentTokenCounts = [wordTokens];
        currentTokens = wordTokens;
      }
      continue;
    }

    // Check if adding this unit would exceed the limit
    if (currentTokens + unitTokens > maxTokens && currentUnits.length > 0) {
      // Emit current chunk
      chunks.push({
        content: currentUnits
          .map((u) => u.content)
          .join(" ")
          .trim(),
        index: chunkIndex++,
      });

      // Start new chunk with overlap from end of previous
      const overlap = getOverlapUnits(
        currentUnits,
        currentTokenCounts,
        overlapTokens
      );
      currentUnits = overlap.units;
      currentTokenCounts = overlap.tokenCounts;
      currentTokens = overlap.totalTokens;
    }

    currentUnits.push(unit);
    currentTokenCounts.push(unitTokens);
    currentTokens += unitTokens;
  }

  // Don't forget the last chunk
  if (currentUnits.length > 0) {
    chunks.push({
      content: currentUnits
        .map((u) => u.content)
        .join(" ")
        .trim(),
      index: chunkIndex,
    });
  }

  return chunks;
}

/**
 * Get overlap units from the end that fit within the overlap token budget.
 * Prefers keeping complete legal units for context.
 */
function getOverlapUnits(
  units: LegalUnit[],
  tokenCounts: number[],
  overlapTokens: number
): { units: LegalUnit[]; tokenCounts: number[]; totalTokens: number } {
  const resultUnits: LegalUnit[] = [];
  const resultCounts: number[] = [];
  let tokens = 0;

  // Iterate from end to get overlap, preferring higher-priority markers
  for (let i = units.length - 1; i >= 0; i--) {
    const unitTokens = tokenCounts[i];
    if (tokens + unitTokens > overlapTokens) {
      break;
    }
    resultUnits.unshift(units[i]);
    resultCounts.unshift(unitTokens);
    tokens += unitTokens;
  }

  return { units: resultUnits, tokenCounts: resultCounts, totalTokens: tokens };
}

/**
 * Get overlap words from the end that fit within the overlap token budget.
 */
function getOverlapWords(
  words: string[],
  tokenCounts: number[],
  overlapTokens: number
): { words: string[]; tokens: number } {
  const resultWords: string[] = [];
  let tokens = 0;

  for (let i = words.length - 1; i >= 0; i--) {
    const wordTokens = tokenCounts[i] ?? countTokens(`${words[i]} `);
    if (tokens + wordTokens > overlapTokens) {
      break;
    }
    resultWords.unshift(words[i]);
    tokens += wordTokens;
  }

  return { words: resultWords, tokens };
}

/**
 * Format historical notes for inclusion in chunk content.
 * Makes amendment history searchable by embedding it in the content.
 */
export function formatHistoricalNotes(
  notes: HistoricalNoteItem[],
  language: "en" | "fr" = "en"
): string {
  if (!notes.length) {
    return "";
  }

  const label = language === "fr" ? "Historique" : "History";
  const enactedLabel = language === "fr" ? "édicté" : "enacted";
  const inForceLabel = language === "fr" ? "en vigueur" : "in force";
  const parts = notes
    .map((note) => {
      let text = note.text;
      // Add enacted date if available and different from text
      if (note.enactedDate && !note.text.includes(note.enactedDate)) {
        text += ` (${enactedLabel}: ${note.enactedDate})`;
      }
      // Add in force date if available and different from enacted date
      if (
        note.inForceStartDate &&
        note.inForceStartDate !== note.enactedDate &&
        !note.text.includes(note.inForceStartDate)
      ) {
        text += ` (${inForceLabel}: ${note.inForceStartDate})`;
      }
      return text;
    })
    .join("; ");

  return `\n\n${label}: ${parts}`;
}

/**
 * Chunk a legislation section for embedding.
 * Prepends document title and section label for context.
 * Optionally appends historical notes for amendment searchability.
 *
 * Uses legal-boundary-aware chunking that prefers splitting at subsection,
 * paragraph, subparagraph, and clause boundaries rather than mid-provision.
 * This preserves semantic coherence of legal text.
 */
export function chunkSection(
  section: Section,
  documentTitle: string,
  options?: ChunkSectionOptions
): LegislationChunk[] {
  // Context prefix for each chunk
  const prefix = `${documentTitle}\nSection ${section.sectionLabel}${
    section.marginalNote ? `: ${section.marginalNote}` : ""
  }`;

  // Build content with optional historical notes
  let sectionContent = section.content;
  if (options?.historicalNotes?.length) {
    const lang = options.language ?? "en";
    sectionContent += formatHistoricalNotes(options.historicalNotes, lang);
  }

  const fullContent = `${prefix}\n\n${sectionContent}`;

  // Check if content fits in a single chunk using token count
  const totalTokens = countTokens(fullContent);
  if (totalTokens <= TARGET_CHUNK_TOKENS) {
    return [{ content: fullContent, chunkIndex: 0, totalChunks: 1 }];
  }

  // Calculate token budget for content (subtract prefix tokens + buffer)
  const prefixTokens = countTokens(`${prefix}\n\n`);
  const contentBudget = TARGET_CHUNK_TOKENS - prefixTokens - 10; // 10 token buffer

  // Split large sections using legal-boundary-aware chunking
  // Prefers splitting at (1), (a), (i), (A) markers rather than mid-provision
  const chunks = chunkLegalText(sectionContent, contentBudget, OVERLAP_TOKENS);

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
