import type { ResourceMetadata } from "@/lib/db/rag/schema";
import type {
  BaseCitation,
  CitationOverrides,
} from "@/lib/rag/parliament/sources/types";

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

const LABELS = {
  unknownRiding: { en: "Unknown Riding", fr: "Circonscription inconnue" },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Input Types - explicit fields needed for citation building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for building riding citations
 */
export type RidingCitationInput = {
  ridingNameEn?: string;
  ridingNameFr?: string;
  province?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Citation Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Citation information for a riding (electoral district)
 */
export type RidingCitation = BaseCitation & { sourceType: "riding" };

// ─────────────────────────────────────────────────────────────────────────────
// URL Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build Elections Canada riding page URLs for EN and FR
 */
export function buildRidingUrls(): { urlEn: string; urlFr: string } {
  return {
    urlEn: "https://www.elections.ca/content.aspx?section=res&dir=cir&lang=e",
    urlFr: "https://www.elections.ca/content.aspx?section=res&dir=cir&lang=f",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a riding citation from explicit inputs.
 * Use overrides for richer context (e.g., enumeration with additional info).
 */
export function buildRidingCitation(
  input: RidingCitationInput,
  overrides?: CitationOverrides
): RidingCitation {
  const nameEn =
    input.ridingNameEn || input.ridingNameFr || LABELS.unknownRiding.en;
  const nameFr =
    input.ridingNameFr || input.ridingNameEn || LABELS.unknownRiding.fr;
  const province = input.province || "";

  const defaultTextEn = `[${nameEn}${province ? `, ${province}` : ""}]`;
  const defaultTextFr = `[${nameFr}${province ? `, ${province}` : ""}]`;

  const { urlEn, urlFr } = buildRidingUrls();

  return {
    textEn: overrides?.textEn || defaultTextEn,
    textFr: overrides?.textFr || defaultTextFr,
    urlEn,
    urlFr,
    titleEn: overrides?.titleEn || nameEn,
    titleFr: overrides?.titleFr || nameFr,
    sourceType: "riding",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RAG Wrapper - extracts from ResourceMetadata and calls builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a riding citation from ResourceMetadata (RAG flow)
 */
export function formatRidingCitation(
  metadata: ResourceMetadata
): RidingCitation {
  return buildRidingCitation({
    ridingNameEn: metadata.ridingNameEn,
    ridingNameFr: metadata.ridingNameFr,
    province: metadata.province,
  });
}
