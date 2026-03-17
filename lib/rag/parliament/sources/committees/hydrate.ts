import debugLib from "debug";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/connection";
import {
  type CommitteesCommittee,
  committeesCommittee,
  committeesCommitteemeeting,
  committeesCommitteereport,
} from "@/lib/db/parliament/schema";
import { formatDate, type Lang } from "@/lib/rag/parliament/types";

/**
 * Hydrated committee with full context
 */
export type HydratedCommitteeInfo = {
  committee: {
    id: number;
    slug: string;
    nameEn: string | null;
    nameFr: string | null;
    shortNameEn: string | null;
    shortNameFr: string | null;
    parentId: number | null;
  };
  recentReports: Array<{
    id: number;
    nameEn: string | null;
    nameFr: string | null;
    presentedDate: string | null;
  }>;
  recentMeetings: Array<{
    id: number;
    number: number;
    date: string | null;
  }>;
  markdown: string;
  languageUsed: Lang;
};

/**
 * Format a committee as readable markdown
 */
export function formatCommitteeMarkdown(
  info: Omit<HydratedCommitteeInfo, "markdown" | "languageUsed">,
  lang: Lang
): string {
  const lines: string[] = [];
  const name =
    (lang === "fr" ? info.committee.nameFr : info.committee.nameEn) ||
    info.committee.nameEn ||
    "Unknown Committee";

  lines.push(`# ${name}`);
  lines.push("");

  // Short name
  const shortName =
    (lang === "fr" ? info.committee.shortNameFr : info.committee.shortNameEn) ||
    info.committee.shortNameEn;
  if (shortName) {
    lines.push(`**${lang === "fr" ? "Acronyme" : "Acronym"}:** ${shortName}`);
  }
  lines.push(`**Slug:** ${info.committee.slug}`);
  lines.push("");

  // Recent reports
  if (info.recentReports.length > 0) {
    lines.push(`## ${lang === "fr" ? "Rapports récents" : "Recent Reports"}`);
    for (const report of info.recentReports) {
      const reportName =
        (lang === "fr" ? report.nameFr : report.nameEn) ||
        report.nameEn ||
        "Untitled Report";
      const date = report.presentedDate || "";
      lines.push(`- ${reportName}${date ? ` (${date})` : ""}`);
    }
    lines.push("");
  }

  // Recent meetings
  if (info.recentMeetings.length > 0) {
    lines.push(`## ${lang === "fr" ? "Réunions récentes" : "Recent Meetings"}`);
    for (const meeting of info.recentMeetings) {
      const date = meeting.date || "Unknown date";
      lines.push(
        `- ${lang === "fr" ? "Réunion" : "Meeting"} #${meeting.number} (${date})`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get hydrated committee info from the Parliament database
 *
 * @param args - Committee identification and language preference
 * @returns Hydrated committee info with markdown content
 */
export async function getHydratedCommitteeInfo(args: {
  committeeId?: number;
  slug?: string;
  language: Lang;
  includeReports?: boolean;
  includeMeetings?: boolean;
}): Promise<HydratedCommitteeInfo | null> {
  const {
    committeeId,
    slug,
    language,
    includeReports = true,
    includeMeetings = true,
  } = args;
  const dbg = debugLib("rag:committee");
  const db = getDb();

  // Fetch committee
  let committeeRows: CommitteesCommittee[];
  if (committeeId) {
    committeeRows = await db
      .select()
      .from(committeesCommittee)
      .where(eq(committeesCommittee.id, committeeId))
      .limit(1);
  } else if (slug) {
    committeeRows = await db
      .select()
      .from(committeesCommittee)
      .where(eq(committeesCommittee.slug, slug))
      .limit(1);
  } else {
    return null;
  }

  if (committeeRows.length === 0) {
    dbg("Committee not found: %s", committeeId || slug);
    return null;
  }

  const committee = committeeRows[0];

  // Fetch reports and meetings in parallel
  const [recentReports, recentMeetings] = await Promise.all([
    includeReports
      ? db
          .select()
          .from(committeesCommitteereport)
          .where(eq(committeesCommitteereport.committeeId, committee.id))
          .orderBy(desc(committeesCommitteereport.presentedDate))
          .limit(5)
          .then((rows) =>
            rows.map((r) => ({
              id: r.id,
              nameEn: r.nameEn,
              nameFr: r.nameFr,
              presentedDate: formatDate(r.presentedDate),
            }))
          )
      : Promise.resolve([] as HydratedCommitteeInfo["recentReports"]),
    includeMeetings
      ? db
          .select()
          .from(committeesCommitteemeeting)
          .where(eq(committeesCommitteemeeting.committeeId, committee.id))
          .orderBy(desc(committeesCommitteemeeting.date))
          .limit(5)
          .then((rows) =>
            rows.map((m) => ({
              id: m.id,
              number: m.number,
              date: formatDate(m.date),
            }))
          )
      : Promise.resolve([] as HydratedCommitteeInfo["recentMeetings"]),
  ]);

  const infoData = {
    committee: {
      id: committee.id,
      slug: committee.slug,
      nameEn: committee.nameEn,
      nameFr: committee.nameFr,
      shortNameEn: committee.shortNameEn,
      shortNameFr: committee.shortNameFr,
      parentId: committee.parentId,
    },
    recentReports,
    recentMeetings,
  };

  const markdown = formatCommitteeMarkdown(infoData, language);

  return {
    ...infoData,
    markdown,
    languageUsed: language,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Committee Report Hydrator
// ─────────────────────────────────────────────────────────────────────────────

export type HydratedCommitteeReport = {
  report: {
    id: number;
    number: number | null;
    nameEn: string;
    nameFr: string;
    sessionId: string;
    adoptedDate: string | null;
    presentedDate: string | null;
    governmentResponse: boolean;
  };
  committee: {
    id: number;
    slug: string;
    nameEn: string | null;
    nameFr: string | null;
  };
  markdown: string;
  languageUsed: Lang;
};

function formatCommitteeReportMarkdown(
  data: Omit<HydratedCommitteeReport, "markdown" | "languageUsed">,
  lang: Lang
): string {
  const lines: string[] = [];
  const name =
    (lang === "fr" ? data.report.nameFr : data.report.nameEn) ||
    data.report.nameEn;
  const committeeName =
    (lang === "fr" ? data.committee.nameFr : data.committee.nameEn) ||
    data.committee.nameEn ||
    "Unknown";

  if (data.report.number) {
    lines.push(
      `# ${lang === "fr" ? "Rapport" : "Report"} #${data.report.number}`
    );
  } else {
    lines.push(`# ${lang === "fr" ? "Rapport" : "Report"}`);
  }
  lines.push("");

  lines.push(`**${lang === "fr" ? "Titre" : "Title"}:** ${name}`);
  lines.push(`**${lang === "fr" ? "Comité" : "Committee"}:** ${committeeName}`);
  lines.push(`**Session:** ${data.report.sessionId}`);

  if (data.report.presentedDate) {
    lines.push(
      `**${lang === "fr" ? "Présenté" : "Presented"}:** ${data.report.presentedDate}`
    );
  }
  if (data.report.adoptedDate) {
    lines.push(
      `**${lang === "fr" ? "Adopté" : "Adopted"}:** ${data.report.adoptedDate}`
    );
  }
  if (data.report.governmentResponse) {
    lines.push(
      `**${lang === "fr" ? "Réponse du gouvernement" : "Government Response"}:** ${lang === "fr" ? "Oui" : "Yes"}`
    );
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Get hydrated committee report by ID
 */
export async function getHydratedCommitteeReport(args: {
  reportId: number;
  language: Lang;
}): Promise<HydratedCommitteeReport | null> {
  const { reportId, language } = args;
  const dbg = debugLib("rag:committee_report");
  const db = getDb();

  const rows = await db
    .select({
      report: committeesCommitteereport,
      committee: committeesCommittee,
    })
    .from(committeesCommitteereport)
    .innerJoin(
      committeesCommittee,
      eq(committeesCommitteereport.committeeId, committeesCommittee.id)
    )
    .where(eq(committeesCommitteereport.id, reportId))
    .limit(1);

  if (rows.length === 0) {
    dbg("Committee report not found: %d", reportId);
    return null;
  }

  const { report, committee } = rows[0];

  const data = {
    report: {
      id: report.id,
      number: report.number,
      nameEn: report.nameEn,
      nameFr: report.nameFr,
      sessionId: report.sessionId,
      adoptedDate: formatDate(report.adoptedDate),
      presentedDate: formatDate(report.presentedDate),
      governmentResponse: report.governmentResponse,
    },
    committee: {
      id: committee.id,
      slug: committee.slug,
      nameEn: committee.nameEn,
      nameFr: committee.nameFr,
    },
  };

  const markdown = formatCommitteeReportMarkdown(data, language);

  return {
    ...data,
    markdown,
    languageUsed: language,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Committee Meeting Hydrator
// ─────────────────────────────────────────────────────────────────────────────

export type HydratedCommitteeMeeting = {
  meeting: {
    id: number;
    number: number;
    date: string;
    startTime: string;
    endTime: string | null;
    sessionId: string;
    inCamera: boolean;
    travel: boolean;
    webcast: boolean;
    televised: boolean;
  };
  committee: {
    id: number;
    slug: string;
    nameEn: string | null;
    nameFr: string | null;
  };
  markdown: string;
  languageUsed: Lang;
};

function formatCommitteeMeetingMarkdown(
  data: Omit<HydratedCommitteeMeeting, "markdown" | "languageUsed">,
  lang: Lang
): string {
  const lines: string[] = [];
  const committeeName =
    (lang === "fr" ? data.committee.nameFr : data.committee.nameEn) ||
    data.committee.nameEn ||
    "Unknown";

  lines.push(
    `# ${lang === "fr" ? "Réunion" : "Meeting"} #${data.meeting.number} - ${data.meeting.date}`
  );
  lines.push("");

  lines.push(`**${lang === "fr" ? "Comité" : "Committee"}:** ${committeeName}`);
  lines.push(`**Session:** ${data.meeting.sessionId}`);
  lines.push(
    `**${lang === "fr" ? "Heure de début" : "Start Time"}:** ${data.meeting.startTime}`
  );
  if (data.meeting.endTime) {
    lines.push(
      `**${lang === "fr" ? "Heure de fin" : "End Time"}:** ${data.meeting.endTime}`
    );
  }

  const flags: string[] = [];
  if (data.meeting.inCamera) {
    flags.push(lang === "fr" ? "À huis clos" : "In Camera");
  }
  if (data.meeting.travel) {
    flags.push(lang === "fr" ? "Voyage" : "Travel");
  }
  if (data.meeting.webcast) {
    flags.push(lang === "fr" ? "Webdiffusion" : "Webcast");
  }
  if (data.meeting.televised) {
    flags.push(lang === "fr" ? "Télévisé" : "Televised");
  }

  if (flags.length > 0) {
    lines.push(
      `**${lang === "fr" ? "Format" : "Format"}:** ${flags.join(", ")}`
    );
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Get hydrated committee meeting by ID
 */
export async function getHydratedCommitteeMeeting(args: {
  meetingId: number;
  language: Lang;
}): Promise<HydratedCommitteeMeeting | null> {
  const { meetingId, language } = args;
  const dbg = debugLib("rag:committee_meeting");
  const db = getDb();

  const rows = await db
    .select({
      meeting: committeesCommitteemeeting,
      committee: committeesCommittee,
    })
    .from(committeesCommitteemeeting)
    .innerJoin(
      committeesCommittee,
      eq(committeesCommitteemeeting.committeeId, committeesCommittee.id)
    )
    .where(eq(committeesCommitteemeeting.id, meetingId))
    .limit(1);

  if (rows.length === 0) {
    dbg("Committee meeting not found: %d", meetingId);
    return null;
  }

  const { meeting, committee } = rows[0];

  const data = {
    meeting: {
      id: meeting.id,
      number: meeting.number,
      date: formatDate(meeting.date) || "",
      startTime: meeting.startTime,
      endTime: meeting.endTime || null,
      sessionId: meeting.sessionId,
      inCamera: meeting.inCamera,
      travel: meeting.travel,
      webcast: meeting.webcast,
      televised: meeting.televised,
    },
    committee: {
      id: committee.id,
      slug: committee.slug,
      nameEn: committee.nameEn,
      nameFr: committee.nameFr,
    },
  };

  const markdown = formatCommitteeMeetingMarkdown(data, language);

  return {
    ...data,
    markdown,
    languageUsed: language,
  };
}
