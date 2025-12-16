import "server-only";

import { and, asc, eq, gte, lte, or, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import type { ContentNode } from "@/lib/legislation/types";
import { getDb } from "../connection";
import type {
  EnablingAuthorityInfo,
  EnablingAuthorityOrder,
  FootnoteInfo,
  HistoricalNoteItem,
} from "./schema";
import { acts, definedTerms, regulations, sections } from "./schema";

export type { FootnoteInfo, HistoricalNoteItem } from "./schema";

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

export type ContentFlags = {
  hasTable?: boolean;
  hasFormula?: boolean;
  hasImage?: boolean;
  hasRepealed?: boolean;
  hasEditorialNote?: boolean;
};

export type SectionContent = {
  id: string;
  sectionLabel: string;
  marginalNote: string | null;
  content: string;
  contentTree: ContentNode[] | null;
  sectionType: string | null;
  sectionOrder: number;
  status: string | null;
  hierarchyPath: string[] | null;
  enactedDate: string | null;
  inForceStartDate: string | null;
  lastAmendedDate: string | null;
  historicalNotes: HistoricalNoteItem[] | null;
  footnotes: FootnoteInfo[] | null;
  contentFlags: ContentFlags | null;
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
      contentTree: sections.contentTree,
      sectionType: sections.sectionType,
      sectionOrder: sections.sectionOrder,
      status: sections.status,
      hierarchyPath: sections.hierarchyPath,
      enactedDate: sections.enactedDate,
      inForceStartDate: sections.inForceStartDate,
      lastAmendedDate: sections.lastAmendedDate,
      historicalNotes: sections.historicalNotes,
      footnotes: sections.footnotes,
      contentFlags: sections.contentFlags,
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

// ============================================================================
// REGULATION QUERIES
// ============================================================================

// Pre-compiled regex for regulation ID validation
// Valid formats: SOR-96-433, CRC-c-10, SI-88-123
const REGULATION_ID_REGEX = /^(SOR|SI|CRC|DORS)-[\w.-]+$/i;

export type RegulationMetadata = {
  regulationId: string;
  instrumentNumber: string;
  regulationType: string | null;
  gazettePart: string | null;
  title: string;
  longTitle: string | null;
  status: string | null;
  registrationDate: string | null;
  consolidationDate: string | null;
  lastAmendedDate: string | null;
  enablingActId: string | null;
  enablingActTitle: string | null;
  enablingAuthorities: EnablingAuthorityInfo[] | null;
  enablingAuthorityOrder: EnablingAuthorityOrder | null;
  language: string;
};

export type RegulationSectionsResponse = {
  regulation: RegulationMetadata;
  toc: SectionTocItem[];
};

/**
 * Validate regulationId format.
 * Valid formats: SOR-96-433, CRC-c-10, SI-88-123, DORS-96-433
 */
export function isValidRegulationId(regulationId: string): boolean {
  return REGULATION_ID_REGEX.test(regulationId);
}

/**
 * Get regulation metadata by regulationId and language.
 * Falls back to the other language if not found.
 */
export async function getRegulationMetadata({
  regulationId,
  language,
}: {
  regulationId: string;
  language: "en" | "fr";
}): Promise<RegulationMetadata | null> {
  const db = getDb();

  let regRow = await db
    .select({
      regulationId: regulations.regulationId,
      instrumentNumber: regulations.instrumentNumber,
      regulationType: regulations.regulationType,
      gazettePart: regulations.gazettePart,
      title: regulations.title,
      longTitle: regulations.longTitle,
      status: regulations.status,
      registrationDate: regulations.registrationDate,
      consolidationDate: regulations.consolidationDate,
      lastAmendedDate: regulations.lastAmendedDate,
      enablingActId: regulations.enablingActId,
      enablingActTitle: regulations.enablingActTitle,
      enablingAuthorities: regulations.enablingAuthorities,
      enablingAuthorityOrder: regulations.enablingAuthorityOrder,
      language: regulations.language,
    })
    .from(regulations)
    .where(
      and(
        eq(regulations.regulationId, regulationId),
        eq(regulations.language, language)
      )
    )
    .limit(1)
    .then((rows) => rows[0]);

  // Try fallback language if not found
  if (!regRow) {
    const fallbackLang = language === "fr" ? "en" : "fr";
    regRow = await db
      .select({
        regulationId: regulations.regulationId,
        instrumentNumber: regulations.instrumentNumber,
        regulationType: regulations.regulationType,
        gazettePart: regulations.gazettePart,
        title: regulations.title,
        longTitle: regulations.longTitle,
        status: regulations.status,
        registrationDate: regulations.registrationDate,
        consolidationDate: regulations.consolidationDate,
        lastAmendedDate: regulations.lastAmendedDate,
        enablingActId: regulations.enablingActId,
        enablingActTitle: regulations.enablingActTitle,
        enablingAuthorities: regulations.enablingAuthorities,
        enablingAuthorityOrder: regulations.enablingAuthorityOrder,
        language: regulations.language,
      })
      .from(regulations)
      .where(
        and(
          eq(regulations.regulationId, regulationId),
          eq(regulations.language, fallbackLang)
        )
      )
      .limit(1)
      .then((rows) => rows[0]);
  }

  return regRow ?? null;
}

/**
 * Get table of contents for a regulation (lightweight - includes isRepealed flag).
 */
export async function getRegulationTableOfContents({
  regulationId,
  language,
}: {
  regulationId: string;
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
    .where(
      and(
        eq(sections.regulationId, regulationId),
        eq(sections.language, language)
      )
    )
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
 * Get full regulation metadata and table of contents.
 */
export async function getRegulationSections({
  regulationId,
  language,
}: {
  regulationId: string;
  language: "en" | "fr";
}): Promise<RegulationSectionsResponse | null> {
  const regRow = await getRegulationMetadata({ regulationId, language });

  if (!regRow) {
    return null;
  }

  const usedLang = regRow.language as "en" | "fr";
  const toc = await getRegulationTableOfContents({
    regulationId,
    language: usedLang,
  });

  return {
    regulation: regRow,
    toc,
  };
}

/**
 * Get section content for a range of sections in a regulation.
 * Range is capped at MAX_SECTION_RANGE for performance.
 */
export function getSectionContentRangeForRegulation({
  regulationId,
  language,
  startOrder,
  endOrder,
}: {
  regulationId: string;
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
      contentTree: sections.contentTree,
      sectionType: sections.sectionType,
      sectionOrder: sections.sectionOrder,
      status: sections.status,
      hierarchyPath: sections.hierarchyPath,
      enactedDate: sections.enactedDate,
      inForceStartDate: sections.inForceStartDate,
      lastAmendedDate: sections.lastAmendedDate,
      historicalNotes: sections.historicalNotes,
      footnotes: sections.footnotes,
      contentFlags: sections.contentFlags,
    })
    .from(sections)
    .where(
      and(
        eq(sections.regulationId, regulationId),
        eq(sections.language, language),
        gte(sections.sectionOrder, startOrder),
        lte(sections.sectionOrder, cappedEndOrder)
      )
    )
    .orderBy(asc(sections.sectionOrder));
}

// ============================================================================
// DEFINED TERMS QUERIES
// ============================================================================

export type DefinedTermItem = {
  id: string;
  term: string;
  definition: string;
  sectionLabel: string | null;
  scopeType: string;
  scopeRawText: string | null;
};

// Pattern for validating section/part labels (alphanumeric with dots, hyphens, spaces)
// Examples: "1", "1.1", "Part I", "Part XVI", "Division 1", "Part V — Airworthiness"
// Includes em-dash (—) and en-dash (–) common in legislation typography
const SECTION_LABEL_REGEX = /^[\w\s.\-–—]+$/;

/**
 * Validate section or part label format.
 * Prevents SQL injection via JSONB queries.
 */
export function isValidSectionLabel(label: string): boolean {
  return SECTION_LABEL_REGEX.test(label) && label.length <= 100;
}

/**
 * Get defined terms that apply to a specific section.
 *
 * Scope resolution:
 * - Act/regulation-wide definitions always apply
 * - Part-scoped definitions apply if partLabel is in scopeSections
 * - Section-scoped definitions apply if sectionLabel is in scopeSections
 */
export async function getDefinedTermsForSection(params: {
  docType: "act" | "regulation";
  docId: string;
  language: "en" | "fr";
  sectionLabel: string;
  partLabel?: string;
}): Promise<DefinedTermItem[]> {
  const { docType, docId, language, sectionLabel, partLabel } = params;

  // Validate inputs to prevent SQL injection via JSONB query
  if (!isValidSectionLabel(sectionLabel)) {
    throw new Error("Invalid section label format");
  }
  if (partLabel && !isValidSectionLabel(partLabel)) {
    throw new Error("Invalid part label format");
  }

  const db = getDb();

  // Base condition: match document and language
  const docCondition =
    docType === "act"
      ? eq(definedTerms.actId, docId)
      : eq(definedTerms.regulationId, docId);

  // Build scope conditions
  const scopeConditions = [
    // Act/regulation-wide definitions always apply
    eq(definedTerms.scopeType, docType),

    // Section-scoped: check if current section is in scopeSections
    and(
      eq(definedTerms.scopeType, "section"),
      sql`${definedTerms.scopeSections} @> ${JSON.stringify([sectionLabel])}::jsonb`
    ),
  ];

  // Part-scoped: check if current part is in scopeSections (if partLabel provided)
  if (partLabel) {
    scopeConditions.push(
      and(
        eq(definedTerms.scopeType, "part"),
        sql`${definedTerms.scopeSections} @> ${JSON.stringify([partLabel])}::jsonb`
      )
    );
  }

  const rows = await db
    .select({
      id: definedTerms.id,
      term: definedTerms.term,
      definition: definedTerms.definition,
      sectionLabel: definedTerms.sectionLabel,
      scopeType: definedTerms.scopeType,
      scopeRawText: definedTerms.scopeRawText,
    })
    .from(definedTerms)
    .where(
      and(
        docCondition,
        eq(definedTerms.language, language),
        or(...scopeConditions)
      )
    )
    .orderBy(asc(definedTerms.term));

  return rows;
}

// ============================================================================
// LEGISLATION STATISTICS QUERIES
// ============================================================================

export type ActWithRegulationCount = {
  actId: string;
  title: string;
  runningHead: string | null;
  status: string;
  inForceDate: string | null;
  consolidatedNumber: string | null;
  sectionCount: number;
  regulationCount: number;
};

export type LegislationStats = {
  acts: ActWithRegulationCount[];
  totalActs: number;
  totalRegulations: number;
  totalSections: number;
};

/**
 * Get legislation statistics including acts with their regulation counts.
 * Used for the status page to show available legislation.
 * Cached for 1 hour to avoid blocking route renders.
 */
export const getLegislationStats = unstable_cache(
  async (): Promise<LegislationStats> => {
    const db = getDb();

    // Get all English acts with section and regulation counts
    const actsData = await db
      .select({
        actId: acts.actId,
        title: acts.title,
        runningHead: acts.runningHead,
        status: acts.status,
        inForceDate: acts.inForceDate,
        consolidatedNumber: acts.consolidatedNumber,
      })
      .from(acts)
      .where(eq(acts.language, "en"))
      .orderBy(asc(acts.title));

    // Get section counts per act
    const sectionCounts = await db
      .select({
        actId: sections.actId,
        count: sql<number>`count(*)::int`,
      })
      .from(sections)
      .where(
        and(eq(sections.language, "en"), sql`${sections.actId} IS NOT NULL`)
      )
      .groupBy(sections.actId);

    // Get regulation counts per enabling act
    const regulationCounts = await db
      .select({
        enablingActId: regulations.enablingActId,
        count: sql<number>`count(*)::int`,
      })
      .from(regulations)
      .where(
        and(
          eq(regulations.language, "en"),
          sql`${regulations.enablingActId} IS NOT NULL`
        )
      )
      .groupBy(regulations.enablingActId);

    // Create lookup maps
    const sectionCountMap = new Map(
      sectionCounts.map((s) => [s.actId, s.count])
    );
    const regulationCountMap = new Map(
      regulationCounts.map((r) => [r.enablingActId, r.count])
    );

    // Combine data
    const actsWithCounts: ActWithRegulationCount[] = actsData.map((act) => ({
      actId: act.actId,
      title: act.title,
      runningHead: act.runningHead,
      status: act.status,
      inForceDate: act.inForceDate,
      consolidatedNumber: act.consolidatedNumber,
      sectionCount: sectionCountMap.get(act.actId) ?? 0,
      regulationCount: regulationCountMap.get(act.actId) ?? 0,
    }));

    // Calculate totals
    const totalActs = actsWithCounts.length;
    const totalRegulations = regulationCounts.reduce(
      (sum, r) => sum + r.count,
      0
    );
    const totalSections = sectionCounts.reduce((sum, s) => sum + s.count, 0);

    return {
      acts: actsWithCounts,
      totalActs,
      totalRegulations,
      totalSections,
    };
  },
  ["legislation-stats"],
  { revalidate: 3600 } // Cache for 1 hour
);
