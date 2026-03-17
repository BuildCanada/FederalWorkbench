import "server-only";

import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../connection";
import { acts, sections } from "./schema";

const MAX_SECTION_RANGE = 100;

// Pre-compiled regex for act ID validation
const ACT_ID_REGEX = /^[A-Z]+-\d+(\.\d+)?$/i;

export type SectionTocItem = {
  id: string;
  sectionLabel: string;
  marginalNote: string | null;
  sectionType: string | null;
  sectionOrder: number;
  status: string | null;
  isRepealed: boolean;
};

export type ActMetadata = {
  actId: string;
  title: string;
  longTitle: string | null;
  status: string | null;
  consolidationDate: string | null;
  language: string;
};

export type SectionContent = {
  id: string;
  sectionLabel: string;
  marginalNote: string | null;
  content: string;
  sectionType: string | null;
  sectionOrder: number;
  status: string | null;
};

export type LegislationSectionsResponse = {
  act: ActMetadata;
  toc: SectionTocItem[];
};

export type SectionContentResponse = {
  sections: SectionContent[];
};

/**
 * Get act metadata by actId and language.
 * Falls back to the other language if not found.
 */
export async function getActMetadata({
  actId,
  language,
}: {
  actId: string;
  language: "en" | "fr";
}): Promise<ActMetadata | null> {
  const db = getDb();

  let actRow = await db
    .select({
      actId: acts.actId,
      title: acts.title,
      longTitle: acts.longTitle,
      status: acts.status,
      consolidationDate: acts.consolidationDate,
      language: acts.language,
    })
    .from(acts)
    .where(and(eq(acts.actId, actId), eq(acts.language, language)))
    .limit(1)
    .then((rows) => rows[0]);

  // Try fallback language if not found
  if (!actRow) {
    const fallbackLang = language === "fr" ? "en" : "fr";
    actRow = await db
      .select({
        actId: acts.actId,
        title: acts.title,
        longTitle: acts.longTitle,
        status: acts.status,
        consolidationDate: acts.consolidationDate,
        language: acts.language,
      })
      .from(acts)
      .where(and(eq(acts.actId, actId), eq(acts.language, fallbackLang)))
      .limit(1)
      .then((rows) => rows[0]);
  }

  return actRow ?? null;
}

// Pattern for detecting repealed sections in content
const REPEALED_CONTENT_PATTERN = /^\d+(?:\.\d+)?\s*\[(?:Repealed|Abrogé)/i;

/**
 * Get table of contents for an act (lightweight - includes isRepealed flag).
 */
export async function getActTableOfContents({
  actId,
  language,
}: {
  actId: string;
  language: "en" | "fr";
}): Promise<SectionTocItem[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: sections.id,
      sectionLabel: sections.sectionLabel,
      marginalNote: sections.marginalNote,
      sectionType: sections.sectionType,
      sectionOrder: sections.sectionOrder,
      status: sections.status,
      content: sections.content,
    })
    .from(sections)
    .where(and(eq(sections.actId, actId), eq(sections.language, language)))
    .orderBy(asc(sections.sectionOrder));

  // Map to TOC items with isRepealed computed from content
  return rows.map((row) => ({
    id: row.id,
    sectionLabel: row.sectionLabel,
    marginalNote: row.marginalNote,
    sectionType: row.sectionType,
    sectionOrder: row.sectionOrder,
    status: row.status,
    isRepealed:
      row.status === "repealed" || REPEALED_CONTENT_PATTERN.test(row.content),
  }));
}

/**
 * Get full act metadata and table of contents.
 */
export async function getActSections({
  actId,
  language,
}: {
  actId: string;
  language: "en" | "fr";
}): Promise<LegislationSectionsResponse | null> {
  const actRow = await getActMetadata({ actId, language });

  if (!actRow) {
    return null;
  }

  const usedLang = actRow.language as "en" | "fr";
  const toc = await getActTableOfContents({ actId, language: usedLang });

  return {
    act: actRow,
    toc,
  };
}

/**
 * Get section content for a range of sections.
 * Range is capped at MAX_SECTION_RANGE for performance.
 */
export function getSectionContentRange({
  actId,
  language,
  startOrder,
  endOrder,
}: {
  actId: string;
  language: "en" | "fr";
  startOrder: number;
  endOrder: number;
}): Promise<SectionContent[]> {
  // Cap range to prevent excessive data transfer
  const cappedEndOrder = Math.min(endOrder, startOrder + MAX_SECTION_RANGE - 1);

  const db = getDb();

  return db
    .select({
      id: sections.id,
      sectionLabel: sections.sectionLabel,
      marginalNote: sections.marginalNote,
      content: sections.content,
      sectionType: sections.sectionType,
      sectionOrder: sections.sectionOrder,
      status: sections.status,
    })
    .from(sections)
    .where(
      and(
        eq(sections.actId, actId),
        eq(sections.language, language),
        gte(sections.sectionOrder, startOrder),
        lte(sections.sectionOrder, cappedEndOrder)
      )
    )
    .orderBy(asc(sections.sectionOrder));
}

/**
 * Validate actId format.
 * Valid formats: A-1, C-46, C-38.8, S-1, R-1 etc.
 */
export function isValidActId(actId: string): boolean {
  return ACT_ID_REGEX.test(actId);
}

/**
 * Validate language parameter.
 */
export function isValidLanguage(
  language: string | null
): language is "en" | "fr" {
  return language === "en" || language === "fr";
}
