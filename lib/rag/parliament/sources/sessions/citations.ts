import type { ResourceMetadata } from "@/lib/db/rag/schema";
import { formatOrdinal } from "@/lib/rag/parliament/search-utils";
import type {
  BaseCitation,
  CitationOverrides,
} from "@/lib/rag/parliament/sources/types";

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

const LABELS = {
  session: { en: "Session", fr: "Session" },
  parliament: { en: "Parliament", fr: "Parlement" },
  unknown: { en: "Unknown", fr: "Inconnu" },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Input Types - explicit fields needed for citation building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for building session citations
 */
export type SessionCitationInput = {
  sessionId: string;
  sessionName?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Citation Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Citation information for a parliamentary session
 */
export type SessionCitation = BaseCitation & { sourceType: "session" };

// ─────────────────────────────────────────────────────────────────────────────
// URL Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build session overview page URLs for EN and FR
 * Format: https://www.parl.ca/legisinfo/{lang}/overview/{sessionId}
 */
export function buildSessionUrls(sessionId: string): {
  urlEn: string;
  urlFr: string;
} {
  return {
    urlEn: `https://www.parl.ca/legisinfo/en/overview/${sessionId}`,
    urlFr: `https://www.parl.ca/legisinfo/fr/apercu/${sessionId}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a session citation from explicit inputs.
 * Use overrides for richer context (e.g., enumeration with additional info).
 */
export function buildSessionCitation(
  input: SessionCitationInput,
  overrides?: CitationOverrides
): SessionCitation {
  const sessionId = input.sessionId || LABELS.unknown.en;
  const [parliament, session] = sessionId.split("-");
  const parliamentOrdinal = parliament ? formatOrdinal(parliament) : "";
  const sessionOrdinal = session ? formatOrdinal(session) : "";

  const titleEn =
    input.sessionName ||
    (parliamentOrdinal && sessionOrdinal
      ? `${parliamentOrdinal} ${LABELS.parliament.en}, ${sessionOrdinal} ${LABELS.session.en}`
      : sessionId);
  const titleFr =
    input.sessionName ||
    (parliamentOrdinal && sessionOrdinal
      ? `${parliamentOrdinal} ${LABELS.parliament.fr}, ${sessionOrdinal} ${LABELS.session.fr}`
      : sessionId);

  const defaultTextEn = `[${LABELS.session.en} ${sessionId}]`;
  const defaultTextFr = `[${LABELS.session.fr} ${sessionId}]`;

  const { urlEn, urlFr } = buildSessionUrls(sessionId);

  return {
    textEn: overrides?.textEn || defaultTextEn,
    textFr: overrides?.textFr || defaultTextFr,
    urlEn,
    urlFr,
    titleEn: overrides?.titleEn || titleEn,
    titleFr: overrides?.titleFr || titleFr,
    sourceType: "session",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RAG Wrapper - extracts from ResourceMetadata and calls builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a session citation from ResourceMetadata (RAG flow)
 */
export function formatSessionCitation(
  metadata: ResourceMetadata
): SessionCitation {
  return buildSessionCitation({
    sessionId: metadata.sessionId || LABELS.unknown.en,
    sessionName: metadata.sessionName,
  });
}
