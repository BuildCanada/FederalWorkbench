import type { ResourceMetadata } from "@/lib/db/rag/schema";
import type {
  BaseCitation,
  CitationOverrides,
} from "@/lib/rag/parliament/sources/types";

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

const LABELS = {
  unknownParty: { en: "Unknown Party", fr: "Parti inconnu" },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Input Types - explicit fields needed for citation building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for building party citations
 */
export type PartyCitationInput = {
  partyNameEn?: string;
  partyNameFr?: string;
  partyShortEn?: string;
  partyShortFr?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Citation Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Citation information for a political party
 */
export type PartyCitation = BaseCitation & { sourceType: "party" };

// ─────────────────────────────────────────────────────────────────────────────
// URL Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build party standings page URLs for EN and FR
 */
export function buildPartyUrls(): { urlEn: string; urlFr: string } {
  return {
    urlEn: "https://www.ourcommons.ca/Members/en/party-standings",
    urlFr: "https://www.ourcommons.ca/Members/fr/party-standings",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a party citation from explicit inputs.
 * Use overrides for richer context (e.g., enumeration with additional info).
 */
export function buildPartyCitation(
  input: PartyCitationInput,
  overrides?: CitationOverrides
): PartyCitation {
  const nameEn =
    input.partyNameEn || input.partyNameFr || LABELS.unknownParty.en;
  const nameFr =
    input.partyNameFr || input.partyNameEn || LABELS.unknownParty.fr;
  const shortEn = input.partyShortEn || input.partyShortFr || "";
  const shortFr = input.partyShortFr || input.partyShortEn || "";

  const defaultTextEn = `[${nameEn}${shortEn ? ` (${shortEn})` : ""}]`;
  const defaultTextFr = `[${nameFr}${shortFr ? ` (${shortFr})` : ""}]`;

  const { urlEn, urlFr } = buildPartyUrls();

  return {
    textEn: overrides?.textEn || defaultTextEn,
    textFr: overrides?.textFr || defaultTextFr,
    urlEn,
    urlFr,
    titleEn: overrides?.titleEn || nameEn,
    titleFr: overrides?.titleFr || nameFr,
    sourceType: "party",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RAG Wrapper - extracts from ResourceMetadata and calls builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a party citation from ResourceMetadata (RAG flow)
 */
export function formatPartyCitation(metadata: ResourceMetadata): PartyCitation {
  return buildPartyCitation({
    partyNameEn: metadata.partyNameEn,
    partyNameFr: metadata.partyNameFr,
    partyShortEn: metadata.partyShortEn,
    partyShortFr: metadata.partyShortFr,
  });
}
