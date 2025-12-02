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
 * Build URLs for parent document (act or regulation)
 */
function buildParentUrls(metadata: LegResourceMetadata): {
  urlEn: string;
  urlFr: string;
} {
  if (metadata.actId) {
    return {
      urlEn: buildActUrl(metadata.actId, "en"),
      urlFr: buildActUrl(metadata.actId, "fr"),
    };
  }
  if (metadata.regulationId) {
    return {
      urlEn: buildRegulationUrl(metadata.regulationId, "en"),
      urlFr: buildRegulationUrl(metadata.regulationId, "fr"),
    };
  }
  return { urlEn: JUSTICE_BASE_URL, urlFr: JUSTICE_BASE_URL };
}

/**
 * Build a citation for a defined term
 */
export function buildDefinedTermCitation(
  metadata: LegResourceMetadata,
  citationId: number
): LegislationCitation {
  const term = metadata.term || "Term";
  const title = metadata.documentTitle || "Legislation";
  const sectionLabel = metadata.sectionLabel;
  const { urlEn, urlFr } = buildParentUrls(metadata);

  // Add section anchor if available
  const finalUrlEn = sectionLabel
    ? buildSectionUrl(urlEn, sectionLabel)
    : urlEn;
  const finalUrlFr = sectionLabel
    ? buildSectionUrl(urlFr, sectionLabel)
    : urlFr;

  const sectionRefEn = sectionLabel ? `, s ${sectionLabel}` : "";
  const sectionRefFr = sectionLabel ? `, art ${sectionLabel}` : "";

  return {
    id: citationId,
    prefixedId: "", // Set by context-builder
    textEn: `["${term}" - ${title}${sectionRefEn}]`,
    textFr: `[« ${term} » - ${title}${sectionRefFr}]`,
    urlEn: finalUrlEn,
    urlFr: finalUrlFr,
    titleEn: `"${term}" defined in ${title}`,
    titleFr: `« ${term} » défini dans ${title}`,
    sourceType: "defined_term",
  };
}

/**
 * Build a citation for a preamble
 */
export function buildPreambleCitation(
  metadata: LegResourceMetadata,
  citationId: number
): LegislationCitation {
  const title = metadata.documentTitle || "Legislation";
  const { urlEn, urlFr } = buildParentUrls(metadata);

  return {
    id: citationId,
    prefixedId: "", // Set by context-builder
    textEn: `[${title}, Preamble]`,
    textFr: `[${title}, Préambule]`,
    urlEn,
    urlFr,
    titleEn: `Preamble of ${title}`,
    titleFr: `Préambule de ${title}`,
    sourceType: "preamble",
  };
}

/**
 * Build a citation for a treaty/convention
 */
export function buildTreatyCitation(
  metadata: LegResourceMetadata,
  citationId: number
): LegislationCitation {
  const treatyTitle = metadata.treatyTitle;
  const docTitle = metadata.documentTitle || "Legislation";
  const { urlEn, urlFr } = buildParentUrls(metadata);

  // If treaty has its own title, use it; otherwise reference the parent document
  const displayTitleEn = treatyTitle || `Treaty in ${docTitle}`;
  const displayTitleFr = treatyTitle || `Traité dans ${docTitle}`;

  return {
    id: citationId,
    prefixedId: "", // Set by context-builder
    textEn: `[${displayTitleEn}]`,
    textFr: `[${displayTitleFr}]`,
    urlEn,
    urlFr,
    titleEn: displayTitleEn,
    titleFr: displayTitleFr,
    sourceType: "treaty",
  };
}

/**
 * Build a citation for a cross-reference
 */
export function buildCrossReferenceCitation(
  metadata: LegResourceMetadata,
  citationId: number
): LegislationCitation {
  const sourceTitle = metadata.documentTitle || "Legislation";
  const targetRef = metadata.targetRef || "";
  const targetType = metadata.targetType === "act" ? "Act" : "Regulation";
  const targetTypeFr = metadata.targetType === "act" ? "Loi" : "Règlement";
  const { urlEn, urlFr } = buildParentUrls(metadata);

  // Build target URL if we have a target reference
  let targetUrlEn = urlEn;
  let targetUrlFr = urlFr;
  if (targetRef) {
    if (metadata.targetType === "act") {
      targetUrlEn = buildActUrl(targetRef, "en");
      targetUrlFr = buildActUrl(targetRef, "fr");
    } else if (metadata.targetType === "regulation") {
      targetUrlEn = buildRegulationUrl(targetRef, "en");
      targetUrlFr = buildRegulationUrl(targetRef, "fr");
    }
  }

  return {
    id: citationId,
    prefixedId: "", // Set by context-builder
    textEn: `[${sourceTitle} → ${targetType} ${targetRef}]`,
    textFr: `[${sourceTitle} → ${targetTypeFr} ${targetRef}]`,
    urlEn: targetUrlEn,
    urlFr: targetUrlFr,
    titleEn: `Cross-reference from ${sourceTitle} to ${targetRef}`,
    titleFr: `Renvoi de ${sourceTitle} à ${targetRef}`,
    sourceType: "cross_reference",
  };
}

/**
 * Build a citation for a table of provisions entry
 */
export function buildTableOfProvisionsCitation(
  metadata: LegResourceMetadata,
  citationId: number
): LegislationCitation {
  const title = metadata.documentTitle || "Legislation";
  const provisionLabel = metadata.provisionLabel || "";
  const provisionTitle = metadata.provisionTitle || "";
  const { urlEn, urlFr } = buildParentUrls(metadata);

  const labelPart = provisionLabel ? ` - ${provisionLabel}` : "";
  const titlePart = provisionTitle ? `: ${provisionTitle}` : "";

  return {
    id: citationId,
    prefixedId: "", // Set by context-builder
    textEn: `[${title}, Table of Provisions${labelPart}${titlePart}]`,
    textFr: `[${title}, Table des dispositions${labelPart}${titlePart}]`,
    urlEn,
    urlFr,
    titleEn: `Table of Provisions of ${title}`,
    titleFr: `Table des dispositions de ${title}`,
    sourceType: "table_of_provisions",
  };
}

/**
 * Build a citation for a signature block
 */
export function buildSignatureBlockCitation(
  metadata: LegResourceMetadata,
  citationId: number
): LegislationCitation {
  const title = metadata.documentTitle || "Legislation";
  const signatoryName = metadata.signatureName;
  const signatoryTitle = metadata.signatureTitle;
  const { urlEn, urlFr } = buildParentUrls(metadata);

  // Build signatory info if available
  let signatoryPart = "";
  if (signatoryName) {
    signatoryPart = signatoryTitle
      ? ` - ${signatoryName}, ${signatoryTitle}`
      : ` - ${signatoryName}`;
  }

  return {
    id: citationId,
    prefixedId: "", // Set by context-builder
    textEn: `[${title}, Signature${signatoryPart}]`,
    textFr: `[${title}, Signature${signatoryPart}]`,
    urlEn,
    urlFr,
    titleEn: `Signature block of ${title}`,
    titleFr: `Bloc de signature de ${title}`,
    sourceType: "signature_block",
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
    case "defined_term":
      return buildDefinedTermCitation(metadata, citationId);
    case "preamble":
      return buildPreambleCitation(metadata, citationId);
    case "treaty":
      return buildTreatyCitation(metadata, citationId);
    case "cross_reference":
      return buildCrossReferenceCitation(metadata, citationId);
    case "table_of_provisions":
      return buildTableOfProvisionsCitation(metadata, citationId);
    case "signature_block":
      return buildSignatureBlockCitation(metadata, citationId);
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
