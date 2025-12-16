"use client";

import { BookOpenIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DefinedTermsResponse } from "@/app/(chat)/api/legislation/defined-terms/route";
import type { DefinedTermItem } from "@/lib/db/legislation/queries";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";

type DefinedTermsPanelProps = {
  docType: "act" | "regulation";
  docId: string;
  language: "en" | "fr";
  sectionLabel: string;
  partLabel?: string;
};

// Module-level cache for defined terms requests
// Key: "docType:docId:language:sectionLabel:partLabel"
// Value: Promise<DefinedTermItem[]> or DefinedTermItem[]
const termsCache = new Map<
  string,
  Promise<DefinedTermItem[]> | DefinedTermItem[]
>();

function getCacheKey(opts: {
  docType: string;
  docId: string;
  language: string;
  sectionLabel: string;
  partLabel?: string;
}): string {
  return `${opts.docType}:${opts.docId}:${opts.language}:${opts.sectionLabel}:${opts.partLabel || ""}`;
}

// Pre-compiled regex patterns for performance
const TRAILING_PARENS_PATTERN = /\s*\(\s*\)\s*$/g;
const MULTI_SPACE_PATTERN = /\s+/g;
const MEANS_PATTERN = /^(.+?)\s+means\s+(.+)$/i;
const LEADING_NUMBER_PATTERN = /^\d+\s*/;

/**
 * Parse a definition to extract the French term and clean definition.
 *
 * The raw definition often has the pattern:
 *   "{englishTerm} {frenchTerm} means {definition}"
 * e.g., "applicant demandeur means the person who..."
 *
 * This extracts the French term so we can display it separately in italics.
 */
function parseDefinition(
  englishTerm: string,
  rawDefinition: string
): { frenchTerm: string | null; definition: string } {
  const cleaned = rawDefinition
    .replace(TRAILING_PARENS_PATTERN, "")
    .replace(MULTI_SPACE_PATTERN, " ")
    .trim();

  const meansMatch = cleaned.match(MEANS_PATTERN);
  if (!meansMatch) {
    return { frenchTerm: null, definition: cleaned };
  }

  const beforeMeans = meansMatch[1];
  const afterMeans = meansMatch[2];
  const termLower = englishTerm.toLowerCase();
  const beforeLower = beforeMeans.toLowerCase();

  if (beforeLower.startsWith(termLower)) {
    let frenchPart = beforeMeans.slice(englishTerm.length).trim();
    frenchPart = frenchPart.replace(LEADING_NUMBER_PATTERN, "").trim();
    const capitalizedDef =
      afterMeans.charAt(0).toUpperCase() + afterMeans.slice(1);
    const cleanDef = capitalizedDef.replace(TRAILING_PARENS_PATTERN, "").trim();

    if (frenchPart) {
      return {
        frenchTerm: frenchPart,
        definition: cleanDef,
      };
    }

    return { frenchTerm: null, definition: cleanDef };
  }

  return { frenchTerm: null, definition: cleaned };
}

/**
 * Truncate definition text for preview, parsing out French term first.
 */
function truncateDefinition(
  englishTerm: string,
  rawDefinition: string,
  maxLength = 70
): { frenchTerm: string | null; preview: string } {
  const { frenchTerm, definition } = parseDefinition(
    englishTerm,
    rawDefinition
  );
  const preview =
    definition.length <= maxLength
      ? definition
      : `${definition.slice(0, maxLength).trim()}...`;
  return { frenchTerm, preview };
}

/**
 * Get a clean scope label based on scopeType.
 * We don't use scopeRawText because it often contains malformed/concatenated data.
 */
function getScopeLabel(scopeType: string, language: "en" | "fr"): string {
  switch (scopeType) {
    case "act":
      return language === "fr" ? "Loi entière" : "Entire Act";
    case "regulation":
      return language === "fr" ? "Règlement entier" : "Entire Regulation";
    case "part":
      return language === "fr" ? "Cette partie" : "This Part";
    case "section":
      return language === "fr" ? "Cette section" : "This Section";
    default:
      return language === "fr" ? "Portée limitée" : "Limited scope";
  }
}

function TermRow({
  term,
  isExpanded,
  onToggle,
  language,
}: {
  term: DefinedTermItem;
  isExpanded: boolean;
  onToggle: () => void;
  language: "en" | "fr";
}) {
  const scopeLabel = getScopeLabel(term.scopeType, language);
  const { definition } = parseDefinition(term.term, term.definition);
  const { frenchTerm, preview } = truncateDefinition(
    term.term,
    term.definition
  );

  const ariaLabel =
    language === "fr"
      ? `${isExpanded ? "Réduire" : "Développer"} la définition de ${term.term}`
      : `${isExpanded ? "Collapse" : "Expand"} definition for ${term.term}`;

  return (
    <Collapsible onOpenChange={onToggle} open={isExpanded}>
      <CollapsibleTrigger
        aria-label={ariaLabel}
        className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/50"
      >
        {isExpanded ? (
          <ChevronDownIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <span className="font-medium text-sm">{term.term}</span>
          {frenchTerm && (
            <span className="ml-1 text-muted-foreground text-sm italic">
              ({frenchTerm})
            </span>
          )}
          {!isExpanded && (
            <span className="ml-2 text-muted-foreground text-sm">
              {preview}
            </span>
          )}
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-1 mb-3 ml-6 rounded-md border bg-muted/30 p-3">
          <p className="text-sm leading-relaxed">{definition}</p>
          <p className="mt-2 text-muted-foreground text-xs italic">
            {term.sectionLabel ? (
              <>
                {language === "fr"
                  ? `Défini à l'article ${term.sectionLabel}`
                  : `Defined in Section ${term.sectionLabel}`}
                {" · "}
              </>
            ) : null}
            {scopeLabel}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function DefinedTermsPanel({
  docType,
  docId,
  language,
  sectionLabel,
  partLabel,
}: DefinedTermsPanelProps) {
  const [terms, setTerms] = useState<DefinedTermItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedTermId, setExpandedTermId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = getCacheKey({
      docType,
      docId,
      language,
      sectionLabel,
      partLabel,
    });

    async function fetchTerms() {
      setIsLoading(true);
      setError(null);

      try {
        const cached = termsCache.get(cacheKey);
        if (cached) {
          // If it's a promise, await it; if it's data, use directly
          const cachedTerms = await cached;
          if (!cancelled) {
            setTerms(cachedTerms);
            setIsLoading(false);
          }
          return;
        }

        // Create the fetch promise and cache it immediately to prevent duplicate requests
        const fetchPromise = (async () => {
          const params = new URLSearchParams({
            docType,
            docId,
            language,
            sectionLabel,
          });
          if (partLabel) {
            params.set("partLabel", partLabel);
          }

          const res = await fetch(`/api/legislation/defined-terms?${params}`);
          if (!res.ok) {
            throw new Error(`Failed to fetch defined terms: ${res.status}`);
          }
          const data: DefinedTermsResponse = await res.json();
          return data.terms;
        })();

        termsCache.set(cacheKey, fetchPromise);

        const fetchedTerms = await fetchPromise;
        termsCache.set(cacheKey, fetchedTerms);

        if (!cancelled) {
          setTerms(fetchedTerms);
        }
      } catch (err) {
        termsCache.delete(cacheKey);
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load defined terms"
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    fetchTerms();

    return () => {
      cancelled = true;
    };
  }, [docType, docId, language, sectionLabel, partLabel]);

  const handleTermToggle = useCallback((termId: string) => {
    setExpandedTermId((prev) => (prev === termId ? null : termId));
  }, []);

  // Filter out globally-scoped terms (act/regulation-wide definitions)
  // Only show terms with section-specific or part-specific definitions
  const uniqueTerms = useMemo(
    () =>
      terms.filter(
        (term) => term.scopeType !== "act" && term.scopeType !== "regulation"
      ),
    [terms]
  );

  // Don't render anything while loading or if there are no unique terms
  if (isLoading) {
    return null;
  }

  if (error) {
    return null; // Silently fail - this is supplementary info
  }

  if (uniqueTerms.length === 0) {
    return null;
  }

  const labels = {
    definedTerms:
      language === "fr"
        ? `${uniqueTerms.length} terme${uniqueTerms.length > 1 ? "s" : ""} défini${uniqueTerms.length > 1 ? "s" : ""} unique${uniqueTerms.length > 1 ? "s" : ""}`
        : `${uniqueTerms.length} unique defined term${uniqueTerms.length > 1 ? "s" : ""}`,
    show: language === "fr" ? "Afficher" : "Show",
    hide: language === "fr" ? "Masquer" : "Hide",
  };

  const panelAriaLabel =
    language === "fr"
      ? `${isExpanded ? "Masquer" : "Afficher"} ${labels.definedTerms}`
      : `${isExpanded ? "Hide" : "Show"} ${labels.definedTerms}`;

  return (
    <div className="mb-3">
      <Collapsible onOpenChange={setIsExpanded} open={isExpanded}>
        <CollapsibleTrigger
          aria-label={panelAriaLabel}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-700 text-xs transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
        >
          <BookOpenIcon className="size-3.5" />
          <span>{labels.definedTerms}</span>
          {isExpanded ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5" />
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-2 rounded-lg border bg-card p-3">
            <div className="space-y-0.5">
              {uniqueTerms.map((term) => (
                <TermRow
                  isExpanded={expandedTermId === term.id}
                  key={term.id}
                  language={language}
                  onToggle={() => handleTermToggle(term.id)}
                  term={term}
                />
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
