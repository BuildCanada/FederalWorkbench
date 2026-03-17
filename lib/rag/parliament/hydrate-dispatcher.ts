/**
 * Hydrator dispatcher - routes source types to their hydration functions
 */

import type { ParliamentSearchResult } from "./search";
import { getHydratedBillMarkdown } from "./sources/bills/hydrate";
import {
  getHydratedCommitteeInfo,
  getHydratedCommitteeMeeting,
  getHydratedCommitteeReport,
} from "./sources/committees/hydrate";
import {
  getHydratedCandidacy,
  getHydratedElectionResults,
} from "./sources/elections/hydrate";
import { getHydratedHansardStatement } from "./sources/hansard/hydrate";
import { getHydratedPartyInfo } from "./sources/parties/hydrate";
import { getHydratedPoliticianProfile } from "./sources/politicians/hydrate";
import { getHydratedRidingInfo } from "./sources/ridings/hydrate";
import { getHydratedSessionOverview } from "./sources/sessions/hydrate";
import {
  getHydratedMemberVote,
  getHydratedPartyVote,
  getHydratedVoteQuestion,
} from "./sources/votes/hydrate";
import type { Lang } from "./types";

/**
 * Hydrated source result - discriminated union of all hydrated types
 */
export type HydratedSource = {
  sourceType: string;
  markdown: string;
  languageUsed: Lang;
  id: string; // Unique identifier for the source
  note?: string;
};

/**
 * Hydrate a search result based on its source type.
 *
 * Returns the full markdown content for the top result of each source type.
 * Returns null if hydration fails (e.g., missing required metadata).
 */
export async function hydrateSearchResult(
  result: ParliamentSearchResult,
  language: Lang
): Promise<HydratedSource | null> {
  const meta = result.metadata;
  const sourceType = meta.sourceType;

  try {
    switch (sourceType) {
      case "bill": {
        if (!meta.sessionId) {
          return null;
        }
        const billNumber = (meta as any).billNumber;
        if (!billNumber) {
          return null;
        }
        const [pStr, sStr] = String(meta.sessionId).split("-");
        const parliament = Number.parseInt(pStr, 10);
        const session = Number.parseInt(sStr, 10);
        if (!Number.isFinite(parliament) || !Number.isFinite(session)) {
          return null;
        }

        const hydrated = await getHydratedBillMarkdown({
          billNumber,
          parliament,
          session,
          language,
        });
        return {
          sourceType: "bill",
          markdown: hydrated.markdown,
          languageUsed: hydrated.languageUsed,
          id: `bill-${billNumber}-${meta.sessionId}`,
          note: hydrated.note,
        };
      }

      case "hansard": {
        const statementId = (meta as any).statementId;
        if (!statementId) {
          return null;
        }
        const hydrated = await getHydratedHansardStatement({
          statementId,
          language,
        });
        if (!hydrated) {
          return null;
        }
        return {
          sourceType: "hansard",
          markdown: hydrated.markdown,
          languageUsed: hydrated.languageUsed,
          id: `hansard-${statementId}`,
        };
      }

      case "politician": {
        const politicianId = (meta as any).politicianId;
        if (!politicianId) {
          return null;
        }
        const hydrated = await getHydratedPoliticianProfile({
          politicianId,
          language,
        });
        if (!hydrated) {
          return null;
        }
        return {
          sourceType: "politician",
          markdown: hydrated.markdown,
          languageUsed: hydrated.languageUsed,
          id: `politician-${politicianId}`,
        };
      }

      case "party": {
        const partyId = (meta as any).partyId;
        if (!partyId) {
          return null;
        }
        const hydrated = await getHydratedPartyInfo({ partyId, language });
        if (!hydrated) {
          return null;
        }
        return {
          sourceType: "party",
          markdown: hydrated.markdown,
          languageUsed: hydrated.languageUsed,
          id: `party-${partyId}`,
        };
      }

      case "committee": {
        const committeeId = (meta as any).committeeId;
        if (!committeeId) {
          return null;
        }
        const hydrated = await getHydratedCommitteeInfo({
          committeeId,
          language,
        });
        if (!hydrated) {
          return null;
        }
        return {
          sourceType: "committee",
          markdown: hydrated.markdown,
          languageUsed: hydrated.languageUsed,
          id: `committee-${committeeId}`,
        };
      }

      case "committee_report": {
        const reportId = (meta as any).reportId;
        if (!reportId) {
          return null;
        }
        const hydrated = await getHydratedCommitteeReport({
          reportId,
          language,
        });
        if (!hydrated) {
          return null;
        }
        return {
          sourceType: "committee_report",
          markdown: hydrated.markdown,
          languageUsed: hydrated.languageUsed,
          id: `committee_report-${reportId}`,
        };
      }

      case "committee_meeting": {
        const meetingId = (meta as any).meetingId;
        if (!meetingId) {
          return null;
        }
        const hydrated = await getHydratedCommitteeMeeting({
          meetingId,
          language,
        });
        if (!hydrated) {
          return null;
        }
        return {
          sourceType: "committee_meeting",
          markdown: hydrated.markdown,
          languageUsed: hydrated.languageUsed,
          id: `committee_meeting-${meetingId}`,
        };
      }

      case "vote_question": {
        const voteQuestionId = (meta as any).voteQuestionId;
        if (!voteQuestionId) {
          return null;
        }
        const hydrated = await getHydratedVoteQuestion({
          voteQuestionId,
          language,
        });
        if (!hydrated) {
          return null;
        }
        return {
          sourceType: "vote_question",
          markdown: hydrated.markdown,
          languageUsed: hydrated.languageUsed,
          id: `vote_question-${voteQuestionId}`,
        };
      }

      case "vote_party": {
        const partyVoteId = (meta as any).partyVoteId;
        if (!partyVoteId) {
          return null;
        }
        const hydrated = await getHydratedPartyVote({ partyVoteId, language });
        if (!hydrated) {
          return null;
        }
        return {
          sourceType: "vote_party",
          markdown: hydrated.markdown,
          languageUsed: hydrated.languageUsed,
          id: `vote_party-${partyVoteId}`,
        };
      }

      case "vote_member": {
        const memberVoteId = (meta as any).memberVoteId;
        if (!memberVoteId) {
          return null;
        }
        const hydrated = await getHydratedMemberVote({
          memberVoteId,
          language,
        });
        if (!hydrated) {
          return null;
        }
        return {
          sourceType: "vote_member",
          markdown: hydrated.markdown,
          languageUsed: hydrated.languageUsed,
          id: `vote_member-${memberVoteId}`,
        };
      }

      case "election": {
        const electionId = (meta as any).electionId;
        if (!electionId) {
          return null;
        }
        const hydrated = await getHydratedElectionResults({
          electionId,
          language,
        });
        if (!hydrated) {
          return null;
        }
        return {
          sourceType: "election",
          markdown: hydrated.markdown,
          languageUsed: hydrated.languageUsed,
          id: `election-${electionId}`,
        };
      }

      case "candidacy": {
        const candidacyId = (meta as any).candidacyId;
        if (!candidacyId) {
          return null;
        }
        const hydrated = await getHydratedCandidacy({ candidacyId, language });
        if (!hydrated) {
          return null;
        }
        return {
          sourceType: "candidacy",
          markdown: hydrated.markdown,
          languageUsed: hydrated.languageUsed,
          id: `candidacy-${candidacyId}`,
        };
      }

      case "session": {
        const sessionId = (meta as any).sessionId || meta.sessionId;
        if (!sessionId) {
          return null;
        }
        const hydrated = await getHydratedSessionOverview({
          sessionId,
          language,
        });
        if (!hydrated) {
          return null;
        }
        return {
          sourceType: "session",
          markdown: hydrated.markdown,
          languageUsed: hydrated.languageUsed,
          id: `session-${sessionId}`,
        };
      }

      case "riding": {
        const ridingId = (meta as any).ridingId;
        if (!ridingId) {
          return null;
        }
        const hydrated = await getHydratedRidingInfo({ ridingId, language });
        if (!hydrated) {
          return null;
        }
        return {
          sourceType: "riding",
          markdown: hydrated.markdown,
          languageUsed: hydrated.languageUsed,
          id: `riding-${ridingId}`,
        };
      }

      default:
        return null;
    }
  } catch {
    // Hydration failed - return null and let caller handle gracefully
    return null;
  }
}

/**
 * Check if a bill result has complete metadata for hydration
 */
function hasBillMetadata(result: ParliamentSearchResult): boolean {
  const meta = result.metadata as any;
  return Boolean(meta.billNumber && meta.sessionId);
}

/**
 * Hydrate top result per source type from search results.
 *
 * Groups results by source type and hydrates the top result from each group.
 * This provides rich context without excessive DB calls.
 *
 * For bills specifically, finds the first result with complete metadata
 * (billNumber + sessionId) rather than just the first bill result.
 *
 * @param results - Search results to hydrate
 * @param language - Preferred language for hydration
 * @returns Array of hydrated sources (one per source type that succeeded)
 */
export async function hydrateTopPerType(
  results: ParliamentSearchResult[],
  language: Lang
): Promise<HydratedSource[]> {
  // Group by source type and take top result from each
  const byType = new Map<string, ParliamentSearchResult>();
  for (const r of results) {
    const t = r.metadata.sourceType;
    if (!byType.has(t)) {
      // For bills, only use results with complete metadata
      if (t === "bill" && !hasBillMetadata(r)) {
        continue;
      }
      byType.set(t, r);
    }
  }

  // If no bill with complete metadata was found, try to find one anywhere in results
  if (!byType.has("bill")) {
    const billWithMeta = results.find(
      (r) => r.metadata.sourceType === "bill" && hasBillMetadata(r)
    );
    if (billWithMeta) {
      byType.set("bill", billWithMeta);
    }
  }

  // Hydrate in parallel
  const hydrationPromises = Array.from(byType.values()).map((result) =>
    hydrateSearchResult(result, language)
  );

  const hydrated = await Promise.all(hydrationPromises);
  return hydrated.filter((h): h is HydratedSource => h !== null);
}
