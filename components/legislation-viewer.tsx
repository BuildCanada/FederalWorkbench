"use client";

import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  ExternalLinkIcon,
  FileTextIcon,
  HistoryIcon,
  InfoIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type {
  ActMetadata,
  RegulationMetadata,
  SectionContent,
  SectionTocItem,
} from "@/app/(chat)/api/legislation/sections/route";
import type {
  FootnoteInfo,
  HistoricalNoteItem,
} from "@/lib/db/legislation/queries";
import {
  buildAnnualStatuteUrl,
  buildJusticeCanadaUrl,
  buildPointInTimeIndexUrl,
  parseAmendmentCitation,
} from "@/lib/legislation/constants";
import type { ContentNode } from "@/lib/legislation/types";
import { cn } from "@/lib/utils";
import { ContentTreeRenderer } from "./content-tree-renderer";

import { DefinedTermsPanel } from "./defined-terms-panel";

type DocType = "act" | "regulation";
type DocumentMetadata = ActMetadata | RegulationMetadata;

type LegislationViewerProps = {
  docType: DocType;
  docId: string;
  language: "en" | "fr";
  isLoading?: boolean;
};

/**
 * Collapsible section for Related Provisions (amending/transitional sections)
 * These are typically transitional provisions from amendment acts that don't
 * belong in the main table of contents but are included for reference.
 */
function RelatedProvisionsSection({
  items,
  language,
  selectedSectionOrder,
  onSectionClick,
}: {
  items: SectionTocItem[];
  language: "en" | "fr";
  selectedSectionOrder: number | null;
  onSectionClick: (order: number) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (items.length === 0) {
    return null;
  }

  const label =
    language === "fr" ? "Dispositions connexes" : "Related Provisions";

  return (
    <div className="mt-4 border-muted border-t pt-3">
      <button
        className="flex w-full items-center justify-between px-2 py-1 font-semibold text-muted-foreground text-xs uppercase tracking-wide hover:text-foreground"
        onClick={() => setIsExpanded(!isExpanded)}
        type="button"
      >
        <span>
          {label} ({items.length})
        </span>
        <ChevronRightIcon
          className={cn(
            "size-4 transition-transform",
            isExpanded && "rotate-90"
          )}
        />
      </button>

      {isExpanded && (
        <nav className="mt-1 space-y-0.5">
          {items.map((item) => (
            <button
              className={cn(
                "w-full rounded px-2 py-1 text-left text-xs transition-colors hover:bg-accent",
                selectedSectionOrder === item.sectionOrder &&
                  "bg-accent text-accent-foreground"
              )}
              key={item.id}
              onClick={() => onSectionClick(item.sectionOrder)}
              type="button"
            >
              <span className="block truncate text-muted-foreground">
                <span className="font-medium text-foreground">
                  {item.sectionLabel}
                </span>
                {item.marginalNote && (
                  <span className="ml-1">- {item.marginalNote}</span>
                )}
              </span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

// Number of sections to load around the visible range
const SECTION_BUFFER = 5;
// Initial sections to load on mount
const INITIAL_SECTIONS_TO_LOAD = 30;
// Virtuoso overscan - how many items to render outside viewport
const VIRTUOSO_OVERSCAN = 400;
// Debounce delay for range changes (ms)
const RANGE_CHANGE_DEBOUNCE_MS = 150;

type LoadedSection = SectionContent & { loaded: true };
type PlaceholderSection = SectionTocItem & { loaded: false };
type DisplaySection = LoadedSection | PlaceholderSection;

// Pattern for repealed sections: "36[Repealed, 2012, c. 9, s. 2]"
const REPEALED_PATTERN = /^\d+(?:\.\d+)?\s*\[(?:Repealed|Abrogé)/i;
// Pattern to extract just the citation part
const REPEALED_CITATION_PATTERN = /\[(Repealed|Abrogé)[^\]]+\]/i;
// Pattern to extract section number from internal reference targets
const SECTION_TARGET_PATTERN = /(?:section_?)?(\d+(?:\.\d+)?)/i;

function SectionContentDisplay({
  content,
  contentTree,
  language,
  onNavigate,
}: {
  content: string;
  contentTree: ContentNode[] | null;
  language: "en" | "fr";
  onNavigate?: (target: string) => void;
}) {
  if (REPEALED_PATTERN.test(content)) {
    const citationMatch = content.match(REPEALED_CITATION_PATTERN);
    const citation = citationMatch ? citationMatch[0] : content;
    return <p className="text-muted-foreground italic">{citation}</p>;
  }

  if (contentTree && contentTree.length > 0) {
    return (
      <div className="legislation-content prose prose-sm dark:prose-invert max-w-none">
        <ContentTreeRenderer
          language={language}
          nodes={contentTree}
          onNavigate={onNavigate}
        />
      </div>
    );
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
      {content}
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-CA");
  } catch {
    return dateStr;
  }
}

/**
 * Hierarchy breadcrumb - shows the Part/Division path above section
 * Provides "where am I in this document?" context
 */
function HierarchyBreadcrumb({
  path,
  language,
}: {
  path: string[] | null;
  language: "en" | "fr";
}) {
  if (!path || path.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label={language === "fr" ? "Fil d'Ariane" : "Breadcrumb"}
      className="mb-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-muted-foreground text-xs"
    >
      {path.map((item, index) => (
        <span className="inline-flex items-center gap-1" key={item}>
          {index > 0 && (
            <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground/50" />
          )}
          <span>{item}</span>
        </span>
      ))}
    </nav>
  );
}

/**
 * Status and type badges for sections
 * Shows status (repealed, not-in-force) and special section types (amending, transitional)
 */
function SectionBadges({
  status,
  sectionType,
  language,
}: {
  status: string | null;
  sectionType: string | null;
  language: "en" | "fr";
}) {
  const badges: Array<{ label: string; className: string }> = [];

  if (status === "repealed") {
    badges.push({
      label: language === "fr" ? "Abrogé" : "Repealed",
      className: "bg-destructive/10 text-destructive",
    });
  } else if (status === "not-in-force") {
    badges.push({
      label: language === "fr" ? "Non en vigueur" : "Not in Force",
      className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    });
  }

  if (sectionType === "amending") {
    badges.push({
      label: language === "fr" ? "Modificatif" : "Amending",
      className: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    });
  } else if (sectionType === "transitional") {
    badges.push({
      label: language === "fr" ? "Transitoire" : "Transitional",
      className: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
    });
  }

  if (badges.length === 0) {
    return null;
  }

  return (
    <span className="ml-2 inline-flex gap-1.5">
      {badges.map((badge) => (
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs",
            badge.className
          )}
          key={badge.label}
        >
          {badge.label}
        </span>
      ))}
    </span>
  );
}

/**
 * Footnotes display - shows editorial notes and footnotes at end of section
 */
function FootnotesDisplay({
  footnotes,
  language,
}: {
  footnotes: FootnoteInfo[] | null;
  language: "en" | "fr";
}) {
  if (!footnotes || footnotes.length === 0) {
    return null;
  }

  return (
    <aside className="mt-4 border-muted border-t pt-3">
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <InfoIcon className="size-3.5" />
        <span className="font-medium">
          {language === "fr" ? "Notes" : "Notes"}
        </span>
      </div>
      <ul className="mt-2 space-y-1.5 text-muted-foreground text-xs">
        {footnotes.map((note) => (
          <li className="flex gap-2" key={note.id}>
            {note.label && (
              <span className="shrink-0 font-semibold">{note.label}</span>
            )}
            <span>{note.text}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * Amendment timeline entry - interactive link to Justice Canada
 * Current version (isLatest) has no link; historical versions link to amending act
 */
function AmendmentTimelineEntry({
  note,
  isLatest,
  language,
}: {
  note: HistoricalNoteItem;
  isLatest: boolean;
  language: "en" | "fr";
}) {
  const parsed = parseAmendmentCitation(note.text);

  // For historical versions, link to the amending act (annual statute) on Justice Canada
  // Current version has no link (user is already viewing it)
  const amendingActUrl =
    !isLatest && parsed
      ? buildAnnualStatuteUrl(parsed.year, parsed.chapter, language)
      : null;

  const isOriginal = note.type === "original";
  const typeLabel = isOriginal
    ? language === "fr"
      ? "Version initiale"
      : "Original"
    : language === "fr"
      ? "Modification"
      : "Amendment";

  return (
    <div className="group relative flex items-start gap-3">
      {/* Timeline dot */}
      <div className="relative flex flex-col items-center">
        {isLatest ? (
          <CheckCircle2Icon className="size-4 shrink-0 text-primary" />
        ) : (
          <CircleIcon className="size-4 shrink-0 text-muted-foreground/50" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Current version: plain text; Historical: link to amending act */}
          {amendingActUrl ? (
            <a
              className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary hover:underline"
              href={amendingActUrl}
              rel="noopener noreferrer"
              target="_blank"
              title={
                language === "fr"
                  ? `Voir la loi modificative de ${parsed?.year}`
                  : `View ${parsed?.year} amending act`
              }
            >
              {note.text}
              <ExternalLinkIcon className="size-3 opacity-50 group-hover:opacity-100" />
            </a>
          ) : (
            <span className="font-medium text-foreground">{note.text}</span>
          )}

          {/* Type badge */}
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[10px]",
              isLatest
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            )}
          >
            {isLatest
              ? language === "fr"
                ? "Actuelle"
                : "Current"
              : typeLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

function SectionMetadataStrip({
  docType,
  docId,
  enactedDate,
  inForceStartDate,
  lastAmendedDate,
  historicalNotes,
  language,
}: {
  docType: DocType;
  docId: string;
  enactedDate: string | null;
  inForceStartDate: string | null;
  lastAmendedDate: string | null;
  historicalNotes: HistoricalNoteItem[] | null;
  language: "en" | "fr";
}) {
  const [expanded, setExpanded] = useState(false);

  const hasMetadata = enactedDate || inForceStartDate || lastAmendedDate;
  const hasHistory = historicalNotes && historicalNotes.length > 0;

  if (!hasMetadata && !hasHistory) {
    return null;
  }

  // Determine which dates to show (avoid redundancy)
  const showEnacted = enactedDate && enactedDate !== inForceStartDate;
  const showInForce = inForceStartDate;
  const showAmended = lastAmendedDate && lastAmendedDate !== inForceStartDate;

  const labels = {
    enacted: language === "fr" ? "Adopté" : "Enacted",
    inForce: language === "fr" ? "En vigueur" : "In force",
    amended: language === "fr" ? "Modifié" : "Amended",
    history: language === "fr" ? "Historique" : "History",
    versions:
      language === "fr"
        ? `${historicalNotes?.length} version${historicalNotes && historicalNotes.length > 1 ? "s" : ""}`
        : `${historicalNotes?.length} version${historicalNotes && historicalNotes.length > 1 ? "s" : ""}`,
  };

  // Sort notes by citation year (most recent first) for timeline display
  // The inForceStartDate can be the same for all entries (when they were
  // added to the current consolidation), so we parse the year from the
  // citation text to get the actual chronological order
  const sortedNotes = hasHistory
    ? [...historicalNotes].sort((a, b) => {
        const yearA = parseAmendmentCitation(a.text)?.year || 0;
        const yearB = parseAmendmentCitation(b.text)?.year || 0;
        return yearB - yearA; // Most recent first
      })
    : [];

  // Point-in-time URL only available for acts
  const pitUrl =
    docType === "act" ? buildPointInTimeIndexUrl(docId, language) : null;

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
        {showEnacted && (
          <span>
            {labels.enacted}: {formatDate(enactedDate)}
          </span>
        )}
        {showEnacted && showInForce && <span className="text-border">·</span>}
        {showInForce && (
          <span>
            {labels.inForce}: {formatDate(inForceStartDate)}
          </span>
        )}
        {(showEnacted || showInForce) && showAmended && (
          <span className="text-border">·</span>
        )}
        {showAmended && (
          <span>
            {labels.amended}: {formatDate(lastAmendedDate)}
          </span>
        )}
        {hasHistory && (
          <button
            aria-expanded={expanded}
            className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
            onClick={() => setExpanded(!expanded)}
            type="button"
          >
            <HistoryIcon className="size-3" />
            <span>{expanded ? labels.history : labels.versions}</span>
          </button>
        )}
      </div>

      {expanded && hasHistory && (
        <div className="mt-3 rounded-lg border bg-card p-4">
          {/* Header with version indicator and external link */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileTextIcon className="size-4 text-muted-foreground" />
              <span className="font-medium text-sm">
                {language === "fr"
                  ? "Historique des modifications"
                  : "Amendment History"}
              </span>
            </div>
            {pitUrl && (
              <a
                className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-muted-foreground text-xs hover:bg-muted/80 hover:text-foreground"
                href={pitUrl}
                rel="noopener noreferrer"
                target="_blank"
                title={
                  language === "fr"
                    ? "Voir toutes les versions sur Justice Canada"
                    : "View all versions on Justice Canada"
                }
              >
                {language === "fr" ? "Toutes les versions" : "All versions"}
                <ExternalLinkIcon className="size-3" />
              </a>
            )}
          </div>

          {/* Timeline */}
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute top-2 bottom-2 left-[7px] w-px bg-border" />

            {/* Entries */}
            <div className="space-y-0">
              {sortedNotes.map((note, index) => (
                <AmendmentTimelineEntry
                  isLatest={index === 0}
                  key={`${note.text}-${note.enactedDate}-${index}`}
                  language={language}
                  note={note}
                />
              ))}
            </div>
          </div>

          {/* Footer note */}
          <p className="mt-3 border-muted border-t pt-3 text-muted-foreground text-xs">
            <InfoIcon className="mr-1 inline size-3" />
            {language === "fr"
              ? "Vous consultez la version consolidée actuelle. Cliquez sur une modification pour voir la loi modificative."
              : "You are viewing the current consolidated version. Click an amendment to view the amending act."}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Document header for the legislation viewer
 * Extracted as a standalone component to avoid nested component definition
 */
function DocumentHeader({
  metadata,
  docType,
  language,
}: {
  metadata: DocumentMetadata;
  docType: DocType;
  language: "en" | "fr";
}) {
  const isRegulation = docType === "regulation";
  const reg = isRegulation ? (metadata as RegulationMetadata) : null;
  const act = isRegulation ? null : (metadata as ActMetadata);

  return (
    <header className="mb-4 px-6 pt-6">
      <h1 className="font-bold text-2xl">{metadata.title}</h1>
      {metadata.longTitle && metadata.longTitle !== metadata.title && (
        <p className="mt-1 text-lg text-muted-foreground italic">
          {metadata.longTitle}
        </p>
      )}

      {/* Regulation-specific header info */}
      {isRegulation && reg && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 font-medium text-blue-700 text-xs dark:text-blue-400">
            {reg.instrumentNumber}
          </span>
          {reg.regulationType && (
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs">
              {reg.regulationType}
            </span>
          )}
          {reg.gazettePart && (
            <span className="text-muted-foreground text-sm">
              {language === "fr" ? "Gazette" : "Gazette"}: {reg.gazettePart}
            </span>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-muted-foreground text-sm">
        {metadata.status && (
          <span>
            <strong>{language === "fr" ? "Statut:" : "Status:"}</strong>{" "}
            {metadata.status}
          </span>
        )}

        {/* Act-specific dates */}
        {act?.consolidationDate && (
          <span>
            <strong>
              {language === "fr"
                ? "Date de consolidation:"
                : "Consolidation Date:"}
            </strong>{" "}
            {act.consolidationDate}
          </span>
        )}

        {/* Regulation-specific dates */}
        {reg?.registrationDate && (
          <span>
            <strong>{language === "fr" ? "Enregistré:" : "Registered:"}</strong>{" "}
            {formatDate(reg.registrationDate)}
          </span>
        )}
        {reg?.consolidationDate && (
          <span>
            <strong>
              {language === "fr" ? "Consolidation:" : "Consolidation:"}
            </strong>{" "}
            {reg.consolidationDate}
          </span>
        )}
        {reg?.lastAmendedDate && (
          <span>
            <strong>
              {language === "fr" ? "Dernière modification:" : "Last Amended:"}
            </strong>{" "}
            {formatDate(reg.lastAmendedDate)}
          </span>
        )}
      </div>

      {/* Enabling Act (for regulations) */}
      {reg?.enablingActId && (
        <div className="mt-3 text-sm">
          <strong className="text-muted-foreground">
            {language === "fr" ? "Loi habilitante:" : "Enabling Act:"}
          </strong>{" "}
          <a
            className="text-primary hover:underline"
            href={buildJusticeCanadaUrl(reg.enablingActId, "act", language)}
            rel="noopener noreferrer"
            target="_blank"
          >
            {reg.enablingActTitle || reg.enablingActId}
            <ExternalLinkIcon className="ml-1 inline size-3" />
          </a>
        </div>
      )}

      {/* Enabling Authority Order (for regulations) */}
      {reg?.enablingAuthorityOrder && (
        <div className="mt-4 rounded-lg border bg-muted/30 p-4">
          {reg.enablingAuthorityOrder.contentTree &&
          reg.enablingAuthorityOrder.contentTree.length > 0 ? (
            <div className="legislation-content prose prose-sm dark:prose-invert max-w-none">
              <ContentTreeRenderer
                language={language}
                nodes={reg.enablingAuthorityOrder.contentTree}
              />
            </div>
          ) : (
            <p className="text-sm leading-relaxed">
              {reg.enablingAuthorityOrder.text}
            </p>
          )}
          {reg.enablingAuthorityOrder.footnotes &&
            reg.enablingAuthorityOrder.footnotes.length > 0 && (
              <ul className="mt-3 space-y-1 border-muted border-t pt-3 text-muted-foreground text-xs">
                {reg.enablingAuthorityOrder.footnotes.map((fn) => {
                  const parsed = parseAmendmentCitation(fn.text);
                  const url = parsed
                    ? buildAnnualStatuteUrl(
                        parsed.year,
                        parsed.chapter,
                        language
                      )
                    : null;
                  return (
                    <li key={fn.id}>
                      {url ? (
                        <a
                          className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                          href={url}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          {fn.label && (
                            <sup className="font-semibold">{fn.label}</sup>
                          )}
                          <span>{fn.text}</span>
                          <ExternalLinkIcon className="size-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="flex gap-1">
                          {fn.label && (
                            <sup className="font-semibold">{fn.label}</sup>
                          )}
                          <span>{fn.text}</span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
        </div>
      )}
    </header>
  );
}

type FetchSectionContentParams = {
  docType: DocType;
  docId: string;
  lang: string;
  startOrder: number;
  endOrder: number;
  signal?: AbortSignal;
};

/**
 * Fetch section content for a range of sections.
 */
async function fetchSectionContent({
  docType,
  docId,
  lang,
  startOrder,
  endOrder,
  signal,
}: FetchSectionContentParams): Promise<SectionContent[]> {
  const res = await fetch(
    `/api/legislation/section-content?docType=${docType}&docId=${encodeURIComponent(docId)}&language=${lang}&startOrder=${startOrder}&endOrder=${endOrder}`,
    { signal }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch section content: ${res.status}`);
  }
  const data = await res.json();
  return data.sections;
}

export function LegislationViewer({
  docType,
  docId,
  language,
  isLoading: externalLoading,
}: LegislationViewerProps) {
  const [metadata, setMetadata] = useState<DocumentMetadata | null>(null);
  const [toc, setToc] = useState<SectionTocItem[]>([]);
  const [loadedSections, setLoadedSections] = useState<
    Map<number, SectionContent>
  >(new Map());
  const [isLoadingToc, setIsLoadingToc] = useState(true);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSectionOrder, setSelectedSectionOrder] = useState<
    number | null
  >(null);

  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Track pending section orders to prevent duplicate requests
  const pendingSectionOrders = useRef<Set<number>>(new Set());

  // Ref for checking loaded sections without causing callback recreation
  const loadedSectionsRef = useRef(loadedSections);
  useEffect(() => {
    loadedSectionsRef.current = loadedSections;
  }, [loadedSections]);

  // Track if initial load has happened to prevent duplicate initial loads
  const hasInitiallyLoaded = useRef(false);

  const rangeChangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch TOC on mount (no initial content load - Virtuoso handles it)
  useEffect(() => {
    async function fetchToc() {
      setIsLoadingToc(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/legislation/sections?docType=${docType}&docId=${encodeURIComponent(docId)}&language=${language}`
        );
        if (!res.ok) {
          throw new Error(`Failed to fetch sections: ${res.status}`);
        }
        const data = await res.json();
        setMetadata(data.act || data.regulation);
        setToc(data.toc);
      } catch (err) {
        const label = docType === "regulation" ? "regulation" : "act";
        setError(
          err instanceof Error ? err.message : `Failed to load ${label}`
        );
      } finally {
        setIsLoadingToc(false);
      }
    }
    fetchToc();
  }, [docType, docId, language]);

  // Load sections for a range - called when Virtuoso renders items
  // Tracks individual section orders to prevent overlapping requests
  // Returns a promise that resolves when loading is complete
  const loadSectionRange = useCallback(
    async (sectionOrders: number[], lang: string): Promise<void> => {
      // Filter out already loaded and pending sections using ref for stable deps
      const neededOrders = sectionOrders.filter(
        (order) =>
          !loadedSectionsRef.current.has(order) &&
          !pendingSectionOrders.current.has(order)
      );

      if (neededOrders.length === 0) {
        return;
      }

      const sortedOrders = [...neededOrders].sort((a, b) => a - b);
      const startOrder = sortedOrders[0];
      const endOrder = sortedOrders.at(-1);

      if (startOrder === undefined || endOrder === undefined) {
        return;
      }

      // Mark all as pending AFTER validation
      for (const order of neededOrders) {
        pendingSectionOrders.current.add(order);
      }
      setIsLoadingContent(true);

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      try {
        const sections = await fetchSectionContent({
          docType,
          docId,
          lang,
          startOrder,
          endOrder,
          signal: abortControllerRef.current.signal,
        });
        setLoadedSections((prev) => {
          const next = new Map(prev);
          for (const section of sections) {
            next.set(section.sectionOrder, section);
          }
          return next;
        });
      } catch (err) {
        // Ignore abort errors (expected when cancelling)
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        console.error("Failed to load sections:", err);
      } finally {
        for (const order of neededOrders) {
          pendingSectionOrders.current.delete(order);
        }
        setIsLoadingContent(false);
      }
    },
    [docType, docId]
  );

  // Handle range changes from Virtuoso - load visible sections with debouncing
  const handleRangeChanged = useCallback(
    (range: { startIndex: number; endIndex: number }) => {
      if (rangeChangeTimer.current) {
        clearTimeout(rangeChangeTimer.current);
      }

      // Debounce to prevent rapid-fire requests during scroll
      rangeChangeTimer.current = setTimeout(() => {
        if (toc.length === 0) {
          return;
        }

        const lang = metadata?.language || language;
        const startIdx = Math.max(0, range.startIndex - SECTION_BUFFER);
        const endIdx = Math.min(
          toc.length - 1,
          range.endIndex + SECTION_BUFFER
        );

        const sectionOrders: number[] = [];
        for (let i = startIdx; i <= endIdx; i++) {
          sectionOrders.push(toc[i].sectionOrder);
        }

        loadSectionRange(sectionOrders, lang);
      }, RANGE_CHANGE_DEBOUNCE_MS);
    },
    [toc, loadSectionRange, metadata?.language, language]
  );

  useEffect(() => {
    return () => {
      if (rangeChangeTimer.current) {
        clearTimeout(rangeChangeTimer.current);
      }
    };
  }, []);

  // Load initial sections after TOC is fetched (runs once per document)
  useEffect(() => {
    if (toc.length === 0 || !metadata || hasInitiallyLoaded.current) {
      return;
    }

    hasInitiallyLoaded.current = true;
    const lang = (metadata.language as string) || language;
    const initialCount = Math.min(INITIAL_SECTIONS_TO_LOAD, toc.length);
    const sectionOrders = toc.slice(0, initialCount).map((s) => s.sectionOrder);

    loadSectionRange(sectionOrders, lang);
  }, [toc, metadata, language, loadSectionRange]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reset when doc identity changes
  useEffect(() => {
    hasInitiallyLoaded.current = false;
  }, [docType, docId, language]);

  // Handle TOC click - load content then scroll for smooth experience
  const handleSectionClick = useCallback(
    async (sectionOrder: number) => {
      setSelectedSectionOrder(sectionOrder);

      const tocIndex = toc.findIndex((s) => s.sectionOrder === sectionOrder);
      if (tocIndex === -1) {
        return;
      }

      const lang = metadata?.language || language;
      const startIdx = Math.max(0, tocIndex - SECTION_BUFFER);
      const endIdx = Math.min(toc.length - 1, tocIndex + SECTION_BUFFER);

      const sectionOrders: number[] = [];
      for (let i = startIdx; i <= endIdx; i++) {
        sectionOrders.push(toc[i].sectionOrder);
      }

      await loadSectionRange(sectionOrders, lang);

      virtuosoRef.current?.scrollToIndex({
        index: tocIndex,
        align: "start",
        behavior: "auto",
      });
    },
    [toc, loadSectionRange, metadata?.language, language]
  );

  const handleInternalNavigation = useCallback(
    (target: string) => {
      const sectionMatch = target.match(SECTION_TARGET_PATTERN);
      const sectionLabel = sectionMatch ? sectionMatch[1] : target;

      const tocItem = toc.find(
        (item) =>
          item.sectionLabel === sectionLabel ||
          item.sectionLabel === target ||
          item.id === target
      );

      if (tocItem) {
        handleSectionClick(tocItem.sectionOrder);
      }
    },
    [toc, handleSectionClick]
  );

  const getDisplaySection = useCallback(
    (index: number): DisplaySection => {
      const tocItem = toc[index];
      const loaded = loadedSections.get(tocItem.sectionOrder);
      if (loaded) {
        return { ...loaded, loaded: true as const };
      }
      return { ...tocItem, loaded: false as const };
    },
    [toc, loadedSections]
  );

  const formatSectionHeader = (
    section: DisplaySection,
    lang: "en" | "fr"
  ): string => {
    const label = section.sectionLabel;
    const note = section.marginalNote;

    if (section.sectionType === "heading") {
      return note ? `${label} - ${note}` : label;
    }
    if (section.sectionType === "schedule") {
      return label;
    }
    const prefix = lang === "fr" ? "Article" : "Section";
    return note ? `${prefix} ${label} - ${note}` : `${prefix} ${label}`;
  };

  const getSectionHeaderLevel = (sectionType: string | null): "h2" | "h3" => {
    if (sectionType === "heading" || sectionType === "schedule") {
      return "h2";
    }
    return "h3";
  };

  // Memoize Virtuoso components - react-virtuoso's API expects component functions
  const virtuosoComponents = useMemo(
    () => ({
      // biome-ignore lint/correctness/noNestedComponentDefinitions: react-virtuoso API pattern
      Header: () =>
        metadata ? (
          <DocumentHeader
            docType={docType}
            language={(metadata.language as "en" | "fr") || language}
            metadata={metadata}
          />
        ) : null,
    }),
    [docType, language, metadata]
  );

  if (externalLoading || isLoadingToc) {
    const label = docType === "regulation" ? "regulation" : "act";
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading {label}...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-destructive">{error}</div>
      </div>
    );
  }

  if (!metadata) {
    return null;
  }

  const usedLang = (metadata.language as "en" | "fr") || language;

  return (
    <div className="flex h-full flex-row">
      {/* Section Navigation Sidebar */}
      <div className="w-64 shrink-0 overflow-y-auto border-r bg-muted/30 p-2">
        <div className="mb-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
          {usedLang === "fr" ? "Sections" : "Sections"} (
          {
            toc.filter(
              (s) =>
                s.sectionType !== "amending" && s.sectionType !== "transitional"
            ).length
          }
          )
        </div>
        <nav className="space-y-0.5">
          {toc
            .filter(
              (item) =>
                item.sectionType !== "amending" &&
                item.sectionType !== "transitional"
            )
            .map((item) => (
              <button
                className={cn(
                  "w-full rounded px-2 py-1 text-left text-sm transition-colors hover:bg-accent",
                  item.sectionType === "heading" && "font-semibold",
                  item.isRepealed && "text-muted-foreground",
                  selectedSectionOrder === item.sectionOrder &&
                    "bg-accent text-accent-foreground"
                )}
                key={item.id}
                onClick={() => handleSectionClick(item.sectionOrder)}
                type="button"
              >
                <span className="block truncate">
                  {item.sectionType === "heading" ? (
                    <span className="font-medium">{item.sectionLabel}</span>
                  ) : item.isRepealed ? (
                    <span className="italic">
                      {item.sectionLabel}
                      <span className="ml-1">
                        - {usedLang === "fr" ? "Abrogé" : "Repealed"}
                      </span>
                    </span>
                  ) : (
                    <span>
                      {item.sectionLabel}
                      {item.marginalNote && (
                        <span className="ml-1 text-muted-foreground">
                          - {item.marginalNote}
                        </span>
                      )}
                    </span>
                  )}
                </span>
              </button>
            ))}
        </nav>

        {/* Related Provisions (amending/transitional sections) */}
        {toc.some(
          (item) =>
            item.sectionType === "amending" ||
            item.sectionType === "transitional"
        ) && (
          <RelatedProvisionsSection
            items={toc.filter(
              (item) =>
                item.sectionType === "amending" ||
                item.sectionType === "transitional"
            )}
            language={usedLang}
            onSectionClick={handleSectionClick}
            selectedSectionOrder={selectedSectionOrder}
          />
        )}
      </div>

      {/* Main Content Area - Virtualized */}
      <div className="flex-1 overflow-hidden">
        {/* Loading indicator */}
        {isLoadingContent && (
          <div className="fixed top-20 right-4 z-10 rounded bg-accent px-3 py-1 text-accent-foreground text-sm shadow">
            {usedLang === "fr" ? "Chargement..." : "Loading..."}
          </div>
        )}

        <Virtuoso
          className="h-full"
          components={virtuosoComponents}
          data={toc}
          increaseViewportBy={VIRTUOSO_OVERSCAN}
          itemContent={(index) => {
            const section = getDisplaySection(index);
            const HeaderTag = getSectionHeaderLevel(section.sectionType);
            const isLoaded = section.loaded;

            return (
              <article
                className={cn(
                  "scroll-mt-4 px-6 py-3",
                  selectedSectionOrder === section.sectionOrder &&
                    "bg-accent/20"
                )}
                data-section-order={section.sectionOrder}
              >
                {/* Hierarchy breadcrumb - shows Part/Division context */}
                {isLoaded && (
                  <HierarchyBreadcrumb
                    language={usedLang}
                    path={section.hierarchyPath}
                  />
                )}

                {/* Section header with badges */}
                <HeaderTag
                  className={cn(
                    "flex items-center font-semibold",
                    HeaderTag === "h2" ? "mb-2 text-xl" : "mb-1 text-lg"
                  )}
                >
                  <span>{formatSectionHeader(section, usedLang)}</span>
                  {isLoaded && (
                    <SectionBadges
                      language={usedLang}
                      sectionType={section.sectionType}
                      status={section.status}
                    />
                  )}
                </HeaderTag>

                {section.status === "repealed" ? (
                  <p className="text-muted-foreground italic">
                    {usedLang === "fr" ? "Abrogé" : "Repealed"}
                  </p>
                ) : isLoaded ? (
                  <div className="pt-2">
                    <SectionMetadataStrip
                      docId={docId}
                      docType={docType}
                      enactedDate={section.enactedDate}
                      historicalNotes={section.historicalNotes}
                      inForceStartDate={section.inForceStartDate}
                      language={usedLang}
                      lastAmendedDate={section.lastAmendedDate}
                    />
                    <DefinedTermsPanel
                      docId={docId}
                      docType={docType}
                      language={usedLang}
                      partLabel={section.hierarchyPath?.[0]}
                      sectionLabel={section.sectionLabel}
                    />
                    <SectionContentDisplay
                      content={section.content}
                      contentTree={section.contentTree}
                      language={usedLang}
                      onNavigate={handleInternalNavigation}
                    />
                    <FootnotesDisplay
                      footnotes={section.footnotes}
                      language={usedLang}
                    />
                  </div>
                ) : (
                  <div className="h-20 animate-pulse rounded bg-muted" />
                )}
              </article>
            );
          }}
          rangeChanged={handleRangeChanged}
          ref={virtuosoRef}
        />
      </div>
    </div>
  );
}
