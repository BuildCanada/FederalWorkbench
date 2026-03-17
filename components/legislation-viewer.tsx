"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActMetadata,
  SectionContent,
  SectionTocItem,
} from "@/app/(chat)/api/legislation/sections/route";
import { cn } from "@/lib/utils";

type LegislationViewerProps = {
  actId: string;
  language: "en" | "fr";
  isLoading?: boolean;
};

// Number of sections to load around the target section
const SECTION_BUFFER = 5;
// Initial sections to load on mount
const INITIAL_SECTIONS_TO_LOAD = 20;
// Debounce delay for intersection observer (ms)
const INTERSECTION_DEBOUNCE_MS = 100;

type LoadedSection = SectionContent & { loaded: true };
type PlaceholderSection = SectionTocItem & { loaded: false };
type DisplaySection = LoadedSection | PlaceholderSection;

// Pattern for repealed sections: "36[Repealed, 2012, c. 9, s. 2]"
const REPEALED_PATTERN = /^\d+(?:\.\d+)?\s*\[(?:Repealed|Abrogé)/i;
// Pattern to extract just the citation part
const REPEALED_CITATION_PATTERN = /\[(Repealed|Abrogé)[^\]]+\]/i;

function SectionContentDisplay({ content }: { content: string }) {
  // Check if this is a repealed section (content is just the repealed citation)
  if (REPEALED_PATTERN.test(content)) {
    // Extract just the repealed citation part, removing the section label prefix
    const citationMatch = content.match(REPEALED_CITATION_PATTERN);
    const citation = citationMatch ? citationMatch[0] : content;
    return <p className="text-muted-foreground italic">{citation}</p>;
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
      {content}
    </div>
  );
}

/**
 * Fetch section content for a range of sections.
 */
async function fetchSectionContent(
  actId: string,
  lang: string,
  startOrder: number,
  endOrder: number
): Promise<SectionContent[]> {
  const res = await fetch(
    `/api/legislation/section-content?actId=${encodeURIComponent(actId)}&language=${lang}&startOrder=${startOrder}&endOrder=${endOrder}`
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch section content: ${res.status}`);
  }
  const data = await res.json();
  return data.sections;
}

export function LegislationViewer({
  actId,
  language,
  isLoading: externalLoading,
}: LegislationViewerProps) {
  const [act, setAct] = useState<ActMetadata | null>(null);
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

  const contentRef = useRef<HTMLDivElement>(null);
  // Use a callback ref pattern to avoid O(n²) ref management
  const sectionRefCallback =
    useRef<(order: number, el: HTMLDivElement | null) => void>();
  const sectionElements = useRef<Map<number, HTMLDivElement>>(new Map());

  // Track in-flight requests to prevent duplicates
  const pendingRequests = useRef<Set<string>>(new Set());
  // Debounce timer for intersection observer
  const intersectionDebounceTimer = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const pendingIntersections = useRef<Set<number>>(new Set());

  // Stable array of loaded section orders for useMemo dependency
  const loadedSectionOrders = useMemo(() => {
    return Array.from(loadedSections.keys()).sort((a, b) => a - b);
  }, [loadedSections]);

  // Fetch TOC on mount
  useEffect(() => {
    async function fetchToc() {
      setIsLoadingToc(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/legislation/sections?actId=${encodeURIComponent(actId)}&language=${language}`
        );
        if (!res.ok) {
          throw new Error(`Failed to fetch sections: ${res.status}`);
        }
        const data = await res.json();
        setAct(data.act);
        setToc(data.toc);

        // Load initial sections inline
        if (data.toc.length > 0) {
          const lastSection = data.toc.at(-1);
          const endOrder = Math.min(
            data.toc[INITIAL_SECTIONS_TO_LOAD - 1]?.sectionOrder ??
              lastSection?.sectionOrder ??
              0,
            lastSection?.sectionOrder ?? 0
          );

          setIsLoadingContent(true);
          try {
            const sections = await fetchSectionContent(
              actId,
              data.act.language || language,
              data.toc[0].sectionOrder,
              endOrder
            );
            setLoadedSections((prev) => {
              const next = new Map(prev);
              for (const section of sections) {
                next.set(section.sectionOrder, section);
              }
              return next;
            });
          } finally {
            setIsLoadingContent(false);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load act");
      } finally {
        setIsLoadingToc(false);
      }
    }
    fetchToc();
  }, [actId, language]);

  const loadSectionRange = useCallback(
    async (startOrder: number, endOrder: number, lang: string) => {
      const cacheKey = `${startOrder}-${endOrder}`;
      if (pendingRequests.current.has(cacheKey)) {
        return;
      }

      pendingRequests.current.add(cacheKey);
      setIsLoadingContent(true);

      try {
        const sections = await fetchSectionContent(
          actId,
          lang,
          startOrder,
          endOrder
        );
        setLoadedSections((prev) => {
          const next = new Map(prev);
          for (const section of sections) {
            next.set(section.sectionOrder, section);
          }
          return next;
        });
      } catch (err) {
        console.error("Failed to load sections:", err);
      } finally {
        pendingRequests.current.delete(cacheKey);
        setIsLoadingContent(false);
      }
    },
    [actId]
  );

  const handleSectionClick = useCallback(
    async (sectionOrder: number) => {
      setSelectedSectionOrder(sectionOrder);

      // Calculate range to load (target section + buffer on each side)
      const tocIndex = toc.findIndex((s) => s.sectionOrder === sectionOrder);
      if (tocIndex === -1) {
        return;
      }

      const startIndex = Math.max(0, tocIndex - SECTION_BUFFER);
      const endIndex = Math.min(toc.length - 1, tocIndex + SECTION_BUFFER);

      // Check which sections in range are not loaded
      const needToLoad: number[] = [];
      for (let i = startIndex; i <= endIndex; i++) {
        if (!loadedSections.has(toc[i].sectionOrder)) {
          needToLoad.push(toc[i].sectionOrder);
        }
      }

      if (needToLoad.length > 0) {
        await loadSectionRange(
          Math.min(...needToLoad),
          Math.max(...needToLoad),
          act?.language || language
        );
      }

      // Scroll to section after content loads
      requestAnimationFrame(() => {
        const element = sectionElements.current.get(sectionOrder);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    },
    [toc, loadedSections, loadSectionRange, act?.language, language]
  );

  // Build display sections - combine TOC with loaded content
  // Use loadedSectionOrders for stable dependency tracking
  const displaySections: DisplaySection[] = useMemo(() => {
    const loadedSet = new Set(loadedSectionOrders);
    return toc.map((tocItem) => {
      if (loadedSet.has(tocItem.sectionOrder)) {
        const loaded = loadedSections.get(tocItem.sectionOrder);
        if (loaded) {
          return { ...loaded, loaded: true as const };
        }
      }
      return { ...tocItem, loaded: false as const };
    });
  }, [toc, loadedSectionOrders, loadedSections]);

  // Process pending intersections with debouncing
  const processPendingIntersections = useCallback(() => {
    if (pendingIntersections.current.size === 0) {
      return;
    }

    const orders = Array.from(pendingIntersections.current);
    pendingIntersections.current.clear();

    // Find contiguous ranges to minimize requests
    const unloadedOrders = orders.filter((order) => !loadedSections.has(order));
    if (unloadedOrders.length === 0) {
      return;
    }

    // For each unloaded section, load it with buffer
    for (const order of unloadedOrders) {
      const tocIndex = toc.findIndex((s) => s.sectionOrder === order);
      if (tocIndex !== -1) {
        const startIndex = Math.max(0, tocIndex - SECTION_BUFFER);
        const endIndex = Math.min(toc.length - 1, tocIndex + SECTION_BUFFER);
        loadSectionRange(
          toc[startIndex].sectionOrder,
          toc[endIndex].sectionOrder,
          act?.language || language
        );
      }
    }
  }, [toc, loadedSections, loadSectionRange, act?.language, language]);

  // Intersection observer for lazy loading as user scrolls
  useEffect(() => {
    if (toc.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const order = Number.parseInt(
              entry.target.getAttribute("data-section-order") || "0",
              10
            );
            if (order && !loadedSections.has(order)) {
              pendingIntersections.current.add(order);
            }
          }
        }

        // Debounce processing of intersections
        if (intersectionDebounceTimer.current) {
          clearTimeout(intersectionDebounceTimer.current);
        }
        intersectionDebounceTimer.current = setTimeout(() => {
          processPendingIntersections();
        }, INTERSECTION_DEBOUNCE_MS);
      },
      {
        root: contentRef.current,
        rootMargin: "200px",
        threshold: 0,
      }
    );

    // Observe all section placeholders
    for (const [order, element] of sectionElements.current) {
      if (!loadedSections.has(order)) {
        observer.observe(element);
      }
    }

    return () => {
      observer.disconnect();
      if (intersectionDebounceTimer.current) {
        clearTimeout(intersectionDebounceTimer.current);
      }
    };
  }, [toc, loadedSections, processPendingIntersections]);

  // Setup callback ref for efficient ref management
  useEffect(() => {
    sectionRefCallback.current = (order: number, el: HTMLDivElement | null) => {
      if (el) {
        sectionElements.current.set(order, el);
      } else {
        sectionElements.current.delete(order);
      }
    };
  }, []);

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

  if (externalLoading || isLoadingToc) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading act...</div>
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

  if (!act) {
    return null;
  }

  const usedLang = (act.language as "en" | "fr") || language;

  return (
    <div className="flex h-full flex-row">
      {/* Section Navigation Sidebar */}
      <div className="w-64 shrink-0 overflow-y-auto border-r bg-muted/30 p-2">
        <div className="mb-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
          {usedLang === "fr" ? "Sections" : "Sections"} ({toc.length})
        </div>
        <nav className="space-y-0.5">
          {toc.map((item) => (
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
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6" ref={contentRef}>
        {/* Act Header */}
        <header className="mb-8">
          <h1 className="font-bold text-2xl">{act.title}</h1>
          {act.longTitle && act.longTitle !== act.title && (
            <p className="mt-1 text-lg text-muted-foreground italic">
              {act.longTitle}
            </p>
          )}
          <div className="mt-4 flex gap-4 text-muted-foreground text-sm">
            {act.status && (
              <span>
                <strong>{usedLang === "fr" ? "Statut:" : "Status:"}</strong>{" "}
                {act.status}
              </span>
            )}
            {act.consolidationDate && (
              <span>
                <strong>
                  {usedLang === "fr"
                    ? "Date de consolidation:"
                    : "Consolidation Date:"}
                </strong>{" "}
                {act.consolidationDate}
              </span>
            )}
          </div>
        </header>

        {/* Loading indicator */}
        {isLoadingContent && (
          <div className="fixed top-20 right-4 rounded bg-accent px-3 py-1 text-accent-foreground text-sm shadow">
            {usedLang === "fr" ? "Chargement..." : "Loading..."}
          </div>
        )}

        {/* Sections */}
        <div className="space-y-6">
          {displaySections.map((section) => {
            const HeaderTag = getSectionHeaderLevel(section.sectionType);
            return (
              <div
                className={cn(
                  "scroll-mt-4",
                  selectedSectionOrder === section.sectionOrder &&
                    "-mx-4 rounded-lg bg-accent/20 p-4"
                )}
                data-section-order={section.sectionOrder}
                key={section.id}
                ref={(el) =>
                  sectionRefCallback.current?.(section.sectionOrder, el)
                }
              >
                <HeaderTag
                  className={cn(
                    "font-semibold",
                    HeaderTag === "h2" ? "mb-2 text-xl" : "mb-1 text-lg"
                  )}
                >
                  {formatSectionHeader(section, usedLang)}
                </HeaderTag>

                {section.status === "repealed" ? (
                  <p className="text-muted-foreground italic">
                    {usedLang === "fr" ? "Abrogé" : "Repealed"}
                  </p>
                ) : section.loaded ? (
                  <SectionContentDisplay content={section.content} />
                ) : (
                  <div className="h-20 animate-pulse rounded bg-muted" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
