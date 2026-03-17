/**
 * Legislation Citations
 *
 * Builds bilingual citations for acts and regulations with proper URLs
 * to the Justice Canada Laws website.
 */

import type { LegResourceMetadata } from "@/lib/db/rag/schema";

/**
 * Base citation type for legislation
 * Note: prefixedId is set by context-builder when building final citations.
 * The buildCitation functions set a placeholder that gets overwritten.
 */
export type LegislationCitation = {
  id: number; // numeric part of citation (1, 2, 3...)
  prefixedId: string; // prefixed ID for display (L1, L2, L3...) - set by context-builder
  textEn: string;
  textFr: string;
  urlEn: string;
  urlFr: string;
  titleEn: string;
  titleFr: string;
  sourceType: LegResourceMetadata["sourceType"];
};

const JUSTICE_BASE_URL = "https://laws-lois.justice.gc.ca";

/**
 * Build URL path for an act
 * Format: /eng/acts/{actId}/page-1.html
 */
function buildActUrl(actId: string, lang: "en" | "fr"): string {
  const langPath = lang === "en" ? "eng" : "fra";
  const typePath = lang === "en" ? "acts" : "lois";
  return `${JUSTICE_BASE_URL}/${langPath}/${typePath}/${actId}/page-1.html`;
}

/**
 * Build URL path for a regulation
 * Format: /eng/regulations/{regulationId}/page-1.html
 */
function buildRegulationUrl(regulationId: string, lang: "en" | "fr"): string {
  const langPath = lang === "en" ? "eng" : "fra";
  const typePath = lang === "en" ? "regulations" : "reglements";
  return `${JUSTICE_BASE_URL}/${langPath}/${typePath}/${regulationId}/page-1.html`;
}

/**
 * Build URL for a specific section within an act or regulation
 * Adds anchor to section label
 */
function buildSectionUrl(
  baseUrl: string,
  sectionLabel: string | undefined
): string {
  if (!sectionLabel) {
    return baseUrl;
  }
  // Sections are typically anchored by their label
  // e.g., #sec91 for section 91
  const anchor = sectionLabel.replace(/[^a-zA-Z0-9]/g, "");
  return `${baseUrl}#sec${anchor}`;
}

/**
 * Build a citation for an act metadata chunk
 */
export function buildActCitation(
  metadata: LegResourceMetadata,
  citationId: number
): LegislationCitation {
  const actId = metadata.actId || "unknown";
  const title = metadata.documentTitle || `Act ${actId}`;

  const urlEn = buildActUrl(actId, "en");
  const urlFr = buildActUrl(actId, "fr");

  return {
    id: citationId,
    prefixedId: "", // Set by context-builder
    textEn: `[${title}]`,
    textFr: `[${title}]`,
    urlEn,
    urlFr,
    titleEn: metadata.language === "en" ? title : title,
    titleFr: metadata.language === "fr" ? title : title,
    sourceType: "act",
  };
}

/**
 * Build a citation for an act section
 */
export function buildActSectionCitation(
  metadata: LegResourceMetadata,
  citationId: number
): LegislationCitation {
  const actId = metadata.actId || "unknown";
  const title = metadata.documentTitle || `Act ${actId}`;
  const sectionLabel = metadata.sectionLabel || "";

  const baseUrlEn = buildActUrl(actId, "en");
  const baseUrlFr = buildActUrl(actId, "fr");
  const urlEn = buildSectionUrl(baseUrlEn, sectionLabel);
  const urlFr = buildSectionUrl(baseUrlFr, sectionLabel);

  const sectionTextEn = sectionLabel ? `, s ${sectionLabel}` : "";
  const sectionTextFr = sectionLabel ? `, art ${sectionLabel}` : "";

  return {
    id: citationId,
    prefixedId: "", // Set by context-builder
    textEn: `[${title}${sectionTextEn}]`,
    textFr: `[${title}${sectionTextFr}]`,
    urlEn,
    urlFr,
    titleEn: metadata.language === "en" ? title : title,
    titleFr: metadata.language === "fr" ? title : title,
    sourceType: "act_section",
  };
}

/**
 * Build a citation for a regulation metadata chunk
 */
export function buildRegulationCitation(
  metadata: LegResourceMetadata,
  citationId: number
): LegislationCitation {
  const regId = metadata.regulationId || "unknown";
  const title = metadata.documentTitle || `Regulation ${regId}`;

  const urlEn = buildRegulationUrl(regId, "en");
  const urlFr = buildRegulationUrl(regId, "fr");

  return {
    id: citationId,
    prefixedId: "", // Set by context-builder
    textEn: `[${title}]`,
    textFr: `[${title}]`,
    urlEn,
    urlFr,
    titleEn: metadata.language === "en" ? title : title,
    titleFr: metadata.language === "fr" ? title : title,
    sourceType: "regulation",
  };
}

/**
 * Build a citation for a regulation section
 */
export function buildRegulationSectionCitation(
  metadata: LegResourceMetadata,
  citationId: number
): LegislationCitation {
  const regId = metadata.regulationId || "unknown";
  const title = metadata.documentTitle || `Regulation ${regId}`;
  const sectionLabel = metadata.sectionLabel || "";

  const baseUrlEn = buildRegulationUrl(regId, "en");
  const baseUrlFr = buildRegulationUrl(regId, "fr");
  const urlEn = buildSectionUrl(baseUrlEn, sectionLabel);
  const urlFr = buildSectionUrl(baseUrlFr, sectionLabel);

  const sectionTextEn = sectionLabel ? `, s ${sectionLabel}` : "";
  const sectionTextFr = sectionLabel ? `, art ${sectionLabel}` : "";

  return {
    id: citationId,
    prefixedId: "", // Set by context-builder
    textEn: `[${title}${sectionTextEn}]`,
    textFr: `[${title}${sectionTextFr}]`,
    urlEn,
    urlFr,
    titleEn: metadata.language === "en" ? title : title,
    titleFr: metadata.language === "fr" ? title : title,
    sourceType: "regulation_section",
  };
}

/**
 * Build citation from metadata, dispatching to appropriate builder
 */
export function buildCitation(
  metadata: LegResourceMetadata,
  citationId: number
): LegislationCitation {
  switch (metadata.sourceType) {
    case "act":
      return buildActCitation(metadata, citationId);
    case "act_section":
      return buildActSectionCitation(metadata, citationId);
    case "regulation":
      return buildRegulationCitation(metadata, citationId);
    case "regulation_section":
      return buildRegulationSectionCitation(metadata, citationId);
    default:
      // Fallback for any unexpected type
      return {
        id: citationId,
        prefixedId: "", // Set by context-builder
        textEn: `[${metadata.documentTitle || "Legislation"}]`,
        textFr: `[${metadata.documentTitle || "Législation"}]`,
        urlEn: JUSTICE_BASE_URL,
        urlFr: JUSTICE_BASE_URL,
        titleEn: metadata.documentTitle || "Legislation",
        titleFr: metadata.documentTitle || "Législation",
        sourceType: metadata.sourceType,
      };
  }
}
