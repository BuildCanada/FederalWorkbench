import type { ResourceMetadata } from "@/lib/db/rag/schema";
import type {
  BaseCitation,
  CitationOverrides,
} from "@/lib/rag/parliament/sources/types";

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

const LABELS = {
  unknownPolitician: { en: "Unknown Politician", fr: "Politicien inconnu" },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Input Types - explicit fields needed for citation building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for building politician citations
 */
export type PoliticianCitationInput = {
  politicianName?: string;
  partyShortEn?: string;
  partyShortFr?: string;
  ridingNameEn?: string;
  ridingNameFr?: string;
  memberId?: number;
  slug?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Citation Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Citation information for a politician
 */
export type PoliticianCitation = BaseCitation & { sourceType: "politician" };

// ─────────────────────────────────────────────────────────────────────────────
// URL Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build politician page URLs for EN and FR
 * Format: https://www.ourcommons.ca/Members/{lang}/{slug}({memberId})
 * Returns undefined if slug or memberId not available
 */
export function buildPoliticianUrls(
  slug?: string,
  memberId?: number
): { urlEn?: string; urlFr?: string } {
  if (!slug || !memberId) {
    return {};
  }

  return {
    urlEn: `https://www.ourcommons.ca/Members/en/${slug}(${memberId})`,
    urlFr: `https://www.ourcommons.ca/Members/fr/${slug}(${memberId})`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a politician citation from explicit inputs.
 * Use overrides for richer context (e.g., enumeration with additional info).
 */
export function buildPoliticianCitation(
  input: PoliticianCitationInput,
  overrides?: CitationOverrides
): PoliticianCitation {
  const name = input.politicianName || LABELS.unknownPolitician.en;
  const nameFr = input.politicianName || LABELS.unknownPolitician.fr;
  const partyEn = input.partyShortEn || input.partyShortFr || "";
  const partyFr = input.partyShortFr || input.partyShortEn || "";
  const ridingEn = input.ridingNameEn || input.ridingNameFr || "";
  const ridingFr = input.ridingNameFr || input.ridingNameEn || "";

  const partsEn = [name];
  const partsFr = [nameFr];
  if (partyEn) {
    partsEn.push(partyEn);
  }
  if (partyFr) {
    partsFr.push(partyFr);
  }
  if (ridingEn) {
    partsEn.push(ridingEn);
  }
  if (ridingFr) {
    partsFr.push(ridingFr);
  }

  const defaultTextEn = `[${partsEn.join(", ")}]`;
  const defaultTextFr = `[${partsFr.join(", ")}]`;
  const defaultTitleEn = name;
  const defaultTitleFr = nameFr;

  const { urlEn, urlFr } = buildPoliticianUrls(input.slug, input.memberId);

  return {
    textEn: overrides?.textEn || defaultTextEn,
    textFr: overrides?.textFr || defaultTextFr,
    urlEn,
    urlFr,
    titleEn: overrides?.titleEn || defaultTitleEn,
    titleFr: overrides?.titleFr || defaultTitleFr,
    sourceType: "politician",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RAG Wrapper - extracts from ResourceMetadata and calls builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a politician citation from ResourceMetadata (RAG flow)
 */
export function formatPoliticianCitation(
  metadata: ResourceMetadata
): PoliticianCitation {
  return buildPoliticianCitation({
    politicianName: metadata.politicianName,
    partyShortEn: metadata.partyShortEn,
    partyShortFr: metadata.partyShortFr,
    ridingNameEn: metadata.ridingNameEn,
    ridingNameFr: metadata.ridingNameFr,
    // Note: memberId and slug may not be in ResourceMetadata yet
    // This can be added when the schema supports it
  });
}
