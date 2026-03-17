import type { ResourceMetadata } from "@/lib/db/rag/schema";
import type {
  BaseCitation,
  CitationOverrides,
} from "@/lib/rag/parliament/sources/types";

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

const LABELS = {
  hansard: { en: "Hansard", fr: "Hansard" },
  unknownDate: { en: "unknown date", fr: "date inconnue" },
  unknownSpeaker: { en: "Unknown Speaker", fr: "Orateur inconnu" },
  houseDebate: { en: "House Debate", fr: "Débat de la Chambre" },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Input Types - explicit fields needed for citation building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for building Hansard citations
 */
export type HansardCitationInput = {
  date?: string;
  speakerNameEn?: string;
  speakerNameFr?: string;
  docNumber?: string;
  sessionId?: string;
  nameEn?: string;
  nameFr?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Citation Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Citation information for a Hansard statement
 */
export type HansardCitation = BaseCitation & { sourceType: "hansard" };

// ─────────────────────────────────────────────────────────────────────────────
// URL Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build Hansard page URLs for EN and FR
 * Format: https://www.ourcommons.ca/DocumentViewer/{lang}/{sessionId}/{chamber}/sitting-{docNumber}/hansard
 */
export function buildHansardUrls(
  sessionId: string,
  docNumber?: string
): { urlEn: string; urlFr: string } {
  if (!docNumber) {
    return {
      urlEn: `https://www.ourcommons.ca/DocumentViewer/en/${sessionId}/house/hansard`,
      urlFr: `https://www.ourcommons.ca/DocumentViewer/fr/${sessionId}/chambre/debats`,
    };
  }
  return {
    urlEn: `https://www.ourcommons.ca/DocumentViewer/en/${sessionId}/house/sitting-${docNumber}/hansard`,
    urlFr: `https://www.ourcommons.ca/DocumentViewer/fr/${sessionId}/chambre/seance-${docNumber}/debats`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a Hansard citation from explicit inputs.
 * Use overrides for richer context (e.g., enumeration with additional info).
 */
export function buildHansardCitation(
  input: HansardCitationInput,
  overrides?: CitationOverrides
): HansardCitation {
  const date = input.date || LABELS.unknownDate.en;
  const dateFr = input.date || LABELS.unknownDate.fr;
  const speakerEn =
    input.speakerNameEn || input.speakerNameFr || LABELS.unknownSpeaker.en;
  const speakerFr =
    input.speakerNameFr || input.speakerNameEn || LABELS.unknownSpeaker.fr;
  const sessionId = input.sessionId || "44-1";

  const titleEn = input.nameEn || input.nameFr || LABELS.houseDebate.en;
  const titleFr = input.nameFr || input.nameEn || LABELS.houseDebate.fr;

  const defaultTextEn = `[${LABELS.hansard.en}, ${date}, ${speakerEn}]`;
  const defaultTextFr = `[${LABELS.hansard.fr}, ${dateFr}, ${speakerFr}]`;

  const { urlEn, urlFr } = buildHansardUrls(sessionId, input.docNumber);

  return {
    textEn: overrides?.textEn || defaultTextEn,
    textFr: overrides?.textFr || defaultTextFr,
    urlEn,
    urlFr,
    titleEn: overrides?.titleEn || titleEn,
    titleFr: overrides?.titleFr || titleFr,
    sourceType: "hansard",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RAG Wrapper - extracts from ResourceMetadata and calls builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a Hansard citation from ResourceMetadata (RAG flow)
 */
export function formatHansardCitation(
  metadata: ResourceMetadata
): HansardCitation {
  return buildHansardCitation({
    date: metadata.date,
    speakerNameEn: metadata.speakerNameEn,
    speakerNameFr: metadata.speakerNameFr,
    docNumber: metadata.docNumber,
    sessionId: metadata.sessionId,
    nameEn: metadata.nameEn,
    nameFr: metadata.nameFr,
  });
}
