import type { ResourceMetadata } from "@/lib/db/rag/schema";
import type {
  BaseCitation,
  CitationOverrides,
} from "@/lib/rag/parliament/sources/types";

/**
 * Bilingual labels for vote citations
 */
const LABELS = {
  vote: { en: "Vote", fr: "Vote" },
  passed: { en: "Passed", fr: "Adopté" },
  failed: { en: "Failed", fr: "Rejeté" },
  yea: { en: "Yea", fr: "Oui" },
  nay: { en: "Nay", fr: "Non" },
  unknownDate: { en: "unknown date", fr: "date inconnue" },
  unknownParty: { en: "Unknown Party", fr: "Parti inconnu" },
  unknownMember: { en: "Unknown Member", fr: "Député inconnu" },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Input Types - explicit fields needed for citation building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for building vote question citations
 */
export type VoteQuestionCitationInput = {
  sessionId: string;
  voteNumber: number;
  date?: string;
  result?: string;
  title?: string;
};

/**
 * Input for building party vote citations
 */
export type PartyVoteCitationInput = {
  sessionId: string;
  voteNumber: number;
  date?: string;
  result?: string;
  partyNameEn?: string;
  partyNameFr?: string;
};

/**
 * Input for building member vote citations
 */
export type MemberVoteCitationInput = {
  sessionId: string;
  voteNumber: number;
  date?: string;
  result?: string;
  politicianName?: string;
};

// Re-export CitationOverrides for backward compatibility
export type { CitationOverrides } from "@/lib/rag/parliament/sources/types";

// ─────────────────────────────────────────────────────────────────────────────
// Citation Types
// ─────────────────────────────────────────────────────────────────────────────

export type VoteQuestionCitation = BaseCitation & {
  sourceType: "vote_question";
};

export type PartyVoteCitation = BaseCitation & { sourceType: "vote_party" };

export type MemberVoteCitation = BaseCitation & { sourceType: "vote_member" };

export type VoteCitation =
  | VoteQuestionCitation
  | PartyVoteCitation
  | MemberVoteCitation;

// ─────────────────────────────────────────────────────────────────────────────
// URL Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build vote page URLs for EN and FR
 * Format: https://www.ourcommons.ca/Members/{lang}/votes/{parliament}/{session}/{voteNumber}
 */
export function buildVoteUrls(
  sessionId: string,
  voteNumber: number
): { urlEn: string; urlFr: string } {
  const sessionPath = sessionId.replace("-", "/");
  if (!voteNumber) {
    return {
      urlEn: "https://www.ourcommons.ca/Members/en/votes",
      urlFr: "https://www.ourcommons.ca/Members/fr/votes",
    };
  }
  return {
    urlEn: `https://www.ourcommons.ca/Members/en/votes/${sessionPath}/${voteNumber}`,
    urlFr: `https://www.ourcommons.ca/Members/fr/votes/${sessionPath}/${voteNumber}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Builders - work with explicit inputs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a vote question citation from explicit inputs.
 * Use overrides for richer context (e.g., enumeration with bill info).
 */
export function buildVoteQuestionCitation(
  input: VoteQuestionCitationInput,
  overrides?: CitationOverrides
): VoteQuestionCitation {
  const date = input.date || LABELS.unknownDate.en;
  const dateFr = input.date || LABELS.unknownDate.fr;
  const resultEn =
    input.result === "Y"
      ? LABELS.passed.en
      : input.result === "N"
        ? LABELS.failed.en
        : input.result || "";
  const resultFr =
    input.result === "Y"
      ? LABELS.passed.fr
      : input.result === "N"
        ? LABELS.failed.fr
        : input.result || "";

  const defaultTitleEn = input.title || `Vote #${input.voteNumber}`;
  const defaultTitleFr = input.title || `Vote nº ${input.voteNumber}`;
  const defaultTextEn = `[${LABELS.vote.en}, ${date}, ${resultEn}]`;
  const defaultTextFr = `[${LABELS.vote.fr}, ${dateFr}, ${resultFr}]`;

  const { urlEn, urlFr } = buildVoteUrls(input.sessionId, input.voteNumber);

  return {
    textEn: overrides?.textEn || defaultTextEn,
    textFr: overrides?.textFr || defaultTextFr,
    urlEn,
    urlFr,
    titleEn: overrides?.titleEn || defaultTitleEn,
    titleFr: overrides?.titleFr || defaultTitleFr,
    sourceType: "vote_question",
  };
}

/**
 * Build a party vote citation from explicit inputs.
 */
export function buildPartyVoteCitation(
  input: PartyVoteCitationInput,
  overrides?: CitationOverrides
): PartyVoteCitation {
  const date = input.date || LABELS.unknownDate.en;
  const dateFr = input.date || LABELS.unknownDate.fr;
  const partyEn =
    input.partyNameEn || input.partyNameFr || LABELS.unknownParty.en;
  const partyFr =
    input.partyNameFr || input.partyNameEn || LABELS.unknownParty.fr;
  const voteEn =
    input.result === "Y"
      ? LABELS.yea.en
      : input.result === "N"
        ? LABELS.nay.en
        : input.result || "";
  const voteFr =
    input.result === "Y"
      ? LABELS.yea.fr
      : input.result === "N"
        ? LABELS.nay.fr
        : input.result || "";

  const defaultTitleEn = `${partyEn}: ${voteEn}`;
  const defaultTitleFr = `${partyFr}: ${voteFr}`;
  const defaultTextEn = `[${partyEn} ${LABELS.vote.en}, ${date}, ${voteEn}]`;
  const defaultTextFr = `[${LABELS.vote.fr} ${partyFr}, ${dateFr}, ${voteFr}]`;

  const { urlEn, urlFr } = buildVoteUrls(input.sessionId, input.voteNumber);

  return {
    textEn: overrides?.textEn || defaultTextEn,
    textFr: overrides?.textFr || defaultTextFr,
    urlEn,
    urlFr,
    titleEn: overrides?.titleEn || defaultTitleEn,
    titleFr: overrides?.titleFr || defaultTitleFr,
    sourceType: "vote_party",
  };
}

/**
 * Build a member vote citation from explicit inputs.
 */
export function buildMemberVoteCitation(
  input: MemberVoteCitationInput,
  overrides?: CitationOverrides
): MemberVoteCitation {
  const date = input.date || LABELS.unknownDate.en;
  const dateFr = input.date || LABELS.unknownDate.fr;
  const member = input.politicianName || LABELS.unknownMember.en;
  const memberFr = input.politicianName || LABELS.unknownMember.fr;
  const voteEn =
    input.result === "Y"
      ? LABELS.yea.en
      : input.result === "N"
        ? LABELS.nay.en
        : input.result || "";
  const voteFr =
    input.result === "Y"
      ? LABELS.yea.fr
      : input.result === "N"
        ? LABELS.nay.fr
        : input.result || "";

  const defaultTitleEn = `${member}: ${voteEn}`;
  const defaultTitleFr = `${memberFr}: ${voteFr}`;
  const defaultTextEn = `[${member}, ${date}, ${voteEn}]`;
  const defaultTextFr = `[${memberFr}, ${dateFr}, ${voteFr}]`;

  const { urlEn, urlFr } = buildVoteUrls(input.sessionId, input.voteNumber);

  return {
    textEn: overrides?.textEn || defaultTextEn,
    textFr: overrides?.textFr || defaultTextFr,
    urlEn,
    urlFr,
    titleEn: overrides?.titleEn || defaultTitleEn,
    titleFr: overrides?.titleFr || defaultTitleFr,
    sourceType: "vote_member",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RAG Wrappers - extract from ResourceMetadata and call builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a vote question citation from ResourceMetadata (RAG flow)
 */
export function formatVoteQuestionCitation(
  metadata: ResourceMetadata
): VoteQuestionCitation {
  return buildVoteQuestionCitation({
    sessionId: metadata.sessionId || "",
    voteNumber: metadata.voteNumber ?? metadata.voteQuestionId ?? 0,
    date: metadata.date,
    result: metadata.result,
    title: metadata.title,
  });
}

/**
 * Format a party vote citation from ResourceMetadata (RAG flow)
 */
export function formatPartyVoteCitation(
  metadata: ResourceMetadata
): PartyVoteCitation {
  return buildPartyVoteCitation({
    sessionId: metadata.sessionId || "",
    voteNumber: metadata.voteNumber ?? 0,
    date: metadata.date,
    result: metadata.result,
    partyNameEn: metadata.partyNameEn,
    partyNameFr: metadata.partyNameFr,
  });
}

/**
 * Format a member vote citation from ResourceMetadata (RAG flow)
 */
export function formatMemberVoteCitation(
  metadata: ResourceMetadata
): MemberVoteCitation {
  return buildMemberVoteCitation({
    sessionId: metadata.sessionId || "",
    voteNumber: metadata.voteNumber ?? 0,
    date: metadata.date,
    result: metadata.result,
    politicianName: metadata.politicianName,
  });
}

/**
 * Format a vote citation based on source type (RAG flow)
 */
export function formatVoteCitation(metadata: ResourceMetadata): VoteCitation {
  switch (metadata.sourceType) {
    case "vote_question":
      return formatVoteQuestionCitation(metadata);
    case "vote_party":
      return formatPartyVoteCitation(metadata);
    case "vote_member":
      return formatMemberVoteCitation(metadata);
    default:
      throw new Error(`Unsupported vote type: ${metadata.sourceType}`);
  }
}
