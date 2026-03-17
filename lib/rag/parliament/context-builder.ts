import type { ParliamentSearchResult } from "@/lib/rag/parliament/search";

/**
 * Citation ID prefix for parliament context.
 * Used to avoid collision with legislation citations when both RAG systems are enabled.
 * Parliament uses "P" prefix (e.g., [P1], [P2]).
 */
export const PARLIAMENT_CITATION_PREFIX = "P";

export type BuiltCitation = {
  id: number; // numeric part of citation (1, 2, 3...)
  prefixedId: string; // prefixed ID for display (P1, P2, P3...)
  textEn: string;
  textFr: string;
  urlEn?: string;
  urlFr?: string;
  titleEn?: string;
  titleFr?: string;
  type: string;
};

export type BuiltContext = {
  language: "en" | "fr" | "unknown";
  prompt: string; // compact, cited text to feed the model
  citations: BuiltCitation[];
};

type BuildOptions = {
  language: "en" | "fr" | "unknown";
};

export function buildContext(
  results: ParliamentSearchResult[],
  opts: BuildOptions
): BuiltContext {
  // Trust the reranker - use all results in their ranked order
  // The cross-encoder reranker already selected the most relevant results

  // Build citations list and prompt body
  const citations: BuiltCitation[] = [];
  const lines: string[] = [];
  const seenSnippets = new Set<string>();
  let id = 1;
  for (const r of results) {
    // Extract and normalize snippet first to check for duplicates
    const raw = r.content.replace(/\s+/g, " ");
    const max = 480;
    let cut = raw.slice(0, max);
    const lastPunct = Math.max(
      cut.lastIndexOf(". "),
      cut.lastIndexOf("? "),
      cut.lastIndexOf("! ")
    );
    if (lastPunct > 200) {
      cut = cut.slice(0, lastPunct + 1);
    }
    const normalized = cut.toLowerCase();

    // Skip duplicates entirely - don't create citation or increment id
    if (seenSnippets.has(normalized)) {
      continue;
    }
    seenSnippets.add(normalized);

    // Only add citation and line for non-duplicate snippets
    const prefixedId = `${PARLIAMENT_CITATION_PREFIX}${id}`;
    citations.push({
      id,
      prefixedId,
      textEn: r.citation.textEn,
      textFr: r.citation.textFr,
      urlEn: r.citation.urlEn,
      urlFr: r.citation.urlFr,
      titleEn: r.citation.titleEn,
      titleFr: r.citation.titleFr,
      type: r.metadata.sourceType,
    });

    const title =
      (opts.language === "fr"
        ? r.citation.titleFr || r.citation.titleEn
        : r.citation.titleEn || r.citation.titleFr) ||
      (r.metadata as any).title ||
      ((opts.language === "fr"
        ? (r.metadata as any).nameFr
        : (r.metadata as any).nameEn) as string | undefined);
    const date = (r.metadata as any).date as string | undefined;
    const label = [title, date].filter(Boolean).join(" — ");
    const prefix = label ? `${label} — ` : "";
    lines.push(
      `- [${prefixedId}] (${r.metadata.sourceType}) ${prefix}${cut}${raw.length > cut.length ? "…" : ""}`
    );
    id++;
  }

  const preface =
    opts.language === "fr"
      ? "Contexte pertinent (FR):"
      : "Relevant context (EN):";
  const sourcesLabel = opts.language === "fr" ? "Sources:" : "Sources:";

  const prompt = [
    preface,
    lines.length ? lines.join("\n") : "",
    "",
    sourcesLabel,
    ...citations.map((c) => {
      const text = opts.language === "fr" ? c.textFr : c.textEn;
      const title = opts.language === "fr" ? c.titleFr : c.titleEn;
      const url = opts.language === "fr" ? c.urlFr : c.urlEn;
      const urlPart = url ? ` (${url})` : "";
      return `  [${c.prefixedId}] ${text}${title ? ` — ${title}` : ""}${urlPart}`;
    }),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    language: opts.language,
    prompt,
    citations,
  };
}
