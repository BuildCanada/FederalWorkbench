/**
 * Legislation Context Builder
 *
 * Builds context prompts from search results for LLM consumption.
 * Includes deduplication and citation formatting.
 */

import { RERANKER_CONFIG } from "@/lib/rag/parliament/constants";
import type { LegislationCitation } from "./citations";
import type { HydratedLegislationSource } from "./hydrate";
import type { LegislationSearchResult } from "./search";

/**
 * Citation ID prefix for legislation context.
 * Used to avoid collision with parliament citations when both RAG systems are enabled.
 * Legislation uses "L" prefix (e.g., [L1], [L2]).
 */
export const LEGISLATION_CITATION_PREFIX = "L";

/**
 * Built context with prompt, citations, and hydrated sources
 */
export type LegislationContext = {
  language: "en" | "fr" | "unknown";
  prompt: string;
  citations: LegislationCitation[];
  hydratedSources: HydratedLegislationSource[];
};

type BuildContextOptions = {
  language: "en" | "fr" | "unknown";
  topN?: number;
};

/**
 * Deduplicate results by unique identifier
 * Prefers higher similarity scores when duplicates are found
 */
function deduplicateResults(
  results: LegislationSearchResult[]
): LegislationSearchResult[] {
  const seen = new Map<string, LegislationSearchResult>();

  for (const r of results) {
    // Build unique key from metadata
    const key =
      r.metadata.sourceType === "act" || r.metadata.sourceType === "act_section"
        ? `act:${r.metadata.actId}:${r.metadata.sectionId ?? "meta"}:${r.metadata.chunkIndex ?? 0}`
        : `reg:${r.metadata.regulationId}:${r.metadata.sectionId ?? "meta"}:${r.metadata.chunkIndex ?? 0}`;

    const existing = seen.get(key);
    if (!existing || r.similarity > existing.similarity) {
      seen.set(key, r);
    }
  }

  return Array.from(seen.values());
}

/**
 * Sort and limit results by similarity score
 * TODO: Add Cohere cross-encoder reranking for better accuracy
 */
function sortAndLimitResults(
  results: LegislationSearchResult[],
  topN: number
): LegislationSearchResult[] {
  if (results.length === 0) {
    return [];
  }

  // Sort by similarity descending and take top N
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, topN);
}

/**
 * Build context from search results
 *
 * Steps:
 * 1. Deduplicate by section/chunk
 * 2. Rerank using cross-encoder
 * 3. Format for LLM with citations
 */
export function buildLegislationContext(
  _query: string,
  results: LegislationSearchResult[],
  opts: BuildContextOptions
): LegislationContext {
  const { language, topN = RERANKER_CONFIG.DEFAULT_TOP_N } = opts;

  if (results.length === 0) {
    return {
      language,
      prompt:
        language === "fr"
          ? "Aucun résultat législatif trouvé."
          : "No legislative results found.",
      citations: [],
      hydratedSources: [],
    };
  }

  // Deduplicate and sort by similarity
  const unique = deduplicateResults(results);
  const sorted = sortAndLimitResults(unique, topN);

  // Build context lines and citations
  const citations: LegislationCitation[] = [];
  const lines: string[] = [];
  const seenSnippets = new Set<string>();

  for (const r of sorted) {
    // Truncate content to ~480 chars, ending at sentence boundary if possible
    const raw = r.content.replace(/\s+/g, " ");
    const maxLen = 480;
    let cut = raw.slice(0, maxLen);
    const lastPunct = Math.max(
      cut.lastIndexOf(". "),
      cut.lastIndexOf("? "),
      cut.lastIndexOf("! ")
    );
    if (lastPunct > 200) {
      cut = cut.slice(0, lastPunct + 1);
    }

    // Skip duplicates
    const normalized = cut.toLowerCase();
    if (seenSnippets.has(normalized)) {
      continue;
    }
    seenSnippets.add(normalized);

    // Update citation ID and add with prefixed ID
    const id = citations.length + 1;
    const prefixedId = `${LEGISLATION_CITATION_PREFIX}${id}`;
    const citation: LegislationCitation = {
      ...r.citation,
      id,
      prefixedId,
    };
    citations.push(citation);

    // Format line
    const title = language === "fr" ? citation.titleFr : citation.titleEn;
    const sectionLabel = r.metadata.sectionLabel;
    const sectionPart = sectionLabel
      ? language === "fr"
        ? `, art ${sectionLabel}`
        : `, s ${sectionLabel}`
      : "";
    const marginalNote = r.metadata.marginalNote
      ? ` (${r.metadata.marginalNote})`
      : "";
    const label = `${title}${sectionPart}${marginalNote}`;
    const suffix = raw.length > cut.length ? "…" : "";

    lines.push(
      `- [${citation.prefixedId}] (${r.metadata.sourceType}) ${label}\n  ${cut}${suffix}`
    );
  }

  // Build prompt
  const preface =
    language === "fr" ? "Contexte législatif:" : "Legislative context:";
  const sourcesLabel = "Sources:";

  const prompt = [
    preface,
    lines.length ? lines.join("\n\n") : "",
    "",
    sourcesLabel,
    ...citations.map((c) => {
      const text = language === "fr" ? c.textFr : c.textEn;
      const url = language === "fr" ? c.urlFr : c.urlEn;
      return `  [${c.prefixedId}] ${text} (${url})`;
    }),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    language,
    prompt,
    citations,
    hydratedSources: [], // Populated by getLegislationContext after context building
  };
}
