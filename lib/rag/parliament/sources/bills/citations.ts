import type { ResourceMetadata } from "@/lib/db/rag/schema";
import { formatOrdinal } from "@/lib/rag/parliament/search-utils";
import type {
  BaseCitation,
  CitationOverrides,
} from "@/lib/rag/parliament/sources/types";

// ─────────────────────────────────────────────────────────────────────────────
// Input Types - explicit fields needed for citation building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for building bill citations
 */
export type BillCitationInput = {
  billNumber: string;
  sessionId: string;
  billTitle?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Citation Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Citation information for a bill
 */
export type BillCitation = BaseCitation & { sourceType: "bill" };

// ─────────────────────────────────────────────────────────────────────────────
// URL Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build bill page URLs for EN and FR
 * Format: https://www.parl.ca/legisinfo/{lang}/bill/{sessionId}/{billNumber}
 */
export function buildBillUrls(
  sessionId: string,
  billNumber: string
): { urlEn: string; urlFr: string } {
  // Bill numbers are lowercase in parl.ca URLs (e.g., "C-11" becomes "c-11")
  const billNumberLower = billNumber.toLowerCase();

  return {
    urlEn: `https://www.parl.ca/legisinfo/en/bill/${sessionId}/${billNumberLower}`,
    urlFr: `https://www.parl.ca/legisinfo/fr/projet-de-loi/${sessionId}/${billNumberLower}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a bill citation from explicit inputs.
 * Use overrides for richer context (e.g., enumeration with additional info).
 */
export function buildBillCitation(
  input: BillCitationInput,
  overrides?: CitationOverrides
): BillCitation {
  const [parliament, session] = input.sessionId.split("-");
  const parliamentOrdinal = formatOrdinal(parliament);
  const sessionOrdinal = formatOrdinal(session);

  const defaultTitleEn = input.billTitle || `Bill ${input.billNumber}`;
  const defaultTitleFr = input.billTitle || `Projet de loi ${input.billNumber}`;
  const defaultTextEn = `[Bill ${input.billNumber}, ${parliamentOrdinal} Parliament, ${sessionOrdinal} Session]`;
  const defaultTextFr = `[Projet de loi ${input.billNumber}, ${parliamentOrdinal} Parlement, ${sessionOrdinal} Session]`;

  const { urlEn, urlFr } = buildBillUrls(input.sessionId, input.billNumber);

  return {
    textEn: overrides?.textEn || defaultTextEn,
    textFr: overrides?.textFr || defaultTextFr,
    urlEn,
    urlFr,
    titleEn: overrides?.titleEn || defaultTitleEn,
    titleFr: overrides?.titleFr || defaultTitleFr,
    sourceType: "bill",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RAG Wrapper - extracts from ResourceMetadata and calls builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a bill citation from ResourceMetadata (RAG flow)
 *
 * Generates proper citation text and URLs to the Parliament of Canada LEGISinfo system
 */
export function formatBillCitation(metadata: ResourceMetadata): BillCitation {
  if (!metadata.billNumber || !metadata.sessionId) {
    throw new Error("Bill metadata must include billNumber and sessionId");
  }

  return buildBillCitation({
    billNumber: metadata.billNumber,
    sessionId: metadata.sessionId,
    billTitle: metadata.billTitle,
  });
}
