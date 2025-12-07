/**
 * Legislation Hydration
 *
 * Fetches full act/regulation content for display in the Artifact panel.
 * Similar to parliament's bill hydration but for legislation.sections table.
 */

import { and, asc, count, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getDb } from "@/lib/db/connection";
import {
  acts,
  regulations,
  sections as sectionsTable,
} from "@/lib/db/legislation/schema";
import { ragDebug } from "@/lib/rag/parliament/debug";
import type { LegislationSearchResult } from "./search";

const dbg = ragDebug("leg:hydrate");

type Lang = "en" | "fr";

// Constants for hydration limits
const TOC_SECTION_THRESHOLD = 10;
const TOC_MAX_ENTRIES = 30;
// Max sections to hydrate for display (prevents 2MB+ payloads for Criminal Code)
const MAX_SECTIONS_TO_HYDRATE = 150;
// Max markdown size in characters (~100KB)
const MAX_MARKDOWN_SIZE = 100_000;

type SectionData = {
  sectionLabel: string;
  marginalNote: string | null;
  content: string;
  sectionType: string | null;
};

type FormatActOptions = {
  title: string;
  longTitle: string | null;
  status: string | null;
  consolidationDate: string | null;
  sections: SectionData[];
  lang: Lang;
};

type FormatRegulationOptions = {
  title: string;
  longTitle: string | null;
  status: string | null;
  consolidationDate: string | null;
  enablingActTitle: string | null;
  sections: SectionData[];
  lang: Lang;
};

/**
 * Hydrated source result for legislation
 * Matches the HydratedSource type from parliament for UI compatibility
 */
export type HydratedLegislationSource = {
  sourceType:
    | "act"
    | "regulation"
    | "defined_term"
    | "footnote"
    | "related_provisions"
    | "preamble"
    | "treaty"
    | "cross_reference"
    | "table_of_provisions"
    | "signature_block"
    | "marginal_note"
    | "schedule";
  markdown: string;
  languageUsed: Lang;
  id: string;
  note?: string;
};

/**
 * Format act content as readable markdown
 * Limits output to MAX_SECTIONS_TO_HYDRATE and MAX_MARKDOWN_SIZE
 */
function formatActMarkdown(
  opts: FormatActOptions & { totalSections: number }
): string {
  const {
    title,
    longTitle,
    status,
    consolidationDate,
    sections,
    lang,
    totalSections,
  } = opts;
  const lines: string[] = [];
  const isTruncated = totalSections > sections.length;

  // Header
  lines.push(`# ${title}`);
  if (longTitle && longTitle !== title) {
    lines.push(`\n*${longTitle}*`);
  }
  lines.push("");

  // Truncation notice
  if (isTruncated) {
    const notice =
      lang === "fr"
        ? `> *Affichage de ${sections.length} sur ${totalSections} sections. Consultez le site Justice Canada pour le texte complet.*`
        : `> *Showing ${sections.length} of ${totalSections} sections. See Justice Canada website for full text.*`;
    lines.push(notice);
    lines.push("");
  }

  // Metadata
  const statusLabel = lang === "fr" ? "Statut" : "Status";
  const dateLabel =
    lang === "fr" ? "Date de consolidation" : "Consolidation Date";
  if (status) {
    lines.push(`- **${statusLabel}:** ${status}`);
  }
  if (consolidationDate) {
    lines.push(`- **${dateLabel}:** ${consolidationDate}`);
  }
  if (status || consolidationDate) {
    lines.push("");
  }

  // Table of contents (for acts with many sections)
  if (sections.length > TOC_SECTION_THRESHOLD) {
    const tocLabel = lang === "fr" ? "Table des matières" : "Table of Contents";
    lines.push(`## ${tocLabel}`);
    lines.push("");
    for (const s of sections.slice(0, TOC_MAX_ENTRIES)) {
      const label = s.sectionLabel;
      const note = s.marginalNote ?? "";
      if (s.sectionType === "heading") {
        lines.push(`- **${label}** ${note}`.trim());
      } else {
        lines.push(`- ${label}${note ? ` — ${note}` : ""}`);
      }
    }
    if (sections.length > TOC_MAX_ENTRIES) {
      lines.push(`- ... (${sections.length - TOC_MAX_ENTRIES} more sections)`);
    }
    lines.push("");
  }

  // Sections content - build incrementally with size check
  let currentSize = lines.join("\n").length;
  for (const s of sections) {
    const label = s.sectionLabel;
    const note = s.marginalNote;

    // Build section content
    const sectionLines: string[] = [];
    if (s.sectionType === "heading") {
      sectionLines.push(`## ${label}${note ? ` — ${note}` : ""}`);
    } else if (s.sectionType === "schedule") {
      sectionLines.push(`## ${label}`);
      if (note) {
        sectionLines.push(`*${note}*`);
      }
    } else {
      const sectionHeader =
        lang === "fr" ? `### Article ${label}` : `### Section ${label}`;
      sectionLines.push(note ? `${sectionHeader} — ${note}` : sectionHeader);
    }
    sectionLines.push("");
    sectionLines.push(s.content);
    sectionLines.push("");

    const sectionText = sectionLines.join("\n");

    // Check if adding this section would exceed max size
    if (currentSize + sectionText.length > MAX_MARKDOWN_SIZE) {
      const truncNotice =
        lang === "fr"
          ? "\n\n---\n*Contenu tronqué. Consultez le site Justice Canada pour le texte complet.*"
          : "\n\n---\n*Content truncated. See Justice Canada website for full text.*";
      lines.push(truncNotice);
      break;
    }

    lines.push(...sectionLines);
    currentSize += sectionText.length;
  }

  return lines.join("\n");
}

/**
 * Fetch sections for an act in a specific language (limited to MAX_SECTIONS_TO_HYDRATE)
 */
function fetchActSections(
  db: PostgresJsDatabase,
  actId: string,
  lang: Lang
): Promise<SectionData[]> {
  return db
    .select({
      sectionLabel: sectionsTable.sectionLabel,
      marginalNote: sectionsTable.marginalNote,
      content: sectionsTable.content,
      sectionType: sectionsTable.sectionType,
    })
    .from(sectionsTable)
    .where(
      and(eq(sectionsTable.actId, actId), eq(sectionsTable.language, lang))
    )
    .orderBy(asc(sectionsTable.sectionOrder))
    .limit(MAX_SECTIONS_TO_HYDRATE);
}

/**
 * Fetch sections for a regulation in a specific language (limited to MAX_SECTIONS_TO_HYDRATE)
 */
function fetchRegulationSections(
  db: PostgresJsDatabase,
  regulationId: string,
  lang: Lang
): Promise<SectionData[]> {
  return db
    .select({
      sectionLabel: sectionsTable.sectionLabel,
      marginalNote: sectionsTable.marginalNote,
      content: sectionsTable.content,
      sectionType: sectionsTable.sectionType,
    })
    .from(sectionsTable)
    .where(
      and(
        eq(sectionsTable.regulationId, regulationId),
        eq(sectionsTable.language, lang)
      )
    )
    .orderBy(asc(sectionsTable.sectionOrder))
    .limit(MAX_SECTIONS_TO_HYDRATE);
}

/**
 * Get total section count for an act (for truncation notices)
 */
async function countActSections(
  db: PostgresJsDatabase,
  actId: string,
  lang: Lang
): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(sectionsTable)
    .where(
      and(eq(sectionsTable.actId, actId), eq(sectionsTable.language, lang))
    );
  return Number(result?.count ?? 0);
}

/**
 * Get total section count for a regulation (for truncation notices)
 */
async function countRegulationSections(
  db: PostgresJsDatabase,
  regulationId: string,
  lang: Lang
): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(sectionsTable)
    .where(
      and(
        eq(sectionsTable.regulationId, regulationId),
        eq(sectionsTable.language, lang)
      )
    );
  return Number(result?.count ?? 0);
}

/**
 * Get hydrated act markdown from the legislation database
 *
 * Fetches all sections for an act and formats as readable markdown.
 *
 * @param actId - The act identifier (e.g., "C-46")
 * @param language - Preferred language
 * @returns Hydrated act with markdown content
 */
export async function getHydratedActMarkdown(args: {
  actId: string;
  language: Lang;
}): Promise<HydratedLegislationSource> {
  const { actId, language } = args;
  const db = getDb();

  dbg("hydrating act %s (%s)", actId, language);

  // Fetch act metadata in preferred language
  const actRows = await db
    .select()
    .from(acts)
    .where(and(eq(acts.actId, actId), eq(acts.language, language)))
    .limit(1);

  // If not found, try fallback language
  const fallbackLang = language === "fr" ? "en" : "fr";
  const act =
    actRows[0] ??
    (
      await db
        .select()
        .from(acts)
        .where(and(eq(acts.actId, actId), eq(acts.language, fallbackLang)))
        .limit(1)
    )[0];

  if (!act) {
    throw new Error(`Act ${actId} not found in any language`);
  }

  const usedLang = actRows.length > 0 ? language : fallbackLang;

  // Fetch sections and count in parallel
  const [sectionRows, totalSections] = await Promise.all([
    fetchActSections(db, actId, usedLang),
    countActSections(db, actId, usedLang),
  ]);
  dbg(
    "found %d/%d sections for act %s (limited to %d)",
    sectionRows.length,
    totalSections,
    actId,
    MAX_SECTIONS_TO_HYDRATE
  );

  const markdown = formatActMarkdown({
    title: act.title,
    longTitle: act.longTitle,
    status: act.status,
    consolidationDate: act.consolidationDate,
    sections: sectionRows,
    lang: usedLang,
    totalSections,
  });

  const result: HydratedLegislationSource = {
    sourceType: "act",
    markdown,
    languageUsed: usedLang,
    id: `act-${actId}`,
  };

  // Add note if fallback language was used
  if (usedLang !== language) {
    result.note =
      language === "fr"
        ? "Texte français non disponible; utilisation du texte anglais."
        : "French text not available; using English source text.";
  }

  return result;
}

/**
 * Format regulation content as readable markdown
 * Limits output to MAX_SECTIONS_TO_HYDRATE and MAX_MARKDOWN_SIZE
 */
function formatRegulationMarkdown(
  opts: FormatRegulationOptions & { totalSections: number }
): string {
  const {
    title,
    longTitle,
    status,
    consolidationDate,
    enablingActTitle,
    sections,
    lang,
    totalSections,
  } = opts;
  const lines: string[] = [];
  const isTruncated = totalSections > sections.length;

  // Header
  lines.push(`# ${title}`);
  if (longTitle && longTitle !== title) {
    lines.push(`\n*${longTitle}*`);
  }
  lines.push("");

  // Truncation notice
  if (isTruncated) {
    const notice =
      lang === "fr"
        ? `> *Affichage de ${sections.length} sur ${totalSections} sections. Consultez le site Justice Canada pour le texte complet.*`
        : `> *Showing ${sections.length} of ${totalSections} sections. See Justice Canada website for full text.*`;
    lines.push(notice);
    lines.push("");
  }

  // Metadata
  const statusLabel = lang === "fr" ? "Statut" : "Status";
  const dateLabel =
    lang === "fr" ? "Date de consolidation" : "Consolidation Date";
  const enablingLabel = lang === "fr" ? "Loi habilitante" : "Enabling Act";
  if (status) {
    lines.push(`- **${statusLabel}:** ${status}`);
  }
  if (consolidationDate) {
    lines.push(`- **${dateLabel}:** ${consolidationDate}`);
  }
  if (enablingActTitle) {
    lines.push(`- **${enablingLabel}:** ${enablingActTitle}`);
  }
  if (status || consolidationDate || enablingActTitle) {
    lines.push("");
  }

  // Table of contents (for regulations with many sections)
  if (sections.length > TOC_SECTION_THRESHOLD) {
    const tocLabel = lang === "fr" ? "Table des matières" : "Table of Contents";
    lines.push(`## ${tocLabel}`);
    lines.push("");
    for (const s of sections.slice(0, TOC_MAX_ENTRIES)) {
      const label = s.sectionLabel;
      const note = s.marginalNote ?? "";
      if (s.sectionType === "heading") {
        lines.push(`- **${label}** ${note}`.trim());
      } else {
        lines.push(`- ${label}${note ? ` — ${note}` : ""}`);
      }
    }
    if (sections.length > TOC_MAX_ENTRIES) {
      lines.push(`- ... (${sections.length - TOC_MAX_ENTRIES} more sections)`);
    }
    lines.push("");
  }

  // Sections content - build incrementally with size check
  let currentSize = lines.join("\n").length;
  for (const s of sections) {
    const label = s.sectionLabel;
    const note = s.marginalNote;

    // Build section content
    const sectionLines: string[] = [];
    if (s.sectionType === "heading") {
      sectionLines.push(`## ${label}${note ? ` — ${note}` : ""}`);
    } else if (s.sectionType === "schedule") {
      sectionLines.push(`## ${label}`);
      if (note) {
        sectionLines.push(`*${note}*`);
      }
    } else {
      const sectionHeader =
        lang === "fr" ? `### Article ${label}` : `### Section ${label}`;
      sectionLines.push(note ? `${sectionHeader} — ${note}` : sectionHeader);
    }
    sectionLines.push("");
    sectionLines.push(s.content);
    sectionLines.push("");

    const sectionText = sectionLines.join("\n");

    // Check if adding this section would exceed max size
    if (currentSize + sectionText.length > MAX_MARKDOWN_SIZE) {
      const truncNotice =
        lang === "fr"
          ? "\n\n---\n*Contenu tronqué. Consultez le site Justice Canada pour le texte complet.*"
          : "\n\n---\n*Content truncated. See Justice Canada website for full text.*";
      lines.push(truncNotice);
      break;
    }

    lines.push(...sectionLines);
    currentSize += sectionText.length;
  }

  return lines.join("\n");
}

/**
 * Get hydrated regulation markdown from the legislation database
 *
 * Fetches all sections for a regulation and formats as readable markdown.
 *
 * @param regulationId - The regulation identifier (e.g., "SOR-86-946")
 * @param language - Preferred language
 * @returns Hydrated regulation with markdown content
 */
export async function getHydratedRegulationMarkdown(args: {
  regulationId: string;
  language: Lang;
}): Promise<HydratedLegislationSource> {
  const { regulationId, language } = args;
  const db = getDb();

  dbg("hydrating regulation %s (%s)", regulationId, language);

  // Fetch regulation metadata in preferred language
  const regRows = await db
    .select()
    .from(regulations)
    .where(
      and(
        eq(regulations.regulationId, regulationId),
        eq(regulations.language, language)
      )
    )
    .limit(1);

  // If not found, try fallback language
  const fallbackLang = language === "fr" ? "en" : "fr";
  const reg =
    regRows[0] ??
    (
      await db
        .select()
        .from(regulations)
        .where(
          and(
            eq(regulations.regulationId, regulationId),
            eq(regulations.language, fallbackLang)
          )
        )
        .limit(1)
    )[0];

  if (!reg) {
    throw new Error(`Regulation ${regulationId} not found in any language`);
  }

  const usedLang = regRows.length > 0 ? language : fallbackLang;

  // Fetch sections and count in parallel
  const [sectionRows, totalSections] = await Promise.all([
    fetchRegulationSections(db, regulationId, usedLang),
    countRegulationSections(db, regulationId, usedLang),
  ]);
  dbg(
    "found %d/%d sections for regulation %s (limited to %d)",
    sectionRows.length,
    totalSections,
    regulationId,
    MAX_SECTIONS_TO_HYDRATE
  );

  const markdown = formatRegulationMarkdown({
    title: reg.title,
    longTitle: reg.longTitle,
    status: reg.status,
    consolidationDate: reg.consolidationDate,
    enablingActTitle: reg.enablingActTitle,
    sections: sectionRows,
    lang: usedLang,
    totalSections,
  });

  const result: HydratedLegislationSource = {
    sourceType: "regulation",
    markdown,
    languageUsed: usedLang,
    id: `reg-${regulationId}`,
  };

  // Add note if fallback language was used
  if (usedLang !== language) {
    result.note =
      language === "fr"
        ? "Texte français non disponible; utilisation du texte anglais."
        : "French text not available; using English source text.";
  }

  return result;
}

/**
 * Format defined term as readable markdown
 */
function formatDefinedTermMarkdown(
  result: LegislationSearchResult,
  lang: Lang
): string {
  const meta = result.metadata;
  const lines: string[] = [];

  // Header
  const termLabel = lang === "fr" ? "Terme défini" : "Defined Term";
  lines.push(`# ${termLabel}: ${meta.term ?? "Unknown"}`);
  lines.push("");

  // Paired term if available
  if (meta.termPaired) {
    const pairedLabel =
      lang === "fr" ? "Terme correspondant" : "Corresponding term";
    lines.push(`**${pairedLabel}:** ${meta.termPaired}`);
    lines.push("");
  }

  // Source document
  const sourceLabel = lang === "fr" ? "Source" : "Source";
  lines.push(`**${sourceLabel}:** ${meta.documentTitle ?? "Unknown"}`);

  // Section reference if available
  if (meta.sectionLabel) {
    const sectionLabel = lang === "fr" ? "Article" : "Section";
    lines.push(`**${sectionLabel}:** ${meta.sectionLabel}`);
  }

  // Scope if specified
  if (meta.scopeType && meta.scopeType !== "act") {
    const scopeLabel = lang === "fr" ? "Portée" : "Scope";
    lines.push(`**${scopeLabel}:** ${meta.scopeType}`);
  }

  lines.push("");

  // Definition content
  const defLabel = lang === "fr" ? "Définition" : "Definition";
  lines.push(`## ${defLabel}`);
  lines.push("");
  lines.push(result.content);

  return lines.join("\n");
}

/**
 * Hydrate a defined term search result into markdown
 */
function hydrateDefinedTerm(
  result: LegislationSearchResult,
  language: Lang
): HydratedLegislationSource {
  const meta = result.metadata;
  const usedLang = meta.language === language ? language : meta.language;

  return {
    sourceType: "defined_term",
    markdown: formatDefinedTermMarkdown(result, usedLang as Lang),
    languageUsed: usedLang as Lang,
    id: `term-${meta.termId ?? "unknown"}`,
    note:
      usedLang !== language
        ? language === "fr"
          ? "Définition non disponible en français."
          : "Definition not available in English."
        : undefined,
  };
}

/**
 * Format footnote as readable markdown
 */
function formatFootnoteMarkdown(
  result: LegislationSearchResult,
  lang: Lang
): string {
  const meta = result.metadata;
  const lines: string[] = [];

  // Header
  const footnoteLabel = lang === "fr" ? "Note de bas de page" : "Footnote";
  const labelPart = meta.footnoteLabel ? ` [${meta.footnoteLabel}]` : "";
  lines.push(`# ${footnoteLabel}${labelPart}`);
  lines.push("");

  // Source document
  const sourceLabel = lang === "fr" ? "Source" : "Source";
  lines.push(`**${sourceLabel}:** ${meta.documentTitle ?? "Unknown"}`);

  // Section reference
  if (meta.sectionLabel) {
    const sectionLabel = lang === "fr" ? "Article" : "Section";
    lines.push(`**${sectionLabel}:** ${meta.sectionLabel}`);
  }

  // Footnote type/status
  if (meta.footnoteStatus) {
    const typeLabel = lang === "fr" ? "Type" : "Type";
    const statusText =
      lang === "fr"
        ? meta.footnoteStatus === "editorial"
          ? "Éditoriale"
          : "Officielle"
        : meta.footnoteStatus === "editorial"
          ? "Editorial"
          : "Official";
    lines.push(`**${typeLabel}:** ${statusText}`);
  }

  lines.push("");

  // Footnote content
  const contentLabel = lang === "fr" ? "Contenu" : "Content";
  lines.push(`## ${contentLabel}`);
  lines.push("");
  lines.push(result.content);

  return lines.join("\n");
}

/**
 * Hydrate a footnote search result into markdown
 */
function hydrateFootnote(
  result: LegislationSearchResult,
  language: Lang
): HydratedLegislationSource {
  const meta = result.metadata;
  const usedLang = meta.language === language ? language : meta.language;

  return {
    sourceType: "footnote",
    markdown: formatFootnoteMarkdown(result, usedLang as Lang),
    languageUsed: usedLang as Lang,
    id: `footnote-${meta.actId ?? meta.regulationId ?? "unknown"}-${meta.sectionLabel ?? ""}-${meta.footnoteId ?? "unknown"}`,
    note:
      usedLang !== language
        ? language === "fr"
          ? "Note non disponible en français."
          : "Note not available in English."
        : undefined,
  };
}

/**
 * Format related provisions as readable markdown
 */
function formatRelatedProvisionsMarkdown(
  result: LegislationSearchResult,
  lang: Lang
): string {
  const meta = result.metadata;
  const lines: string[] = [];

  // Header
  const headerLabel =
    lang === "fr" ? "Dispositions connexes" : "Related Provisions";
  lines.push(`# ${headerLabel}`);
  lines.push("");

  // Provision label if available
  if (meta.relatedProvisionLabel) {
    const labelLabel = lang === "fr" ? "Étiquette" : "Label";
    lines.push(`**${labelLabel}:** ${meta.relatedProvisionLabel}`);
  }

  // Source document
  const sourceLabel = lang === "fr" ? "Document source" : "Source Document";
  lines.push(`**${sourceLabel}:** ${meta.documentTitle ?? "Unknown"}`);

  // Provision source reference
  if (meta.relatedProvisionSource) {
    const refLabel = lang === "fr" ? "Référence" : "Reference";
    lines.push(`**${refLabel}:** ${meta.relatedProvisionSource}`);
  }

  // Referenced sections
  if (meta.relatedProvisionSections?.length) {
    const sectionsLabel =
      lang === "fr" ? "Articles visés" : "Referenced Sections";
    lines.push(
      `**${sectionsLabel}:** ${meta.relatedProvisionSections.join(", ")}`
    );
  }

  lines.push("");

  // Provision content
  const contentLabel = lang === "fr" ? "Contenu" : "Content";
  lines.push(`## ${contentLabel}`);
  lines.push("");
  lines.push(result.content);

  return lines.join("\n");
}

/**
 * Hydrate a related provisions search result into markdown
 */
function hydrateRelatedProvisions(
  result: LegislationSearchResult,
  language: Lang
): HydratedLegislationSource {
  const meta = result.metadata;
  const usedLang = meta.language === language ? language : meta.language;

  return {
    sourceType: "related_provisions",
    markdown: formatRelatedProvisionsMarkdown(result, usedLang as Lang),
    languageUsed: usedLang as Lang,
    id: `relprov-${meta.actId ?? meta.regulationId ?? "unknown"}-${meta.relatedProvisionLabel ?? meta.relatedProvisionSource ?? "unknown"}`,
    note:
      usedLang !== language
        ? language === "fr"
          ? "Dispositions non disponibles en français."
          : "Provisions not available in English."
        : undefined,
  };
}

/**
 * Format preamble as readable markdown
 */
function formatPreambleMarkdown(
  result: LegislationSearchResult,
  lang: Lang
): string {
  const meta = result.metadata;
  const lines: string[] = [];

  // Header
  const headerLabel = lang === "fr" ? "Préambule" : "Preamble";
  lines.push(`# ${headerLabel}`);
  lines.push("");

  // Source document
  const sourceLabel = lang === "fr" ? "Document source" : "Source Document";
  lines.push(`**${sourceLabel}:** ${meta.documentTitle ?? "Unknown"}`);
  lines.push("");

  // Preamble content
  lines.push(result.content);

  return lines.join("\n");
}

/**
 * Hydrate a preamble search result into markdown
 */
function hydratePreamble(
  result: LegislationSearchResult,
  language: Lang
): HydratedLegislationSource {
  const meta = result.metadata;
  const usedLang = meta.language === language ? language : meta.language;

  return {
    sourceType: "preamble",
    markdown: formatPreambleMarkdown(result, usedLang as Lang),
    languageUsed: usedLang as Lang,
    id: `preamble-${meta.actId ?? meta.regulationId ?? "unknown"}-${meta.preambleIndex ?? 0}`,
    note:
      usedLang !== language
        ? language === "fr"
          ? "Préambule non disponible en français."
          : "Preamble not available in English."
        : undefined,
  };
}

/**
 * Format treaty as readable markdown
 */
function formatTreatyMarkdown(
  result: LegislationSearchResult,
  lang: Lang
): string {
  const meta = result.metadata;
  const lines: string[] = [];

  // Header with treaty title if available
  const headerLabel = lang === "fr" ? "Traité" : "Treaty";
  const title =
    meta.treatyTitle ?? (lang === "fr" ? "Convention" : "Convention");
  lines.push(`# ${headerLabel}: ${title}`);
  lines.push("");

  // Source document
  const sourceLabel = lang === "fr" ? "Document source" : "Source Document";
  lines.push(`**${sourceLabel}:** ${meta.documentTitle ?? "Unknown"}`);
  lines.push("");

  // Treaty content
  const contentLabel = lang === "fr" ? "Contenu" : "Content";
  lines.push(`## ${contentLabel}`);
  lines.push("");
  lines.push(result.content);

  return lines.join("\n");
}

/**
 * Hydrate a treaty search result into markdown
 */
function hydrateTreaty(
  result: LegislationSearchResult,
  language: Lang
): HydratedLegislationSource {
  const meta = result.metadata;
  const usedLang = meta.language === language ? language : meta.language;

  return {
    sourceType: "treaty",
    markdown: formatTreatyMarkdown(result, usedLang as Lang),
    languageUsed: usedLang as Lang,
    id: `treaty-${meta.actId ?? meta.regulationId ?? "unknown"}-${meta.treatyTitle ?? "unknown"}`,
    note:
      usedLang !== language
        ? language === "fr"
          ? "Traité non disponible en français."
          : "Treaty not available in English."
        : undefined,
  };
}

/**
 * Format cross-reference as readable markdown
 */
function formatCrossReferenceMarkdown(
  result: LegislationSearchResult,
  lang: Lang
): string {
  const meta = result.metadata;
  const lines: string[] = [];

  // Header
  const headerLabel = lang === "fr" ? "Renvoi" : "Cross-Reference";
  lines.push(`# ${headerLabel}`);
  lines.push("");

  // Source document
  const sourceLabel = lang === "fr" ? "Document source" : "Source Document";
  lines.push(`**${sourceLabel}:** ${meta.documentTitle ?? "Unknown"}`);

  // Target document
  if (meta.targetDocumentTitle) {
    const targetLabel = lang === "fr" ? "Document cible" : "Target Document";
    lines.push(`**${targetLabel}:** ${meta.targetDocumentTitle}`);
  }

  // Target reference
  if (meta.targetRef) {
    const refLabel = lang === "fr" ? "Référence" : "Reference";
    lines.push(`**${refLabel}:** ${meta.targetRef}`);
  }

  // Target section
  if (meta.targetSectionRef) {
    const sectionLabel = lang === "fr" ? "Article cible" : "Target Section";
    lines.push(`**${sectionLabel}:** ${meta.targetSectionRef}`);
  }

  lines.push("");

  // Cross-reference content
  lines.push(result.content);

  return lines.join("\n");
}

/**
 * Hydrate a cross-reference search result into markdown
 */
function hydrateCrossReference(
  result: LegislationSearchResult,
  language: Lang
): HydratedLegislationSource {
  const meta = result.metadata;
  const usedLang = meta.language === language ? language : meta.language;

  return {
    sourceType: "cross_reference",
    markdown: formatCrossReferenceMarkdown(result, usedLang as Lang),
    languageUsed: usedLang as Lang,
    id: `xref-${meta.crossRefId ?? "unknown"}`,
    note:
      usedLang !== language
        ? language === "fr"
          ? "Renvoi non disponible en français."
          : "Cross-reference not available in English."
        : undefined,
  };
}

/**
 * Format table of provisions as readable markdown
 */
function formatTableOfProvisionsMarkdown(
  result: LegislationSearchResult,
  lang: Lang
): string {
  const meta = result.metadata;
  const lines: string[] = [];

  // Header
  const headerLabel =
    lang === "fr" ? "Table des dispositions" : "Table of Provisions";
  lines.push(`# ${headerLabel}`);
  lines.push("");

  // Source document
  const sourceLabel = lang === "fr" ? "Document" : "Document";
  lines.push(`**${sourceLabel}:** ${meta.documentTitle ?? "Unknown"}`);

  // Provision count if available
  if (meta.provisionCount) {
    const countLabel = lang === "fr" ? "Dispositions" : "Provisions";
    lines.push(`**${countLabel}:** ${meta.provisionCount}`);
  }

  lines.push("");

  // Table content
  lines.push(result.content);

  return lines.join("\n");
}

/**
 * Hydrate a table of provisions search result into markdown
 */
function hydrateTableOfProvisions(
  result: LegislationSearchResult,
  language: Lang
): HydratedLegislationSource {
  const meta = result.metadata;
  const usedLang = meta.language === language ? language : meta.language;

  return {
    sourceType: "table_of_provisions",
    markdown: formatTableOfProvisionsMarkdown(result, usedLang as Lang),
    languageUsed: usedLang as Lang,
    id: `toc-${meta.actId ?? meta.regulationId ?? "unknown"}`,
    note:
      usedLang !== language
        ? language === "fr"
          ? "Table non disponible en français."
          : "Table not available in English."
        : undefined,
  };
}

/**
 * Format signature block as readable markdown
 */
function formatSignatureBlockMarkdown(
  result: LegislationSearchResult,
  lang: Lang
): string {
  const meta = result.metadata;
  const lines: string[] = [];

  // Header
  const headerLabel = lang === "fr" ? "Bloc de signature" : "Signature Block";
  lines.push(`# ${headerLabel}`);
  lines.push("");

  // Source document
  const sourceLabel = lang === "fr" ? "Document" : "Document";
  lines.push(`**${sourceLabel}:** ${meta.documentTitle ?? "Unknown"}`);

  // Signatory name
  if (meta.signatureName) {
    const nameLabel = lang === "fr" ? "Signataire" : "Signatory";
    lines.push(`**${nameLabel}:** ${meta.signatureName}`);
  }

  // Signatory title
  if (meta.signatureTitle) {
    const titleLabel = lang === "fr" ? "Titre" : "Title";
    lines.push(`**${titleLabel}:** ${meta.signatureTitle}`);
  }

  // Signature date
  if (meta.signatureDate) {
    const dateLabel = lang === "fr" ? "Date" : "Date";
    lines.push(`**${dateLabel}:** ${meta.signatureDate}`);
  }

  lines.push("");

  // Signature content
  lines.push(result.content);

  return lines.join("\n");
}

/**
 * Hydrate a signature block search result into markdown
 */
function hydrateSignatureBlock(
  result: LegislationSearchResult,
  language: Lang
): HydratedLegislationSource {
  const meta = result.metadata;
  const usedLang = meta.language === language ? language : meta.language;

  return {
    sourceType: "signature_block",
    markdown: formatSignatureBlockMarkdown(result, usedLang as Lang),
    languageUsed: usedLang as Lang,
    id: `sig-${meta.actId ?? meta.regulationId ?? "unknown"}-${meta.signatureName ?? "unknown"}`,
    note:
      usedLang !== language
        ? language === "fr"
          ? "Signature non disponible en français."
          : "Signature not available in English."
        : undefined,
  };
}

/**
 * Format marginal note as readable markdown
 */
function formatMarginalNoteMarkdown(
  result: LegislationSearchResult,
  lang: Lang
): string {
  const meta = result.metadata;
  const lines: string[] = [];

  // Header
  const headerLabel = lang === "fr" ? "Note marginale" : "Marginal Note";
  lines.push(`# ${headerLabel}`);
  lines.push("");

  // Source document
  const sourceLabel = lang === "fr" ? "Document" : "Document";
  lines.push(`**${sourceLabel}:** ${meta.documentTitle ?? "Unknown"}`);

  // Section reference
  if (meta.sectionLabel) {
    const sectionLabel = lang === "fr" ? "Article" : "Section";
    lines.push(`**${sectionLabel}:** ${meta.sectionLabel}`);
  }

  lines.push("");

  // Marginal note content
  lines.push(result.content);

  return lines.join("\n");
}

/**
 * Hydrate a marginal note search result into markdown
 */
function hydrateMarginalNote(
  result: LegislationSearchResult,
  language: Lang
): HydratedLegislationSource {
  const meta = result.metadata;
  const usedLang = meta.language === language ? language : meta.language;

  return {
    sourceType: "marginal_note",
    markdown: formatMarginalNoteMarkdown(result, usedLang as Lang),
    languageUsed: usedLang as Lang,
    id: `marginal-${meta.actId ?? meta.regulationId ?? "unknown"}-${meta.sectionId ?? meta.sectionLabel ?? "unknown"}`,
    note:
      usedLang !== language
        ? language === "fr"
          ? "Note non disponible en français."
          : "Note not available in English."
        : undefined,
  };
}

/**
 * Format schedule section as readable markdown
 */
function formatScheduleMarkdown(
  result: LegislationSearchResult,
  lang: Lang
): string {
  const meta = result.metadata;
  const lines: string[] = [];

  // Header with schedule info
  const headerLabel = lang === "fr" ? "Annexe" : "Schedule";
  const scheduleId = meta.scheduleId ?? "";
  lines.push(`# ${headerLabel}${scheduleId ? ` ${scheduleId}` : ""}`);
  lines.push("");

  // Source document
  const sourceLabel = lang === "fr" ? "Document" : "Document";
  lines.push(`**${sourceLabel}:** ${meta.documentTitle ?? "Unknown"}`);

  // Section reference
  if (meta.sectionLabel) {
    const sectionLabel = lang === "fr" ? "Article" : "Section";
    lines.push(`**${sectionLabel}:** ${meta.sectionLabel}`);
  }

  // Marginal note
  if (meta.marginalNote) {
    const noteLabel = lang === "fr" ? "Note marginale" : "Marginal Note";
    lines.push(`**${noteLabel}:** ${meta.marginalNote}`);
  }

  lines.push("");

  // Schedule content
  lines.push(result.content);

  return lines.join("\n");
}

/**
 * Hydrate a schedule search result into markdown
 */
function hydrateSchedule(
  result: LegislationSearchResult,
  language: Lang
): HydratedLegislationSource {
  const meta = result.metadata;
  const usedLang = meta.language === language ? language : meta.language;

  return {
    sourceType: "schedule",
    markdown: formatScheduleMarkdown(result, usedLang as Lang),
    languageUsed: usedLang as Lang,
    id: `schedule-${meta.actId ?? meta.regulationId ?? "unknown"}-${meta.sectionId ?? meta.scheduleId ?? "unknown"}`,
    note:
      usedLang !== language
        ? language === "fr"
          ? "Annexe non disponible en français."
          : "Schedule not available in English."
        : undefined,
  };
}

/**
 * Hydrate search result based on its source type.
 * Returns null if hydration fails or source type is not supported.
 *
 * Supported types:
 * - act, act_section: Full act content with sections
 * - regulation, regulation_section: Full regulation content with sections
 * - defined_term: Term definition with context
 * - footnote: Footnote content with section context
 * - related_provisions: Related provisions content with document context
 * - preamble: Preamble content with document context
 * - treaty: Treaty/convention content with document context
 * - cross_reference: Cross-reference with target document context
 * - table_of_provisions: Document table of contents
 * - signature_block: Official signatures with signatory info
 * - marginal_note: Section headings with document context
 * - schedule: Schedule content with section context
 */
export async function hydrateSearchResult(
  result: LegislationSearchResult,
  language: Lang
): Promise<HydratedLegislationSource | null> {
  const meta = result.metadata;
  const { sourceType } = meta;

  try {
    // Acts and act sections - hydrate full document
    if (sourceType === "act" || sourceType === "act_section") {
      if (!meta.actId) {
        dbg("skipping hydration: no actId for source type %s", sourceType);
        return null;
      }
      return await getHydratedActMarkdown({ actId: meta.actId, language });
    }

    // Regulations and regulation sections - hydrate full document
    if (sourceType === "regulation" || sourceType === "regulation_section") {
      if (!meta.regulationId) {
        dbg(
          "skipping hydration: no regulationId for source type %s",
          sourceType
        );
        return null;
      }
      return await getHydratedRegulationMarkdown({
        regulationId: meta.regulationId,
        language,
      });
    }

    // Defined terms - use search result content directly
    if (sourceType === "defined_term") {
      return hydrateDefinedTerm(result, language);
    }

    // Footnotes - use search result content with section context
    if (sourceType === "footnote") {
      return hydrateFootnote(result, language);
    }

    // Related provisions - use search result content with document context
    if (sourceType === "related_provisions") {
      return hydrateRelatedProvisions(result, language);
    }

    // Preambles - use search result content with document context
    if (sourceType === "preamble") {
      return hydratePreamble(result, language);
    }

    // Treaties - use search result content with document context
    if (sourceType === "treaty") {
      return hydrateTreaty(result, language);
    }

    // Cross-references - use search result content with target info
    if (sourceType === "cross_reference") {
      return hydrateCrossReference(result, language);
    }

    // Table of provisions - use search result content with document context
    if (sourceType === "table_of_provisions") {
      return hydrateTableOfProvisions(result, language);
    }

    // Signature blocks - use search result content with signatory info
    if (sourceType === "signature_block") {
      return hydrateSignatureBlock(result, language);
    }

    // Marginal notes - use search result content with section context
    if (sourceType === "marginal_note") {
      return hydrateMarginalNote(result, language);
    }

    // Schedules - use search result content with schedule context
    if (sourceType === "schedule") {
      return hydrateSchedule(result, language);
    }

    // Unknown source type - log and return null
    dbg("hydration not supported for source type %s", sourceType);
    return null;
  } catch (err) {
    dbg("hydration failed for %s: %O", meta.actId ?? meta.regulationId, err);
    return null;
  }
}

/**
 * Hydrate top act from search results.
 *
 * Finds the first act result and hydrates it with full content.
 * Returns array with single hydrated source (for consistency with parliament's hydrateTopPerType).
 */
export async function hydrateTopAct(
  results: LegislationSearchResult[],
  language: Lang
): Promise<HydratedLegislationSource[]> {
  // Find first act result
  const actResult = results.find(
    (r) =>
      (r.metadata.sourceType === "act" ||
        r.metadata.sourceType === "act_section") &&
      r.metadata.actId
  );

  if (!actResult) {
    return [];
  }

  const hydrated = await hydrateSearchResult(actResult, language);
  return hydrated ? [hydrated] : [];
}

/**
 * Hydrate top defined term from search results.
 *
 * Finds the first defined term result and formats it for display.
 * Returns array with single hydrated source.
 */
export async function hydrateTopDefinedTerm(
  results: LegislationSearchResult[],
  language: Lang
): Promise<HydratedLegislationSource[]> {
  // Find first defined term result
  const termResult = results.find(
    (r) => r.metadata.sourceType === "defined_term"
  );

  if (!termResult) {
    return [];
  }

  const hydrated = await hydrateSearchResult(termResult, language);
  return hydrated ? [hydrated] : [];
}

/**
 * Hydrate top source from search results based on source type priority.
 *
 * Priority order:
 * 1. Defined terms (for definition queries)
 * 2. Acts (most common)
 * 3. Regulations
 *
 * Returns array with single hydrated source for the most relevant type.
 */
export async function hydrateTopSource(
  results: LegislationSearchResult[],
  language: Lang
): Promise<HydratedLegislationSource[]> {
  if (results.length === 0) {
    return [];
  }

  // Check top result's source type to determine priority
  const topResult = results[0];
  const topType = topResult.metadata.sourceType;

  // If top result is a defined term, prioritize terms
  if (topType === "defined_term") {
    const hydrated = await hydrateTopDefinedTerm(results, language);
    if (hydrated.length > 0) {
      return hydrated;
    }
  }

  // Otherwise, try acts first, then regulations
  const actHydrated = await hydrateTopAct(results, language);
  if (actHydrated.length > 0) {
    return actHydrated;
  }

  // Find first regulation result
  const regResult = results.find(
    (r) =>
      (r.metadata.sourceType === "regulation" ||
        r.metadata.sourceType === "regulation_section") &&
      r.metadata.regulationId
  );

  if (regResult) {
    const hydrated = await hydrateSearchResult(regResult, language);
    return hydrated ? [hydrated] : [];
  }

  return [];
}
