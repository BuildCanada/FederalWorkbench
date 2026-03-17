import debugLib from "debug";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/connection";
import {
  billsBill,
  billsMembervote,
  billsPartyvote,
  billsVotequestion,
  type CoreParty,
  coreParty,
  corePolitician,
  coreSession,
} from "@/lib/db/parliament/schema";
import { formatDate, type Lang } from "@/lib/rag/parliament/types";

export type PartyVoteResult = {
  partyId: number;
  partyName: string;
  partyShort: string;
  vote: "Y" | "N" | "A" | string; // Yea, Nay, Abstain
};

export type MemberVoteResult = {
  politicianId: number;
  politicianName: string;
  politicianSlug: string;
  vote: "Y" | "N" | "A" | string;
  dissent: boolean;
};

export type VoteQuestionSummary = {
  id: number;
  number: number;
  date: string;
  descriptionEn: string;
  descriptionFr: string;
  result: "Y" | "N" | string; // Passed or Failed
  yeaTotal: number;
  nayTotal: number;
  pairedTotal: number;
  partyVotes: PartyVoteResult[];
  notableDissenters?: MemberVoteResult[]; // MPs who voted against their party
};

export type HydratedVoteSummary = {
  billNumber: string;
  billNameEn: string;
  billNameFr: string;
  sessionId: string;
  votes: VoteQuestionSummary[];
  markdown: string;
  languageUsed: Lang;
};

function formatVoteResult(result: string, lang: Lang): string {
  if (result === "Y") {
    return lang === "fr" ? "Adopté" : "Passed";
  }
  if (result === "N") {
    return lang === "fr" ? "Rejeté" : "Failed";
  }
  return result;
}

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
  return vote;
}

/** Format date with "Unknown" fallback for display */
function fmtDateWithFallback(d?: Date | null): string {
  return formatDate(d, "Unknown");
}

/**
 * Format vote summary as markdown for LLM context
 */
export function formatVoteSummaryMarkdown(
  summary: HydratedVoteSummary,
  lang: Lang
): string {
  const lines: string[] = [];
  const billName = lang === "fr" ? summary.billNameFr : summary.billNameEn;

  lines.push(
    `# ${lang === "fr" ? "Votes sur le projet de loi" : "Votes on Bill"} ${summary.billNumber}`
  );
  lines.push("");
  lines.push(`**${billName}**`);
  lines.push(`Session: ${summary.sessionId}`);
  lines.push("");

  for (const vote of summary.votes) {
    const desc = lang === "fr" ? vote.descriptionFr : vote.descriptionEn;
    const result = formatVoteResult(vote.result, lang);

    lines.push(`## ${lang === "fr" ? "Vote" : "Vote"} #${vote.number}`);
    lines.push(`**${lang === "fr" ? "Date" : "Date"}:** ${vote.date}`);
    lines.push(`**${lang === "fr" ? "Description" : "Description"}:** ${desc}`);
    lines.push(`**${lang === "fr" ? "Résultat" : "Result"}:** ${result}`);
    lines.push("");

    // Vote totals
    lines.push(
      `| ${lang === "fr" ? "Pour" : "Yea"} | ${lang === "fr" ? "Contre" : "Nay"} | ${lang === "fr" ? "Jumelés" : "Paired"} |`
    );
    lines.push("|------|-----|--------|");
    lines.push(`| ${vote.yeaTotal} | ${vote.nayTotal} | ${vote.pairedTotal} |`);
    lines.push("");

    // Party breakdown
    if (vote.partyVotes.length > 0) {
      lines.push(`### ${lang === "fr" ? "Vote par parti" : "Party Breakdown"}`);
      lines.push(
        `| ${lang === "fr" ? "Parti" : "Party"} | ${lang === "fr" ? "Vote" : "Vote"} |`
      );
      lines.push("|-------|------|");
      for (const pv of vote.partyVotes) {
        lines.push(
          `| ${pv.partyName} (${pv.partyShort}) | ${formatVote(pv.vote, lang)} |`
        );
      }
      lines.push("");
    }

    // Notable dissenters
    if (vote.notableDissenters && vote.notableDissenters.length > 0) {
      lines.push(
        `### ${lang === "fr" ? "Dissidents notables" : "Notable Dissenters"}`
      );
      for (const d of vote.notableDissenters.slice(0, 5)) {
        lines.push(`- ${d.politicianName}: ${formatVote(d.vote, lang)}`);
      }
      if (vote.notableDissenters.length > 5) {
        lines.push(
          `- ${lang === "fr" ? "et" : "and"} ${vote.notableDissenters.length - 5} ${lang === "fr" ? "autres" : "more"}...`
        );
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Get hydrated vote summary for a bill
 *
 * Fetches all vote questions for a bill, along with party breakdowns
 * and notable dissenters.
 */
export async function getHydratedVoteSummary(args: {
  billNumber: string;
  parliament?: number;
  session?: number;
  sessionId?: string; // Alternative: provide sessionId directly like "44-1"
  language: Lang;
  includeDissenters?: boolean;
}): Promise<HydratedVoteSummary | null> {
  const {
    billNumber,
    parliament,
    session,
    sessionId: providedSessionId,
    language,
    includeDissenters = true,
  } = args;
  const dbg = debugLib("rag:vote");
  const db = getDb();

  // Find the bill
  let billRows: { bill: typeof billsBill.$inferSelect }[];
  if (providedSessionId) {
    billRows = await db
      .select({ bill: billsBill })
      .from(billsBill)
      .where(
        and(
          eq(billsBill.number, billNumber),
          eq(billsBill.sessionId, providedSessionId)
        )
      );
  } else if (parliament && session) {
    const sessionIdPattern = `${parliament}-${session}`;
    billRows = await db
      .select({ bill: billsBill })
      .from(billsBill)
      .where(
        and(
          eq(billsBill.number, billNumber),
          eq(billsBill.sessionId, sessionIdPattern)
        )
      );
  } else {
    // Find most recent bill with this number
    billRows = await db
      .select({ bill: billsBill, sess: coreSession })
      .from(billsBill)
      .innerJoin(coreSession, eq(billsBill.sessionId, coreSession.id))
      .where(eq(billsBill.number, billNumber))
      .orderBy(coreSession.parliamentnum)
      .limit(1);
  }

  if (!billRows || billRows.length === 0) {
    dbg("Bill not found: %s", billNumber);
    return null;
  }

  const bill = billRows[0].bill;
  dbg("Found bill: %s (%s)", bill.number, bill.sessionId);

  // Fetch vote questions for this bill
  const voteQuestions = await db
    .select()
    .from(billsVotequestion)
    .where(eq(billsVotequestion.billId, bill.id))
    .orderBy(billsVotequestion.date);

  if (voteQuestions.length === 0) {
    dbg("No votes found for bill %s", billNumber);
    return null;
  }

  dbg("Found %d vote questions", voteQuestions.length);

  // Fetch all parties for name lookup
  const parties = await db.select().from(coreParty);
  const partyMap = new Map<number, CoreParty>(parties.map((p) => [p.id, p]));

  // Fetch party votes for all vote questions
  const voteQuestionIds = voteQuestions.map((vq) => vq.id);
  const partyVotes = await db
    .select()
    .from(billsPartyvote)
    .where(inArray(billsPartyvote.votequestionId, voteQuestionIds));

  // Group party votes by vote question
  const partyVotesByQuestion = new Map<number, typeof partyVotes>();
  for (const pv of partyVotes) {
    const existing = partyVotesByQuestion.get(pv.votequestionId) || [];
    existing.push(pv);
    partyVotesByQuestion.set(pv.votequestionId, existing);
  }

  // Optionally fetch dissenters
  const dissentersByQuestion = new Map<number, MemberVoteResult[]>();
  if (includeDissenters) {
    const memberVotes = await db
      .select({ mv: billsMembervote, pol: corePolitician })
      .from(billsMembervote)
      .innerJoin(
        corePolitician,
        eq(billsMembervote.politicianId, corePolitician.id)
      )
      .where(
        and(
          inArray(billsMembervote.votequestionId, voteQuestionIds),
          eq(billsMembervote.dissent, true)
        )
      );

    for (const row of memberVotes) {
      const vqId = row.mv.votequestionId;
      const existing = dissentersByQuestion.get(vqId) || [];
      existing.push({
        politicianId: row.pol.id,
        politicianName: row.pol.name,
        politicianSlug: row.pol.slug,
        vote: row.mv.vote,
        dissent: true,
      });
      dissentersByQuestion.set(vqId, existing);
    }
  }

  // Build vote summaries
  const voteSummaries: VoteQuestionSummary[] = voteQuestions.map((vq) => {
    const pvs = partyVotesByQuestion.get(vq.id) || [];
    const partyResults: PartyVoteResult[] = pvs.map((pv) => {
      const party = partyMap.get(pv.partyId);
      return {
        partyId: pv.partyId,
        partyName:
          (language === "fr" ? party?.nameFr : party?.nameEn) ||
          party?.nameEn ||
          "Unknown",
        partyShort:
          (language === "fr" ? party?.shortNameFr : party?.shortNameEn) ||
          party?.shortNameEn ||
          "?",
        vote: pv.vote,
      };
    });

    return {
      id: vq.id,
      number: vq.number,
      date: fmtDateWithFallback(vq.date),
      descriptionEn: vq.descriptionEn || "",
      descriptionFr: vq.descriptionFr || "",
      result: vq.result,
      yeaTotal: vq.yeaTotal,
      nayTotal: vq.nayTotal,
      pairedTotal: vq.pairedTotal,
      partyVotes: partyResults,
      notableDissenters: dissentersByQuestion.get(vq.id),
    };
  });

  const markdown = formatVoteSummaryMarkdown(
    {
      billNumber: bill.number,
      billNameEn: bill.nameEn || "",
      billNameFr: bill.nameFr || "",
      sessionId: bill.sessionId,
      votes: voteSummaries,
      markdown: "",
      languageUsed: language,
    },
    language
  );

  return {
    billNumber: bill.number,
    billNameEn: bill.nameEn || "",
    billNameFr: bill.nameFr || "",
    sessionId: bill.sessionId,
    votes: voteSummaries,
    markdown,
    languageUsed: language,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Vote Question Hydrator
// ─────────────────────────────────────────────────────────────────────────────

export type HydratedVoteQuestion = {
  voteQuestion: {
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
    billId: number | null;
  };
  bill?: {
    number: string;
    nameEn: string | null;
    nameFr: string | null;
  };
  partyVotes: PartyVoteResult[];
  markdown: string;
  languageUsed: Lang;
};

function formatVoteQuestionMarkdown(
  data: Omit<HydratedVoteQuestion, "markdown" | "languageUsed">,
  lang: Lang
): string {
  const lines: string[] = [];
  const vq = data.voteQuestion;
  const desc = lang === "fr" ? vq.descriptionFr : vq.descriptionEn;
  const result = formatVoteResult(vq.result, lang);

  lines.push(`# ${lang === "fr" ? "Vote" : "Vote"} #${vq.number} - ${vq.date}`);
  lines.push("");

  if (data.bill) {
    const billName = lang === "fr" ? data.bill.nameFr : data.bill.nameEn;
    lines.push(
      `**${lang === "fr" ? "Projet de loi" : "Bill"}:** ${data.bill.number}${billName ? ` - ${billName}` : ""}`
    );
  }
  lines.push(`**Session:** ${vq.sessionId}`);
  lines.push(`**${lang === "fr" ? "Description" : "Description"}:** ${desc}`);
  lines.push(`**${lang === "fr" ? "Résultat" : "Result"}:** ${result}`);
  lines.push("");

  lines.push(
    `| ${lang === "fr" ? "Pour" : "Yea"} | ${lang === "fr" ? "Contre" : "Nay"} | ${lang === "fr" ? "Jumelés" : "Paired"} |`
  );
  lines.push("|------|-----|--------|");
  lines.push(`| ${vq.yeaTotal} | ${vq.nayTotal} | ${vq.pairedTotal} |`);
  lines.push("");

  if (data.partyVotes.length > 0) {
    lines.push(`## ${lang === "fr" ? "Vote par parti" : "Party Breakdown"}`);
    lines.push(
      `| ${lang === "fr" ? "Parti" : "Party"} | ${lang === "fr" ? "Vote" : "Vote"} |`
    );
    lines.push("|-------|------|");
    for (const pv of data.partyVotes) {
      lines.push(
        `| ${pv.partyName} (${pv.partyShort}) | ${formatVote(pv.vote, lang)} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get hydrated vote question by ID
 */
export async function getHydratedVoteQuestion(args: {
  voteQuestionId: number;
  language: Lang;
}): Promise<HydratedVoteQuestion | null> {
  const { voteQuestionId, language } = args;
  const dbg = debugLib("rag:vote_question");
  const db = getDb();

  const rows = await db
    .select()
    .from(billsVotequestion)
    .where(eq(billsVotequestion.id, voteQuestionId))
    .limit(1);

  if (rows.length === 0) {
    dbg("Vote question not found: %d", voteQuestionId);
    return null;
  }

  const vq = rows[0];

  // Fetch bill if associated
  let bill: HydratedVoteQuestion["bill"];
  if (vq.billId) {
    const billRows = await db
      .select()
      .from(billsBill)
      .where(eq(billsBill.id, vq.billId))
      .limit(1);
    if (billRows.length > 0) {
      bill = {
        number: billRows[0].number,
        nameEn: billRows[0].nameEn,
        nameFr: billRows[0].nameFr,
      };
    }
  }

  // Fetch party votes
  const parties = await db.select().from(coreParty);
  const partyMap = new Map<number, CoreParty>(parties.map((p) => [p.id, p]));

  const partyVoteRows = await db
    .select()
    .from(billsPartyvote)
    .where(eq(billsPartyvote.votequestionId, voteQuestionId));

  const partyVotes: PartyVoteResult[] = partyVoteRows.map((pv) => {
    const party = partyMap.get(pv.partyId);
    return {
      partyId: pv.partyId,
      partyName:
        (language === "fr" ? party?.nameFr : party?.nameEn) ||
        party?.nameEn ||
        "Unknown",
      partyShort:
        (language === "fr" ? party?.shortNameFr : party?.shortNameEn) ||
        party?.shortNameEn ||
        "?",
      vote: pv.vote,
    };
  });

  const data = {
    voteQuestion: {
      id: vq.id,
      number: vq.number,
      date: fmtDateWithFallback(vq.date),
      descriptionEn: vq.descriptionEn,
      descriptionFr: vq.descriptionFr,
      result: vq.result,
      yeaTotal: vq.yeaTotal,
      nayTotal: vq.nayTotal,
      pairedTotal: vq.pairedTotal,
      sessionId: vq.sessionId,
      billId: vq.billId,
    },
    bill,
    partyVotes,
  };

  const markdown = formatVoteQuestionMarkdown(data, language);

  return {
    ...data,
    markdown,
    languageUsed: language,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Party Vote Hydrator
// ─────────────────────────────────────────────────────────────────────────────

export type HydratedPartyVoteRecord = {
  partyVote: {
    id: number;
    vote: string;
    disagreement: number | null;
  };
  party: {
    id: number;
    nameEn: string | null;
    nameFr: string | null;
    shortNameEn: string | null;
    shortNameFr: string | null;
  };
  voteQuestion: {
    id: number;
    number: number;
    date: string;
    descriptionEn: string;
    descriptionFr: string;
    result: string;
  };
  bill?: {
    number: string;
    nameEn: string | null;
    nameFr: string | null;
  };
  markdown: string;
  languageUsed: Lang;
};

function formatPartyVoteMarkdown(
  data: Omit<HydratedPartyVoteRecord, "markdown" | "languageUsed">,
  lang: Lang
): string {
  const lines: string[] = [];
  const partyName =
    (lang === "fr" ? data.party.nameFr : data.party.nameEn) ||
    data.party.nameEn ||
    "Unknown";
  const desc =
    lang === "fr"
      ? data.voteQuestion.descriptionFr
      : data.voteQuestion.descriptionEn;

  lines.push(
    `# ${partyName} - ${lang === "fr" ? "Vote" : "Vote"} #${data.voteQuestion.number}`
  );
  lines.push("");

  lines.push(
    `**${lang === "fr" ? "Date" : "Date"}:** ${data.voteQuestion.date}`
  );
  lines.push(
    `**${lang === "fr" ? "Vote" : "Vote"}:** ${formatVote(data.partyVote.vote, lang)}`
  );
  lines.push(`**${lang === "fr" ? "Description" : "Description"}:** ${desc}`);
  lines.push(
    `**${lang === "fr" ? "Résultat du vote" : "Vote Result"}:** ${formatVoteResult(data.voteQuestion.result, lang)}`
  );

  if (data.partyVote.disagreement != null) {
    lines.push(
      `**${lang === "fr" ? "Désaccord interne" : "Internal Disagreement"}:** ${(data.partyVote.disagreement * 100).toFixed(1)}%`
    );
  }

  if (data.bill) {
    const billName = lang === "fr" ? data.bill.nameFr : data.bill.nameEn;
    lines.push(
      `**${lang === "fr" ? "Projet de loi" : "Bill"}:** ${data.bill.number}${billName ? ` - ${billName}` : ""}`
    );
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Get hydrated party vote by ID
 */
export async function getHydratedPartyVote(args: {
  partyVoteId: number;
  language: Lang;
}): Promise<HydratedPartyVoteRecord | null> {
  const { partyVoteId, language } = args;
  const dbg = debugLib("rag:vote_party");
  const db = getDb();

  const rows = await db
    .select({
      pv: billsPartyvote,
      party: coreParty,
      vq: billsVotequestion,
    })
    .from(billsPartyvote)
    .innerJoin(coreParty, eq(billsPartyvote.partyId, coreParty.id))
    .innerJoin(
      billsVotequestion,
      eq(billsPartyvote.votequestionId, billsVotequestion.id)
    )
    .where(eq(billsPartyvote.id, partyVoteId))
    .limit(1);

  if (rows.length === 0) {
    dbg("Party vote not found: %d", partyVoteId);
    return null;
  }

  const { pv, party, vq } = rows[0];

  // Fetch bill if associated
  let bill: HydratedPartyVoteRecord["bill"];
  if (vq.billId) {
    const billRows = await db
      .select()
      .from(billsBill)
      .where(eq(billsBill.id, vq.billId))
      .limit(1);
    if (billRows.length > 0) {
      bill = {
        number: billRows[0].number,
        nameEn: billRows[0].nameEn,
        nameFr: billRows[0].nameFr,
      };
    }
  }

  const data = {
    partyVote: {
      id: pv.id,
      vote: pv.vote,
      disagreement: pv.disagreement,
    },
    party: {
      id: party.id,
      nameEn: party.nameEn,
      nameFr: party.nameFr,
      shortNameEn: party.shortNameEn,
      shortNameFr: party.shortNameFr,
    },
    voteQuestion: {
      id: vq.id,
      number: vq.number,
      date: fmtDateWithFallback(vq.date),
      descriptionEn: vq.descriptionEn,
      descriptionFr: vq.descriptionFr,
      result: vq.result,
    },
    bill,
  };

  const markdown = formatPartyVoteMarkdown(data, language);

  return {
    ...data,
    markdown,
    languageUsed: language,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Member Vote Hydrator
// ─────────────────────────────────────────────────────────────────────────────

export type HydratedMemberVoteRecord = {
  memberVote: {
    id: number;
    vote: string;
    dissent: boolean;
  };
  politician: {
    id: number;
    name: string;
    slug: string;
  };
  voteQuestion: {
    id: number;
    number: number;
    date: string;
    descriptionEn: string;
    descriptionFr: string;
    result: string;
  };
  bill?: {
    number: string;
    nameEn: string | null;
    nameFr: string | null;
  };
  markdown: string;
  languageUsed: Lang;
};

function formatMemberVoteMarkdown(
  data: Omit<HydratedMemberVoteRecord, "markdown" | "languageUsed">,
  lang: Lang
): string {
  const lines: string[] = [];
  const desc =
    lang === "fr"
      ? data.voteQuestion.descriptionFr
      : data.voteQuestion.descriptionEn;

  lines.push(
    `# ${data.politician.name} - ${lang === "fr" ? "Vote" : "Vote"} #${data.voteQuestion.number}`
  );
  lines.push("");

  lines.push(
    `**${lang === "fr" ? "Date" : "Date"}:** ${data.voteQuestion.date}`
  );
  lines.push(
    `**${lang === "fr" ? "Vote" : "Vote"}:** ${formatVote(data.memberVote.vote, lang)}`
  );
  if (data.memberVote.dissent) {
    lines.push(
      `**${lang === "fr" ? "Dissident" : "Dissent"}:** ${lang === "fr" ? "Oui" : "Yes"}`
    );
  }
  lines.push(`**${lang === "fr" ? "Description" : "Description"}:** ${desc}`);
  lines.push(
    `**${lang === "fr" ? "Résultat du vote" : "Vote Result"}:** ${formatVoteResult(data.voteQuestion.result, lang)}`
  );

  if (data.bill) {
    const billName = lang === "fr" ? data.bill.nameFr : data.bill.nameEn;
    lines.push(
      `**${lang === "fr" ? "Projet de loi" : "Bill"}:** ${data.bill.number}${billName ? ` - ${billName}` : ""}`
    );
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Get hydrated member vote by ID
 */
export async function getHydratedMemberVote(args: {
  memberVoteId: number;
  language: Lang;
}): Promise<HydratedMemberVoteRecord | null> {
  const { memberVoteId, language } = args;
  const dbg = debugLib("rag:vote_member");
  const db = getDb();

  const rows = await db
    .select({
      mv: billsMembervote,
      pol: corePolitician,
      vq: billsVotequestion,
    })
    .from(billsMembervote)
    .innerJoin(
      corePolitician,
      eq(billsMembervote.politicianId, corePolitician.id)
    )
    .innerJoin(
      billsVotequestion,
      eq(billsMembervote.votequestionId, billsVotequestion.id)
    )
    .where(eq(billsMembervote.id, memberVoteId))
    .limit(1);

  if (rows.length === 0) {
    dbg("Member vote not found: %d", memberVoteId);
    return null;
  }

  const { mv, pol, vq } = rows[0];

  // Fetch bill if associated
  let bill: HydratedMemberVoteRecord["bill"];
  if (vq.billId) {
    const billRows = await db
      .select()
      .from(billsBill)
      .where(eq(billsBill.id, vq.billId))
      .limit(1);
    if (billRows.length > 0) {
      bill = {
        number: billRows[0].number,
        nameEn: billRows[0].nameEn,
        nameFr: billRows[0].nameFr,
      };
    }
  }

  const data = {
    memberVote: {
      id: mv.id,
      vote: mv.vote,
      dissent: mv.dissent,
    },
    politician: {
      id: pol.id,
      name: pol.name,
      slug: pol.slug,
    },
    voteQuestion: {
      id: vq.id,
      number: vq.number,
      date: fmtDateWithFallback(vq.date),
      descriptionEn: vq.descriptionEn,
      descriptionFr: vq.descriptionFr,
      result: vq.result,
    },
    bill,
  };

  const markdown = formatMemberVoteMarkdown(data, language);

  return {
    ...data,
    markdown,
    languageUsed: language,
  };
}
