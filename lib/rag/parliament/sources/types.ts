/**
 * Base citation type with bilingual fields
 * All source-specific citations extend this type
 * URLs are optional - some sources (e.g., politicians) don't have linkable pages
 */
export type BaseCitation = {
  textEn: string;
  textFr: string;
  urlEn?: string;
  urlFr?: string;
  titleEn: string;
  titleFr: string;
};

/**
 * Optional overrides for citation text/title.
 * Used by enumeration flows to provide richer context than default formatting.
 */
export type CitationOverrides = {
  titleEn?: string;
  titleFr?: string;
  textEn?: string;
  textFr?: string;
};

/**
 * All possible source types for citations
 */
export type CitationSourceType =
  | "bill"
  | "hansard"
  | "committee"
  | "committee_report"
  | "committee_meeting"
  | "vote_question"
  | "vote_party"
  | "vote_member"
  | "politician"
  | "party"
  | "election"
  | "candidacy"
  | "session"
  | "riding";
