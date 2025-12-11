/**
 * Legislation Context Builder
 *
 * Builds context prompts from search results for LLM consumption.
 * Includes deduplication, reranking, and citation formatting.
 */

import { RERANKER_CONFIG } from "@/lib/rag/parliament/constants";
import { ragDebug } from "@/lib/rag/parliament/debug";
import type { LegislationCitation } from "./citations";
import type { HydratedLegislationSource } from "./hydrate";
import {
  filterByRerankScore,
  type RerankedLegislationResult,
  rerankLegislationResults,
} from "./reranker";
import type { LegislationSearchResult } from "./search";

const dbg = ragDebug("leg:context");

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

/**
 * Reranker function type for dependency injection
 * Takes query, results, topN and returns reranked results
 */
export type RerankerFn = (
  query: string,
  results: LegislationSearchResult[],
  topN: number
) => Promise<RerankedLegislationResult[]>;

type BuildContextOptions = {
  language: "en" | "fr" | "unknown";
  topN?: number;
  /** Optional reranker function for testing. Defaults to Cohere cross-encoder. */
  reranker?: RerankerFn;
};

/**
 * Deduplicate results by unique identifier
 * Prefers higher similarity scores when duplicates are found.
 * Handles all source types: act, act_section, regulation, regulation_section,
 * defined_term, preamble, treaty, cross_reference, table_of_provisions,
 * signature_block, related_provisions, footnote, marginal_note, schedule,
 * publication_item
 */
function deduplicateResults(
  results: LegislationSearchResult[]
): LegislationSearchResult[] {
  const seen = new Map<string, LegislationSearchResult>();

  for (const r of results) {
    const meta = r.metadata;
    let key: string;

    // Build unique key based on source type and identifying fields
    switch (meta.sourceType) {
      case "act":
        key = `act:${meta.actId}:meta:${meta.chunkIndex ?? 0}`;
        break;
      case "act_section":
        key = `act_section:${meta.actId}:${meta.sectionId ?? ""}:${meta.chunkIndex ?? 0}`;
        break;
      case "regulation":
        key = `reg:${meta.regulationId}:meta:${meta.chunkIndex ?? 0}`;
        break;
      case "regulation_section":
        key = `reg_section:${meta.regulationId}:${meta.sectionId ?? ""}:${meta.chunkIndex ?? 0}`;
        break;
      case "defined_term":
        key = `term:${meta.termId ?? ""}:${meta.actId ?? meta.regulationId ?? ""}`;
        break;
      case "preamble":
        key = `preamble:${meta.actId ?? ""}:${meta.preambleIndex ?? 0}`;
        break;
      case "treaty":
        key = `treaty:${meta.actId ?? meta.regulationId ?? ""}:${meta.treatyTitle ?? ""}`;
        break;
      case "cross_reference":
        // Include language to distinguish EN/FR versions
        key = `xref:${meta.crossRefId ?? ""}:${meta.language ?? ""}`;
        break;
      case "table_of_provisions":
        // Batched per document - one ToP embedding per document+language
        key = `toc:${meta.actId ?? meta.regulationId ?? ""}:${meta.language ?? ""}`;
        break;
      case "signature_block":
        key = `sig:${meta.actId ?? meta.regulationId ?? ""}:${meta.signatureName ?? ""}`;
        break;
      case "related_provisions":
        // Unique per document + provision label/source
        key = `relprov:${meta.actId ?? meta.regulationId ?? ""}:${meta.relatedProvisionLabel ?? meta.relatedProvisionSource ?? ""}:${meta.language ?? ""}`;
        break;
      case "footnote":
        // Unique per document + section + footnote ID
        key = `footnote:${meta.actId ?? meta.regulationId ?? ""}:${meta.sectionId ?? meta.sectionLabel ?? ""}:${meta.footnoteId ?? ""}:${meta.language ?? ""}`;
        break;
      case "marginal_note":
        // Unique per section + language
        key = `marginal:${meta.actId ?? meta.regulationId ?? ""}:${meta.sectionId ?? ""}:${meta.language ?? ""}`;
        break;
      case "schedule":
        // Unique per schedule section (uses sectionId like act_section/regulation_section)
        key = `schedule:${meta.actId ?? meta.regulationId ?? ""}:${meta.sectionId ?? ""}:${meta.chunkIndex ?? 0}`;
        break;
      case "publication_item":
        // Unique per publication item (recommendation/notice) in a regulation
        key = `pub:${meta.actId ?? meta.regulationId ?? ""}:${meta.publicationType ?? ""}:${meta.publicationIndex ?? 0}:${meta.language ?? ""}`;
        break;
      default:
        // Fallback for any future types
        key = `${meta.sourceType}:${meta.actId ?? meta.regulationId ?? "unknown"}:${meta.chunkIndex ?? 0}`;
    }

    const existing = seen.get(key);
    if (!existing || r.similarity > existing.similarity) {
      seen.set(key, r);
    }
  }

  return Array.from(seen.values());
}

/**
 * Rerank and limit results using Cohere cross-encoder
 *
 * Uses cross-encoder reranking for more accurate relevance scoring,
 * then filters by minimum rerank score and limits to topN.
 */
async function rerankAndLimitResults(
  query: string,
  results: LegislationSearchResult[],
  topN: number
): Promise<RerankedLegislationResult[]> {
  if (results.length === 0) {
    return [];
  }

  dbg("reranking %d results for query: %s", results.length, query);

  // Rerank using Cohere cross-encoder
  const reranked = await rerankLegislationResults(query, results, topN);

  // Filter by minimum rerank score
  const filtered = filterByRerankScore(reranked);

  dbg("after rerank: %d results (filtered from %d)", filtered.length, topN);

  return filtered;
}

/**
 * Build context from search results
 *
 * Steps:
 * 1. Deduplicate by section/chunk
 * 2. Rerank using Cohere cross-encoder for better accuracy
 * 3. Format for LLM with citations
 */
export async function buildLegislationContext(
  query: string,
  results: LegislationSearchResult[],
  opts: BuildContextOptions
): Promise<LegislationContext> {
  const { language, topN = RERANKER_CONFIG.DEFAULT_TOP_N, reranker } = opts;

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

  // Deduplicate first to reduce reranking cost
  const unique = deduplicateResults(results);

  // Rerank using injected reranker or default Cohere cross-encoder
  const sorted = reranker
    ? await reranker(query, unique, topN)
    : await rerankAndLimitResults(query, unique, topN);

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
