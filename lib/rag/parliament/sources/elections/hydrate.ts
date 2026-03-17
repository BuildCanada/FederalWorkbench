import debugLib from "debug";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/connection";
import {
  coreParty,
  corePolitician,
  coreRiding,
  electionsCandidacy,
  electionsElection,
} from "@/lib/db/parliament/schema";
import { formatDate, type Lang } from "@/lib/rag/parliament/types";

/**
 * Hydrated election with results
 */
export type HydratedElectionResults = {
  election: {
    id: number;
    date: string | null;
    byelection: boolean;
  };
  topCandidacies: Array<{
    candidateId: number;
    candidateName: string;
    partyName: string;
    partyShort: string;
    ridingName: string;
    elected: boolean;
    votepercent: string | null;
  }>;
  markdown: string;
  languageUsed: Lang;
};

/**
 * Format election results as readable markdown
 */
export function formatElectionMarkdown(
  results: Omit<HydratedElectionResults, "markdown" | "languageUsed">,
  lang: Lang
): string {
  const lines: string[] = [];

  const dateStr = results.election.date || "Unknown Date";
  const type = results.election.byelection
    ? lang === "fr"
      ? "Élection partielle"
      : "By-election"
    : lang === "fr"
      ? "Élection générale"
      : "General Election";

  lines.push(`# ${type} - ${dateStr}`);
  lines.push("");

  if (results.topCandidacies.length > 0) {
    lines.push(`## ${lang === "fr" ? "Résultats" : "Results"}`);
    lines.push("");
    lines.push(
      `| ${lang === "fr" ? "Candidat" : "Candidate"} | ${lang === "fr" ? "Parti" : "Party"} | ${lang === "fr" ? "Circonscription" : "Riding"} | ${lang === "fr" ? "%" : "%"} | ${lang === "fr" ? "Élu" : "Elected"} |`
    );
    lines.push("|----------|-------|---------|------|---------|");

    for (const c of results.topCandidacies) {
      const elected = c.elected
        ? lang === "fr"
          ? "Oui"
          : "Yes"
        : lang === "fr"
          ? "Non"
          : "No";
      const pct =
        c.votepercent != null
          ? `${Number.parseFloat(c.votepercent).toFixed(1)}%`
          : "-";
      lines.push(
        `| ${c.candidateName} | ${c.partyShort} | ${c.ridingName} | ${pct} | ${elected} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get hydrated election results from the Parliament database
 */
export async function getHydratedElectionResults(args: {
  electionId: number;
  language: Lang;
  limit?: number;
}): Promise<HydratedElectionResults | null> {
  const { electionId, language, limit = 20 } = args;
  const dbg = debugLib("rag:election");
  const db = getDb();

  // Fetch election
  const electionRows = await db
    .select()
    .from(electionsElection)
    .where(eq(electionsElection.id, electionId))
    .limit(1);

  if (electionRows.length === 0) {
    dbg("Election not found: %d", electionId);
    return null;
  }

  const election = electionRows[0];

  // Fetch candidacies with related data
  const candidacyRows = await db
    .select({
      candidacy: electionsCandidacy,
      politician: corePolitician,
      riding: coreRiding,
      party: coreParty,
    })
    .from(electionsCandidacy)
    .leftJoin(
      corePolitician,
      eq(electionsCandidacy.candidateId, corePolitician.id)
    )
    .leftJoin(coreRiding, eq(electionsCandidacy.ridingId, coreRiding.id))
    .leftJoin(coreParty, eq(electionsCandidacy.partyId, coreParty.id))
    .where(eq(electionsCandidacy.electionId, electionId))
    .orderBy(desc(electionsCandidacy.votepercent))
    .limit(limit);

  const topCandidacies = candidacyRows.map((row) => ({
    candidateId: row.politician?.id || 0,
    candidateName: row.politician?.name || "Unknown",
    partyName:
      (language === "fr" ? row.party?.nameFr : row.party?.nameEn) ||
      row.party?.nameEn ||
      "Unknown",
    partyShort:
      (language === "fr" ? row.party?.shortNameFr : row.party?.shortNameEn) ||
      row.party?.shortNameEn ||
      "?",
    ridingName:
      (language === "fr" ? row.riding?.nameFr : row.riding?.nameEn) ||
      row.riding?.nameEn ||
      "Unknown",
    elected: row.candidacy.elected ?? false,
    votepercent: row.candidacy.votepercent,
  }));

  const resultsData = {
    election: {
      id: election.id,
      date: formatDate(election.date),
      byelection: election.byelection ?? false,
    },
    topCandidacies,
  };

  const markdown = formatElectionMarkdown(resultsData, language);

  return {
    ...resultsData,
    markdown,
    languageUsed: language,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidacy Hydrator
// ─────────────────────────────────────────────────────────────────────────────

export type HydratedCandidacy = {
  candidacy: {
    id: number;
    votetotal: number | null;
    votepercent: number | null;
    elected: boolean;
  };
  politician: {
    id: number;
    name: string;
    slug: string;
  };
  party: {
    id: number;
    nameEn: string | null;
    nameFr: string | null;
    shortNameEn: string | null;
    shortNameFr: string | null;
  };
  riding: {
    id: number;
    nameEn: string | null;
    nameFr: string | null;
    province: string;
  };
  election: {
    id: number;
    date: string;
    byelection: boolean;
  };
  markdown: string;
  languageUsed: Lang;
};

function formatCandidacyMarkdown(
  data: Omit<HydratedCandidacy, "markdown" | "languageUsed">,
  lang: Lang
): string {
  const lines: string[] = [];
  const partyName =
    (lang === "fr" ? data.party.nameFr : data.party.nameEn) ||
    data.party.nameEn ||
    "Unknown";
  const partyShort =
    (lang === "fr" ? data.party.shortNameFr : data.party.shortNameEn) ||
    data.party.shortNameEn ||
    "?";
  const ridingName =
    (lang === "fr" ? data.riding.nameFr : data.riding.nameEn) ||
    data.riding.nameEn ||
    "Unknown";
  const electionType = data.election.byelection
    ? lang === "fr"
      ? "Élection partielle"
      : "By-election"
    : lang === "fr"
      ? "Élection générale"
      : "General Election";

  lines.push(`# ${data.politician.name}`);
  lines.push("");

  lines.push(
    `**${lang === "fr" ? "Élection" : "Election"}:** ${electionType} - ${data.election.date}`
  );
  lines.push(
    `**${lang === "fr" ? "Parti" : "Party"}:** ${partyName} (${partyShort})`
  );
  lines.push(
    `**${lang === "fr" ? "Circonscription" : "Riding"}:** ${ridingName}`
  );
  lines.push(
    `**${lang === "fr" ? "Province" : "Province"}:** ${data.riding.province}`
  );

  if (data.candidacy.votetotal != null) {
    lines.push(
      `**${lang === "fr" ? "Votes" : "Votes"}:** ${data.candidacy.votetotal.toLocaleString()}`
    );
  }
  if (data.candidacy.votepercent != null) {
    lines.push(
      `**${lang === "fr" ? "Pourcentage" : "Percentage"}:** ${Number(data.candidacy.votepercent).toFixed(1)}%`
    );
  }
  lines.push(
    `**${lang === "fr" ? "Élu" : "Elected"}:** ${data.candidacy.elected ? (lang === "fr" ? "Oui" : "Yes") : lang === "fr" ? "Non" : "No"}`
  );
  lines.push("");

  return lines.join("\n");
}

/**
 * Get hydrated candidacy by ID
 */
export async function getHydratedCandidacy(args: {
  candidacyId: number;
  language: Lang;
}): Promise<HydratedCandidacy | null> {
  const { candidacyId, language } = args;
  const dbg = debugLib("rag:candidacy");
  const db = getDb();

  const rows = await db
    .select({
      candidacy: electionsCandidacy,
      politician: corePolitician,
      party: coreParty,
      riding: coreRiding,
      election: electionsElection,
    })
    .from(electionsCandidacy)
    .innerJoin(
      corePolitician,
      eq(electionsCandidacy.candidateId, corePolitician.id)
    )
    .innerJoin(coreParty, eq(electionsCandidacy.partyId, coreParty.id))
    .innerJoin(coreRiding, eq(electionsCandidacy.ridingId, coreRiding.id))
    .innerJoin(
      electionsElection,
      eq(electionsCandidacy.electionId, electionsElection.id)
    )
    .where(eq(electionsCandidacy.id, candidacyId))
    .limit(1);

  if (rows.length === 0) {
    dbg("Candidacy not found: %d", candidacyId);
    return null;
  }

  const { candidacy, politician, party, riding, election } = rows[0];

  const data = {
    candidacy: {
      id: candidacy.id,
      votetotal: candidacy.votetotal,
      votepercent: candidacy.votepercent ? Number(candidacy.votepercent) : null,
      elected: candidacy.elected ?? false,
    },
    politician: {
      id: politician.id,
      name: politician.name,
      slug: politician.slug,
    },
    party: {
      id: party.id,
      nameEn: party.nameEn,
      nameFr: party.nameFr,
      shortNameEn: party.shortNameEn,
      shortNameFr: party.shortNameFr,
    },
    riding: {
      id: riding.id,
      nameEn: riding.nameEn,
      nameFr: riding.nameFr,
      province: riding.province,
    },
    election: {
      id: election.id,
      date: formatDate(election.date) || "",
      byelection: election.byelection,
    },
  };

  const markdown = formatCandidacyMarkdown(data, language);

  return {
    ...data,
    markdown,
    languageUsed: language,
  };
}
