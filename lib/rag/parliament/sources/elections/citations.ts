import type { ResourceMetadata } from "@/lib/db/rag/schema";
import type {
  BaseCitation,
  CitationOverrides,
} from "@/lib/rag/parliament/sources/types";

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

const LABELS = {
  election: { en: "Election", fr: "Élection" },
  unknownDate: { en: "unknown date", fr: "date inconnue" },
  unknownCandidate: { en: "Unknown Candidate", fr: "Candidat inconnu" },
  unknownRiding: { en: "Unknown Riding", fr: "Circonscription inconnue" },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Input Types - explicit fields needed for citation building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for building election citations
 */
export type ElectionCitationInput = {
  date?: string;
  nameEn?: string;
  nameFr?: string;
};

/**
 * Input for building candidacy citations
 */
export type CandidacyCitationInput = {
  politicianName?: string;
  ridingNameEn?: string;
  ridingNameFr?: string;
  date?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Citation Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Citation information for an election
 */
export type ElectionCitation = BaseCitation & { sourceType: "election" };

/**
 * Citation information for a candidacy
 */
export type CandidacyCitation = BaseCitation & { sourceType: "candidacy" };

// ─────────────────────────────────────────────────────────────────────────────
// URL Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build Elections Canada page URLs for EN and FR
 */
export function buildElectionUrls(): { urlEn: string; urlFr: string } {
  return {
    urlEn: "https://www.elections.ca/content.aspx?section=ele&lang=e",
    urlFr: "https://www.elections.ca/content.aspx?section=ele&lang=f",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an election citation from explicit inputs.
 * Use overrides for richer context (e.g., enumeration with additional info).
 */
export function buildElectionCitation(
  input: ElectionCitationInput,
  overrides?: CitationOverrides
): ElectionCitation {
  const date = input.date || LABELS.unknownDate.en;
  const dateFr = input.date || LABELS.unknownDate.fr;
  const nameEn =
    input.nameEn || input.nameFr || `${LABELS.election.en} ${date}`;
  const nameFr =
    input.nameFr || input.nameEn || `${LABELS.election.fr} ${dateFr}`;

  const defaultTextEn = `[${LABELS.election.en}: ${date}]`;
  const defaultTextFr = `[${LABELS.election.fr}: ${dateFr}]`;

  const { urlEn, urlFr } = buildElectionUrls();

  return {
    textEn: overrides?.textEn || defaultTextEn,
    textFr: overrides?.textFr || defaultTextFr,
    urlEn,
    urlFr,
    titleEn: overrides?.titleEn || nameEn,
    titleFr: overrides?.titleFr || nameFr,
    sourceType: "election",
  };
}

/**
 * Build a candidacy citation from explicit inputs.
 * Use overrides for richer context (e.g., enumeration with additional info).
 */
export function buildCandidacyCitation(
  input: CandidacyCitationInput,
  overrides?: CitationOverrides
): CandidacyCitation {
  const politician = input.politicianName || LABELS.unknownCandidate.en;
  const politicianFr = input.politicianName || LABELS.unknownCandidate.fr;
  const ridingEn =
    input.ridingNameEn || input.ridingNameFr || LABELS.unknownRiding.en;
  const ridingFr =
    input.ridingNameFr || input.ridingNameEn || LABELS.unknownRiding.fr;
  const date = input.date || "";

  const defaultTextEn = `[${politician}, ${ridingEn}${date ? ` (${date})` : ""}]`;
  const defaultTextFr = `[${politicianFr}, ${ridingFr}${date ? ` (${date})` : ""}]`;
  const defaultTitleEn = `${politician} - ${ridingEn}`;
  const defaultTitleFr = `${politicianFr} - ${ridingFr}`;

  const { urlEn, urlFr } = buildElectionUrls();

  return {
    textEn: overrides?.textEn || defaultTextEn,
    textFr: overrides?.textFr || defaultTextFr,
    urlEn,
    urlFr,
    titleEn: overrides?.titleEn || defaultTitleEn,
    titleFr: overrides?.titleFr || defaultTitleFr,
    sourceType: "candidacy",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RAG Wrappers - extract from ResourceMetadata and call builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format an election citation from ResourceMetadata (RAG flow)
 */
export function formatElectionCitation(
  metadata: ResourceMetadata
): ElectionCitation {
  return buildElectionCitation({
    date: metadata.date,
    nameEn: metadata.nameEn,
    nameFr: metadata.nameFr,
  });
}

/**
 * Format a candidacy citation from ResourceMetadata (RAG flow)
 */
export function formatCandidacyCitation(
  metadata: ResourceMetadata
): CandidacyCitation {
  return buildCandidacyCitation({
    politicianName: metadata.politicianName,
    ridingNameEn: metadata.ridingNameEn,
    ridingNameFr: metadata.ridingNameFr,
    date: metadata.date,
  });
}
