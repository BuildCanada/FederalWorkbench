import type { ResourceMetadata } from "@/lib/db/rag/schema";
import type {
  BaseCitation,
  CitationOverrides,
} from "@/lib/rag/parliament/sources/types";

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

const LABELS = {
  unknownCommittee: { en: "Unknown Committee", fr: "Comité inconnu" },
  committee: { en: "Committee", fr: "Comité" },
  report: { en: "Report", fr: "Rapport" },
  meeting: { en: "Meeting", fr: "Réunion" },
  unknownDate: { en: "unknown date", fr: "date inconnue" },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Input Types - explicit fields needed for citation building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for building committee citations
 */
export type CommitteeCitationInput = {
  committeeNameEn?: string;
  committeeNameFr?: string;
  committeeSlug?: string;
};

/**
 * Input for building committee report citations
 */
export type CommitteeReportCitationInput = {
  title?: string;
  nameEn?: string;
  nameFr?: string;
  committeeNameEn?: string;
  committeeNameFr?: string;
  committeeSlug?: string;
};

/**
 * Input for building committee meeting citations
 */
export type CommitteeMeetingCitationInput = {
  date?: string;
  committeeNameEn?: string;
  committeeNameFr?: string;
  committeeSlug?: string;
  meetingNumber?: number;
  sessionId?: string; // e.g., "44-1"
};

// ─────────────────────────────────────────────────────────────────────────────
// Citation Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Citation information for a committee
 */
export type CommitteeCitation = BaseCitation & { sourceType: "committee" };

/**
 * Citation information for a committee report
 */
export type CommitteeReportCitation = BaseCitation & {
  sourceType: "committee_report";
};

/**
 * Citation information for a committee meeting
 */
export type CommitteeMeetingCitation = BaseCitation & {
  sourceType: "committee_meeting";
};

// ─────────────────────────────────────────────────────────────────────────────
// URL Builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build committee page URLs for EN and FR
 */
export function buildCommitteeUrls(slug?: string): {
  urlEn: string;
  urlFr: string;
} {
  if (!slug) {
    return {
      urlEn: "https://www.ourcommons.ca/Committees/en/",
      urlFr: "https://www.ourcommons.ca/Committees/fr/",
    };
  }
  return {
    urlEn: `https://www.ourcommons.ca/Committees/en/${slug}`,
    urlFr: `https://www.ourcommons.ca/Committees/fr/${slug}`,
  };
}

/**
 * Build committee work/reports page URLs for EN and FR
 */
export function buildCommitteeReportUrls(slug?: string): {
  urlEn: string;
  urlFr: string;
} {
  if (!slug) {
    return {
      urlEn: "https://www.ourcommons.ca/Committees/en/",
      urlFr: "https://www.ourcommons.ca/Committees/fr/",
    };
  }
  return {
    urlEn: `https://www.ourcommons.ca/Committees/en/${slug}/Work`,
    urlFr: `https://www.ourcommons.ca/Committees/fr/${slug}/Work`,
  };
}

/**
 * Build committee meeting URLs for EN and FR
 *
 * If we have slug, sessionId, and meetingNumber, we can link directly to the evidence page:
 * EN: https://www.ourcommons.ca/DocumentViewer/en/44-1/FINA/meeting-15/evidence
 * FR: https://www.ourcommons.ca/DocumentViewer/fr/44-1/FINA/reunion-15/temoignages
 *
 * Note: French URLs use "reunion" instead of "meeting" and "temoignages" instead of "evidence"
 *
 * Otherwise, fall back to the committee meetings list.
 */
export function buildCommitteeMeetingUrls(
  slug?: string,
  sessionId?: string,
  meetingNumber?: number
): {
  urlEn: string;
  urlFr: string;
} {
  // Direct link to specific meeting if we have all the info
  if (slug && sessionId && meetingNumber) {
    return {
      urlEn: `https://www.ourcommons.ca/DocumentViewer/en/${sessionId}/${slug}/meeting-${meetingNumber}/evidence`,
      urlFr: `https://www.ourcommons.ca/DocumentViewer/fr/${sessionId}/${slug}/reunion-${meetingNumber}/temoignages`,
    };
  }

  // Fallback to committee meetings list
  if (slug) {
    return {
      urlEn: `https://www.ourcommons.ca/Committees/en/${slug}/Meetings`,
      urlFr: `https://www.ourcommons.ca/Committees/fr/${slug}/Meetings`,
    };
  }

  // Generic fallback
  return {
    urlEn: "https://www.ourcommons.ca/Committees/en/",
    urlFr: "https://www.ourcommons.ca/Committees/fr/",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a committee citation from explicit inputs.
 */
export function buildCommitteeCitation(
  input: CommitteeCitationInput,
  overrides?: CitationOverrides
): CommitteeCitation {
  const nameEn =
    input.committeeNameEn ||
    input.committeeNameFr ||
    LABELS.unknownCommittee.en;
  const nameFr =
    input.committeeNameFr ||
    input.committeeNameEn ||
    LABELS.unknownCommittee.fr;

  const defaultTextEn = `[${LABELS.committee.en}: ${nameEn}]`;
  const defaultTextFr = `[${LABELS.committee.fr}: ${nameFr}]`;

  const { urlEn, urlFr } = buildCommitteeUrls(input.committeeSlug);

  return {
    textEn: overrides?.textEn || defaultTextEn,
    textFr: overrides?.textFr || defaultTextFr,
    urlEn,
    urlFr,
    titleEn: overrides?.titleEn || nameEn,
    titleFr: overrides?.titleFr || nameFr,
    sourceType: "committee",
  };
}

/**
 * Build a committee report citation from explicit inputs.
 */
export function buildCommitteeReportCitation(
  input: CommitteeReportCitationInput,
  overrides?: CitationOverrides
): CommitteeReportCitation {
  const titleEn =
    input.title || input.nameEn || input.nameFr || LABELS.report.en;
  const titleFr =
    input.title || input.nameFr || input.nameEn || LABELS.report.fr;
  const committeeEn = input.committeeNameEn || input.committeeNameFr || "";
  const committeeFr = input.committeeNameFr || input.committeeNameEn || "";

  const defaultTextEn = `[${LABELS.report.en}: ${titleEn}${committeeEn ? ` (${committeeEn})` : ""}]`;
  const defaultTextFr = `[${LABELS.report.fr}: ${titleFr}${committeeFr ? ` (${committeeFr})` : ""}]`;

  const { urlEn, urlFr } = buildCommitteeReportUrls(input.committeeSlug);

  return {
    textEn: overrides?.textEn || defaultTextEn,
    textFr: overrides?.textFr || defaultTextFr,
    urlEn,
    urlFr,
    titleEn: overrides?.titleEn || titleEn,
    titleFr: overrides?.titleFr || titleFr,
    sourceType: "committee_report",
  };
}

/**
 * Build a committee meeting citation from explicit inputs.
 */
export function buildCommitteeMeetingCitation(
  input: CommitteeMeetingCitationInput,
  overrides?: CitationOverrides
): CommitteeMeetingCitation {
  const date = input.date || LABELS.unknownDate.en;
  const dateFr = input.date || LABELS.unknownDate.fr;
  const committeeEn =
    input.committeeNameEn || input.committeeNameFr || LABELS.committee.en;
  const committeeFr =
    input.committeeNameFr || input.committeeNameEn || LABELS.committee.fr;

  const defaultTextEn = `[${LABELS.meeting.en}: ${committeeEn}, ${date}]`;
  const defaultTextFr = `[${LABELS.meeting.fr}: ${committeeFr}, ${dateFr}]`;
  const defaultTitleEn = `${committeeEn} - ${date}`;
  const defaultTitleFr = `${committeeFr} - ${dateFr}`;

  const { urlEn, urlFr } = buildCommitteeMeetingUrls(
    input.committeeSlug,
    input.sessionId,
    input.meetingNumber
  );

  return {
    textEn: overrides?.textEn || defaultTextEn,
    textFr: overrides?.textFr || defaultTextFr,
    urlEn,
    urlFr,
    titleEn: overrides?.titleEn || defaultTitleEn,
    titleFr: overrides?.titleFr || defaultTitleFr,
    sourceType: "committee_meeting",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RAG Wrappers - extract from ResourceMetadata and call builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a committee citation from ResourceMetadata (RAG flow)
 */
export function formatCommitteeCitation(
  metadata: ResourceMetadata
): CommitteeCitation {
  return buildCommitteeCitation({
    committeeNameEn: metadata.committeeNameEn,
    committeeNameFr: metadata.committeeNameFr,
    committeeSlug: metadata.committeeSlug,
  });
}

/**
 * Format a committee report citation from ResourceMetadata (RAG flow)
 */
export function formatCommitteeReportCitation(
  metadata: ResourceMetadata
): CommitteeReportCitation {
  return buildCommitteeReportCitation({
    title: metadata.title,
    nameEn: metadata.nameEn,
    nameFr: metadata.nameFr,
    committeeNameEn: metadata.committeeNameEn,
    committeeNameFr: metadata.committeeNameFr,
    committeeSlug: metadata.committeeSlug,
  });
}

/**
 * Format a committee meeting citation from ResourceMetadata (RAG flow)
 */
export function formatCommitteeMeetingCitation(
  metadata: ResourceMetadata
): CommitteeMeetingCitation {
  return buildCommitteeMeetingCitation({
    date: metadata.date,
    committeeNameEn: metadata.committeeNameEn,
    committeeNameFr: metadata.committeeNameFr,
    committeeSlug: metadata.committeeSlug,
    meetingNumber: metadata.meetingNumber,
    sessionId: metadata.sessionId,
  });
}
