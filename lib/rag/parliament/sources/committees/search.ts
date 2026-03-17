import type { ResourceMetadata } from "@/lib/db/rag/schema";
import {
  executeVectorSearch,
  type SearchOptions,
  type SearchResult,
} from "@/lib/rag/parliament/search-utils";
import {
  type CommitteeCitation,
  type CommitteeMeetingCitation,
  type CommitteeReportCitation,
  formatCommitteeCitation,
  formatCommitteeMeetingCitation,
  formatCommitteeReportCitation,
} from "./citations";

/**
 * Committee metadata fields
 */
export type CommitteeMetadata = ResourceMetadata & {
  sourceType: "committee";
  committeeId: number;
  committeeSlug?: string;
  committeeNameEn?: string;
  committeeNameFr?: string;
};

/**
 * Committee report metadata fields
 */
export type CommitteeReportMetadata = ResourceMetadata & {
  sourceType: "committee_report";
  committeeId?: number;
  committeeSlug?: string;
  committeeNameEn?: string;
  committeeNameFr?: string;
  title?: string;
};

/**
 * Committee meeting metadata fields
 */
export type CommitteeMeetingMetadata = ResourceMetadata & {
  sourceType: "committee_meeting";
  committeeId?: number;
  committeeSlug?: string;
  committeeNameEn?: string;
  committeeNameFr?: string;
  date?: string;
};

/**
 * Committee search result with citation
 */
export type CommitteeSearchResult = SearchResult<CommitteeMetadata> & {
  citation: CommitteeCitation;
};

/**
 * Committee report search result with citation
 */
export type CommitteeReportSearchResult =
  SearchResult<CommitteeReportMetadata> & {
    citation: CommitteeReportCitation;
  };

/**
 * Committee meeting search result with citation
 */
export type CommitteeMeetingSearchResult =
  SearchResult<CommitteeMeetingMetadata> & {
    citation: CommitteeMeetingCitation;
  };

/**
 * Search committees using vector similarity
 */
export async function searchCommittees(
  query: string,
  options: SearchOptions = {}
): Promise<CommitteeSearchResult[]> {
  const results = await executeVectorSearch<CommitteeMetadata>(
    query,
    "committee",
    options
  );

  return results.map((result) => ({
    ...result,
    citation: formatCommitteeCitation(result.metadata),
  }));
}

/**
 * Search committee reports using vector similarity
 */
export async function searchCommitteeReports(
  query: string,
  options: SearchOptions = {}
): Promise<CommitteeReportSearchResult[]> {
  const results = await executeVectorSearch<CommitteeReportMetadata>(
    query,
    "committee_report",
    options
  );

  return results.map((result) => ({
    ...result,
    citation: formatCommitteeReportCitation(result.metadata),
  }));
}

/**
 * Search committee meetings using vector similarity
 */
export async function searchCommitteeMeetings(
  query: string,
  options: SearchOptions = {}
): Promise<CommitteeMeetingSearchResult[]> {
  const results = await executeVectorSearch<CommitteeMeetingMetadata>(
    query,
    "committee_meeting",
    options
  );

  return results.map((result) => ({
    ...result,
    citation: formatCommitteeMeetingCitation(result.metadata),
  }));
}
