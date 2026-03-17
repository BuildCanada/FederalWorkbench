/**
 * Enumeration Functions for Complete Result Sets
 *
 * These functions fetch ALL results for enumeration queries like:
 * - "Who voted yea for bill C-35?"
 * - "List all Liberal MPs"
 * - "Who are the members of the Finance committee?"
 *
 * Unlike the standard search flow (which returns top-N), these functions
 * fetch complete result sets directly from the database.
 */

import { generateObject } from "ai";
import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { myProvider } from "@/lib/ai/providers";
import { getDb } from "@/lib/db/connection";
import {
  billsBill,
  billsMembervote,
  billsVotequestion,
  type CoreParty,
  type CorePolitician,
  coreElectedmember,
  coreElectedmemberSessions,
  coreParty,
  corePolitician,
  coreRiding,
  coreSession,
} from "@/lib/db/parliament/schema";
import { ragDebug } from "./debug";
import { formatDate, type Lang } from "./types";

const dbg = ragDebug("parl:enum");

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MemberVoteDetail = {
  politicianId: number;
  politicianName: string;
  politicianSlug: string;
  partyId: number;
  partyName: string;
  partyShort: string;
  vote: "Y" | "N" | "A" | string;
  dissent: boolean;
};

export type VoteQuestionInfo = {
  id: number;
  number: number;
  date: string;
  descriptionEn: string;
  descriptionFr: string;
  result: string;
  yeaTotal: number;
  nayTotal: number;
  pairedTotal: number;
  sessionId: string;
};

export type BillInfo = {
  id: number;
  number: string;
  nameEn: string;
  nameFr: string;
  sessionId: string;
  statusCode: string;
};

export type CompleteMemberVoteList = {
  bill: BillInfo;
  voteQuestion: VoteQuestionInfo;
  memberVotes: MemberVoteDetail[];
  byParty: Record<string, MemberVoteDetail[]>;
  totals: {
    yea: number;
    nay: number;
    paired: number;
  };
  markdown: string;
  languageUsed: Lang;
};

export type PoliticianSummary = {
  id: number;
  name: string;
  nameGiven: string;
  nameFamily: string;
  slug: string;
  partyId: number;
  partyName: string;
  partyShort: string;
  ridingName: string;
  ridingProvince: string;
};

export type CompletePoliticianList = {
  politicians: PoliticianSummary[];
  byParty: Record<string, PoliticianSummary[]>;
  total: number;
  sessionId?: string;
  markdown: string;
  languageUsed: Lang;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function formatVote(vote: string, lang: Lang): string {
  if (vote === "Y") {
    return lang === "fr" ? "Pour" : "Yea";
  }
  if (vote === "N") {
    return lang === "fr" ? "Contre" : "Nay";
  }
  if (vote === "A") {
    return lang === "fr" ? "Abstention" : "Abstain";
  }
  if (vote === "P") {
    return lang === "fr" ? "Jumelé" : "Paired";
  }
  return vote;
}

function formatVoteResult(result: string, lang: Lang): string {
  if (result === "Y") {
    return lang === "fr" ? "Adopté" : "Passed";
  }
  if (result === "N") {
    return lang === "fr" ? "Rejeté" : "Failed";
  }
  return result;
}

function groupBy<T>(
  items: T[],
  keyFn: (item: T) => string
): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
  }
  return result;
}

/**
 * Get localized party name from party record
 */
function getPartyName(party: CoreParty | undefined, lang: Lang): string {
  if (!party) {
    return "Unknown";
  }
  return (lang === "fr" ? party.nameFr : party.nameEn) || party.nameEn;
}

/**
 * Get localized party short name from party record
 */
function getPartyShortName(party: CoreParty | undefined, lang: Lang): string {
  if (!party) {
    return "?";
  }
  return (
    (lang === "fr" ? party.shortNameFr : party.shortNameEn) || party.shortNameEn
  );
}

type PoliticianSummaryInput = {
  pol: CorePolitician;
  partyId: number;
  partyMap: Map<number, CoreParty>;
  ridingName: string;
  ridingProvince: string;
  lang: Lang;
};

/**
 * Transform a politician record to a summary with party info
 */
function toPoliticianSummary(input: PoliticianSummaryInput): PoliticianSummary {
  const { pol, partyId, partyMap, ridingName, ridingProvince, lang } = input;
  const party = partyMap.get(partyId);
  return {
    id: pol.id,
    name: pol.name,
    nameGiven: pol.nameGiven,
    nameFamily: pol.nameFamily,
    slug: pol.slug,
    partyId,
    partyName: getPartyName(party, lang),
    partyShort: getPartyShortName(party, lang),
    ridingName,
    ridingProvince,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getCompleteMemberVotesForBill
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get ALL member votes for a bill's vote question(s).
 *
 * For bills with multiple votes (2nd reading, 3rd reading, etc.),
 * returns the FINAL vote (highest vote number) by default.
 *
 * @param args.billNumber - Bill number like "C-35" or "S-210"
 * @param args.sessionId - Optional session like "44-1" to disambiguate
 * @param args.voteType - Filter by vote type: "Y" (yea), "N" (nay), "A" (abstain), "P" (paired)
 * @param args.partySlug - Filter by party slug (e.g., "liberal", "conservative")
 * @param args.voteQuestionNumber - Specific vote number (e.g., 2nd reading = lower number)
 * @param args.language - Display language
 */
export async function getCompleteMemberVotesForBill(args: {
  billNumber: string;
  sessionId?: string;
  voteType?: "Y" | "N" | "A" | "P";
  partySlug?: string;
  voteQuestionNumber?: number;
  language: Lang;
}): Promise<CompleteMemberVoteList | null> {
  const {
    billNumber,
    sessionId,
    voteType,
    partySlug,
    voteQuestionNumber,
    language,
  } = args;
  const db = getDb();

  // 1. Find the bill
  const billWhere = sessionId
    ? and(eq(billsBill.number, billNumber), eq(billsBill.sessionId, sessionId))
    : eq(billsBill.number, billNumber);

  const billRows = await db
    .select()
    .from(billsBill)
    .innerJoin(coreSession, eq(billsBill.sessionId, coreSession.id))
    .where(billWhere)
    .orderBy(desc(coreSession.parliamentnum))
    .limit(1);

  if (billRows.length === 0) {
    dbg("Bill not found: %s", billNumber);
    return null;
  }

  const bill = billRows[0].bills_bill;
  dbg("Found bill: %s (%s)", bill.number, bill.sessionId);

  // 2. Find vote questions for this bill
  const voteQuestions = await db
    .select()
    .from(billsVotequestion)
    .where(eq(billsVotequestion.billId, bill.id))
    .orderBy(desc(billsVotequestion.number));

  if (voteQuestions.length === 0) {
    dbg("No votes found for bill %s", billNumber);
    return null;
  }

  // Select specific vote or default to final (highest number)
  const targetVote = voteQuestionNumber
    ? voteQuestions.find((v) => v.number === voteQuestionNumber)
    : voteQuestions[0]; // Already sorted desc, so first is highest

  if (!targetVote) {
    dbg("Vote question not found: %d", voteQuestionNumber);
    return null;
  }

  dbg(
    "Using vote question #%d (%s) - %d available",
    targetVote.number,
    targetVote.descriptionEn.slice(0, 50),
    voteQuestions.length
  );

  // 3. Fetch all parties for lookup
  const parties = await db.select().from(coreParty);
  const partyMap = new Map<number, CoreParty>(parties.map((p) => [p.id, p]));

  // Find party ID if filtering by slug
  let filterPartyId: number | undefined;
  if (partySlug) {
    const party = parties.find(
      (p) => p.slug.toLowerCase() === partySlug.toLowerCase()
    );
    if (party) {
      filterPartyId = party.id;
    }
  }

  // 4. Fetch ALL member votes for this vote question
  // Join with elected member to get party at time of vote
  const memberVoteQuery = db
    .select({
      mv: billsMembervote,
      pol: corePolitician,
      em: coreElectedmember,
    })
    .from(billsMembervote)
    .innerJoin(
      corePolitician,
      eq(billsMembervote.politicianId, corePolitician.id)
    )
    .innerJoin(
      coreElectedmember,
      eq(billsMembervote.memberId, coreElectedmember.id)
    )
    .where(eq(billsMembervote.votequestionId, targetVote.id));

  const memberVoteRows = await memberVoteQuery;

  // 5. Transform to MemberVoteDetail and apply filters
  let memberVotes: MemberVoteDetail[] = memberVoteRows.map((row) => {
    const party = partyMap.get(row.em.partyId);
    return {
      politicianId: row.pol.id,
      politicianName: row.pol.name,
      politicianSlug: row.pol.slug,
      partyId: row.em.partyId,
      partyName: getPartyName(party, language),
      partyShort: getPartyShortName(party, language),
      vote: row.mv.vote as "Y" | "N" | "A",
      dissent: row.mv.dissent,
    };
  });

  // Apply filters
  if (voteType) {
    memberVotes = memberVotes.filter((v) => v.vote === voteType);
  }
  if (filterPartyId) {
    memberVotes = memberVotes.filter((v) => v.partyId === filterPartyId);
  }

  // Sort by party, then name
  memberVotes.sort((a, b) => {
    if (a.partyShort !== b.partyShort) {
      return a.partyShort.localeCompare(b.partyShort);
    }
    return a.politicianName.localeCompare(b.politicianName);
  });

  dbg("Found %d member votes (after filters)", memberVotes.length);

  // 6. Group by party
  const byParty = groupBy(memberVotes, (v) => v.partyShort);

  // 7. Build result
  const result: CompleteMemberVoteList = {
    bill: {
      id: bill.id,
      number: bill.number,
      nameEn: bill.nameEn,
      nameFr: bill.nameFr,
      sessionId: bill.sessionId,
      statusCode: bill.statusCode,
    },
    voteQuestion: {
      id: targetVote.id,
      number: targetVote.number,
      date: formatDate(targetVote.date, "Unknown"),
      descriptionEn: targetVote.descriptionEn,
      descriptionFr: targetVote.descriptionFr,
      result: targetVote.result,
      yeaTotal: targetVote.yeaTotal,
      nayTotal: targetVote.nayTotal,
      pairedTotal: targetVote.pairedTotal,
      sessionId: targetVote.sessionId,
    },
    memberVotes,
    byParty,
    totals: {
      yea: targetVote.yeaTotal,
      nay: targetVote.nayTotal,
      paired: targetVote.pairedTotal,
    },
    markdown: "", // Will be set below
    languageUsed: language,
  };

  result.markdown = formatMemberVoteListMarkdown(result, language, voteType);

  return result;
}

/**
 * Format member vote list as markdown for LLM context.
 */
function formatMemberVoteListMarkdown(
  data: CompleteMemberVoteList,
  lang: Lang,
  voteTypeFilter?: "Y" | "N" | "A" | "P"
): string {
  const lines: string[] = [];
  const billName = lang === "fr" ? data.bill.nameFr : data.bill.nameEn;
  const voteDesc =
    lang === "fr"
      ? data.voteQuestion.descriptionFr
      : data.voteQuestion.descriptionEn;

  // Header
  lines.push(
    `# ${lang === "fr" ? "Votes sur le projet de loi" : "Votes on Bill"} ${data.bill.number}`
  );
  lines.push("");
  lines.push(`**${billName}**`);
  lines.push(
    `**${lang === "fr" ? "Vote" : "Vote"}:** #${data.voteQuestion.number} - ${data.voteQuestion.date}`
  );
  lines.push(
    `**${lang === "fr" ? "Description" : "Description"}:** ${voteDesc}`
  );
  lines.push(
    `**${lang === "fr" ? "Résultat" : "Result"}:** ${formatVoteResult(data.voteQuestion.result, lang)}`
  );
  lines.push("");

  // Vote totals
  lines.push(
    `| ${lang === "fr" ? "Pour" : "Yea"} | ${lang === "fr" ? "Contre" : "Nay"} | ${lang === "fr" ? "Jumelés" : "Paired"} |`
  );
  lines.push("|------|-----|--------|");
  lines.push(
    `| ${data.totals.yea} | ${data.totals.nay} | ${data.totals.paired} |`
  );
  lines.push("");

  // Filter description
  if (voteTypeFilter) {
    const filterLabel = formatVote(voteTypeFilter, lang);
    lines.push(
      `## ${lang === "fr" ? "Membres ayant voté" : "Members who voted"} ${filterLabel} (${data.memberVotes.length})`
    );
  } else {
    lines.push(
      `## ${lang === "fr" ? "Tous les votes des membres" : "All Member Votes"} (${data.memberVotes.length})`
    );
  }
  lines.push("");

  // Group by party for readability
  const sortedParties = Object.keys(data.byParty).sort();
  for (const partyShort of sortedParties) {
    const members = data.byParty[partyShort];
    if (!members || members.length === 0) {
      continue;
    }

    const partyName = members[0].partyName;
    lines.push(`### ${partyName} (${partyShort}) - ${members.length}`);

    // List members, grouped by vote type if not filtering
    if (voteTypeFilter) {
      lines.push(members.map((m) => m.politicianName).join(", "));
    } else {
      const byVote = groupBy(members, (m) => m.vote);
      for (const vote of ["Y", "N", "A", "P"]) {
        const voteMembers = byVote[vote];
        if (voteMembers && voteMembers.length > 0) {
          lines.push(
            `**${formatVote(vote, lang)}:** ${voteMembers.map((m) => m.politicianName).join(", ")}`
          );
        }
      }
    }
    lines.push("");
  }

  // Note about other votes if multiple exist
  // (This info would need to be passed in - simplified for now)

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// getAllPoliticians
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get ALL politicians matching the given criteria.
 *
 * @param args.sessionId - Filter by session (e.g., "44-1")
 * @param args.partySlug - Filter by party slug (e.g., "liberal")
 * @param args.dateRange - Filter by date range (active during this period)
 * @param args.currentOnly - Only include currently sitting MPs (no end date)
 * @param args.language - Display language
 */
export async function getAllPoliticians(args: {
  sessionId?: string;
  partySlug?: string;
  dateRange?: { start: Date; end: Date };
  currentOnly?: boolean;
  language: Lang;
}): Promise<CompletePoliticianList | null> {
  const { sessionId, partySlug, dateRange, currentOnly, language } = args;
  const db = getDb();

  // Load parties for lookup
  const parties = await db.select().from(coreParty);
  const partyMap = new Map<number, CoreParty>(parties.map((p) => [p.id, p]));

  // Find party ID if filtering by slug
  let filterPartyId: number | undefined;
  if (partySlug) {
    const party = parties.find(
      (p) => p.slug.toLowerCase() === partySlug.toLowerCase()
    );
    if (party) {
      filterPartyId = party.id;
    } else {
      dbg("Party not found: %s", partySlug);
      return null;
    }
  }

  // Build query based on filters
  if (sessionId) {
    // Get politicians who served in this session
    const rows = await db
      .select({
        pol: corePolitician,
        em: coreElectedmember,
        riding: coreRiding,
      })
      .from(coreElectedmemberSessions)
      .innerJoin(
        coreElectedmember,
        eq(coreElectedmemberSessions.electedmemberId, coreElectedmember.id)
      )
      .innerJoin(
        corePolitician,
        eq(coreElectedmember.politicianId, corePolitician.id)
      )
      .innerJoin(coreRiding, eq(coreElectedmember.ridingId, coreRiding.id))
      .where(
        and(
          eq(coreElectedmemberSessions.sessionId, sessionId),
          filterPartyId
            ? eq(coreElectedmember.partyId, filterPartyId)
            : undefined
        )
      );

    // Transform results
    const politicians: PoliticianSummary[] = rows.map((row) =>
      toPoliticianSummary({
        pol: row.pol,
        partyId: row.em.partyId,
        partyMap,
        ridingName:
          (language === "fr" ? row.riding.nameFr : row.riding.nameEn) ||
          row.riding.nameEn,
        ridingProvince: row.riding.province,
        lang: language,
      })
    );

    // Sort by party, then name
    politicians.sort((a, b) => {
      if (a.partyShort !== b.partyShort) {
        return a.partyShort.localeCompare(b.partyShort);
      }
      return a.name.localeCompare(b.name);
    });

    // Group by party
    const byParty = groupBy(politicians, (p) => p.partyShort);

    const result: CompletePoliticianList = {
      politicians,
      byParty,
      total: politicians.length,
      sessionId,
      markdown: "",
      languageUsed: language,
    };

    result.markdown = formatPoliticianListMarkdown(result, language);
    return result;
  }

  // Current MPs only
  if (currentOnly) {
    const rows = await db
      .select({
        pol: corePolitician,
        em: coreElectedmember,
        riding: coreRiding,
      })
      .from(coreElectedmember)
      .innerJoin(
        corePolitician,
        eq(coreElectedmember.politicianId, corePolitician.id)
      )
      .innerJoin(coreRiding, eq(coreElectedmember.ridingId, coreRiding.id))
      .where(
        and(
          isNull(coreElectedmember.endDate),
          filterPartyId
            ? eq(coreElectedmember.partyId, filterPartyId)
            : undefined
        )
      );

    const politicians: PoliticianSummary[] = rows.map((row) =>
      toPoliticianSummary({
        pol: row.pol,
        partyId: row.em.partyId,
        partyMap,
        ridingName:
          (language === "fr" ? row.riding.nameFr : row.riding.nameEn) ||
          row.riding.nameEn,
        ridingProvince: row.riding.province,
        lang: language,
      })
    );

    politicians.sort((a, b) => {
      if (a.partyShort !== b.partyShort) {
        return a.partyShort.localeCompare(b.partyShort);
      }
      return a.name.localeCompare(b.name);
    });

    const byParty = groupBy(politicians, (p) => p.partyShort);

    const result: CompletePoliticianList = {
      politicians,
      byParty,
      total: politicians.length,
      markdown: "",
      languageUsed: language,
    };

    result.markdown = formatPoliticianListMarkdown(result, language);
    return result;
  }

  // Date range filter
  if (dateRange) {
    const rows = await db
      .select({
        pol: corePolitician,
        em: coreElectedmember,
        riding: coreRiding,
      })
      .from(coreElectedmember)
      .innerJoin(
        corePolitician,
        eq(coreElectedmember.politicianId, corePolitician.id)
      )
      .innerJoin(coreRiding, eq(coreElectedmember.ridingId, coreRiding.id))
      .where(
        and(
          lte(coreElectedmember.startDate, dateRange.end),
          or(
            isNull(coreElectedmember.endDate),
            gte(coreElectedmember.endDate, dateRange.start)
          ),
          filterPartyId
            ? eq(coreElectedmember.partyId, filterPartyId)
            : undefined
        )
      );

    const politicians: PoliticianSummary[] = rows.map((row) =>
      toPoliticianSummary({
        pol: row.pol,
        partyId: row.em.partyId,
        partyMap,
        ridingName:
          (language === "fr" ? row.riding.nameFr : row.riding.nameEn) ||
          row.riding.nameEn,
        ridingProvince: row.riding.province,
        lang: language,
      })
    );

    politicians.sort((a, b) => {
      if (a.partyShort !== b.partyShort) {
        return a.partyShort.localeCompare(b.partyShort);
      }
      return a.name.localeCompare(b.name);
    });

    const byParty = groupBy(politicians, (p) => p.partyShort);

    const result: CompletePoliticianList = {
      politicians,
      byParty,
      total: politicians.length,
      markdown: "",
      languageUsed: language,
    };

    result.markdown = formatPoliticianListMarkdown(result, language);
    return result;
  }

  // No filters - need at least one
  dbg("getAllPoliticians requires at least one filter");
  return null;
}

/**
 * Format politician list as markdown for LLM context.
 */
function formatPoliticianListMarkdown(
  data: CompletePoliticianList,
  lang: Lang
): string {
  const lines: string[] = [];

  // Header
  if (data.sessionId) {
    lines.push(
      `# ${lang === "fr" ? "Députés de la session" : "MPs in Session"} ${data.sessionId}`
    );
  } else {
    lines.push(`# ${lang === "fr" ? "Liste des députés" : "List of MPs"}`);
  }
  lines.push("");
  lines.push(
    `**${lang === "fr" ? "Total" : "Total"}:** ${data.total} ${lang === "fr" ? "députés" : "MPs"}`
  );
  lines.push("");

  // Group by party
  const sortedParties = Object.keys(data.byParty).sort((a, b) => {
    // Sort by size (largest first)
    return (data.byParty[b]?.length || 0) - (data.byParty[a]?.length || 0);
  });

  for (const partyShort of sortedParties) {
    const members = data.byParty[partyShort];
    if (!members || members.length === 0) {
      continue;
    }

    const partyName = members[0].partyName;
    lines.push(`## ${partyName} (${partyShort}) - ${members.length}`);
    lines.push(members.map((m) => m.name).join(", "));
    lines.push("");
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Enumeration Intent Detection (LLM-based)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema for LLM-based enumeration intent detection
 */
const EnumerationIntentSchema = z.object({
  isEnumeration: z
    .boolean()
    .describe(
      "True if the user wants a COMPLETE list of items (all votes, all members, etc.) rather than just relevant examples"
    ),
  type: z
    .enum(["vote", "politician", "committee", "none"])
    .describe(
      "What type of enumeration: vote (how members voted on a bill), politician (list of MPs), committee (committee members), or none"
    ),
  billNumber: z
    .string()
    .nullable()
    .describe(
      "Bill number if mentioned (e.g., 'C-35', 'S-210'). Extract in uppercase format like 'C-35'"
    ),
  partySlug: z
    .enum(["liberal", "conservative", "ndp", "bq", "green", "independent", ""])
    .describe(
      "Party slug if filtering by party, empty string if not specified"
    ),
  voteType: z
    .enum(["Y", "N", "A", ""])
    .describe(
      "Vote filter: Y=yea/for/yes, N=nay/against/no, A=abstain, empty=all votes"
    ),
});

/**
 * Detect enumeration intent using LLM structured output.
 *
 * Enumeration queries require fetching COMPLETE result sets from the database
 * rather than top-N semantic search results. Examples:
 * - "How did each member vote on Bill C-35?" → fetch all 300+ votes
 * - "List all Liberal MPs" → fetch all Liberal members
 * - "Who voted against Bill S-210?" → fetch all nay votes
 */
export async function detectEnumerationIntent(query: string): Promise<{
  isEnumeration: boolean;
  type?: "vote" | "politician" | "committee";
  billNumber?: string;
  partySlug?: string;
  voteType?: "Y" | "N" | "A";
}> {
  if (!query?.trim()) {
    return { isEnumeration: false };
  }

  try {
    const model = myProvider.languageModel("small-model-structured");
    const { object } = await generateObject({
      model,
      schema: EnumerationIntentSchema,
      prompt: `Analyze this Canadian Parliament query to detect if the user wants a COMPLETE enumeration of items.

Enumeration queries want ALL items, not just a few examples:
- "How did each member vote on C-35?" → YES, wants all 300+ votes
- "Who voted for Bill C-35?" → YES, wants all yea voters
- "List all NDP MPs" → YES, wants complete party roster
- "What is Bill C-35 about?" → NO, wants summary not enumeration
- "Tell me about climate bills" → NO, wants info not a complete list

Query: "${query}"`,
    });

    dbg(
      "enumeration detection: isEnum=%s type=%s bill=%s party=%s vote=%s",
      object.isEnumeration,
      object.type,
      object.billNumber,
      object.partySlug,
      object.voteType
    );

    if (!object.isEnumeration || object.type === "none") {
      return { isEnumeration: false };
    }

    return {
      isEnumeration: true,
      type: object.type as "vote" | "politician" | "committee",
      billNumber: object.billNumber || undefined,
      partySlug: object.partySlug || undefined,
      voteType: (object.voteType as "Y" | "N" | "A") || undefined,
    };
  } catch (err) {
    dbg("enumeration detection failed: %O", err);
    return { isEnumeration: false };
  }
}
