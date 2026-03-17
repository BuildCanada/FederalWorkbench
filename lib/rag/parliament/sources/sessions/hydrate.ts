import debugLib from "debug";
import { count, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/connection";
import { billsBill, coreSession } from "@/lib/db/parliament/schema";
import { formatOrdinal } from "@/lib/rag/parliament/search-utils";
import { formatDate, type Lang } from "@/lib/rag/parliament/types";

/**
 * Hydrated session with overview
 */
export type HydratedSessionOverview = {
  session: {
    id: string;
    parliamentnum: number | null;
    sessnum: number | null;
    name: string | null;
    start: string | null;
    end: string | null;
  };
  billCount: number;
  markdown: string;
  languageUsed: Lang;
};

/**
 * Format a session overview as readable markdown
 */
export function formatSessionMarkdown(
  overview: Omit<HydratedSessionOverview, "markdown" | "languageUsed">,
  lang: Lang
): string {
  const lines: string[] = [];

  const parlOrd =
    overview.session.parliamentnum != null
      ? formatOrdinal(overview.session.parliamentnum)
      : "?";
  const sessOrd =
    overview.session.sessnum != null
      ? formatOrdinal(overview.session.sessnum)
      : "?";
  const title =
    lang === "fr"
      ? `${parlOrd} Parlement, ${sessOrd} Session`
      : `${parlOrd} Parliament, ${sessOrd} Session`;

  lines.push(`# ${title}`);
  lines.push("");

  if (overview.session.name) {
    lines.push(
      `**${lang === "fr" ? "Nom" : "Name"}:** ${overview.session.name}`
    );
  }
  lines.push(`**ID:** ${overview.session.id}`);

  if (overview.session.start) {
    lines.push(
      `**${lang === "fr" ? "Début" : "Start"}:** ${overview.session.start}`
    );
  }
  if (overview.session.end) {
    lines.push(`**${lang === "fr" ? "Fin" : "End"}:** ${overview.session.end}`);
  }

  lines.push(
    `**${lang === "fr" ? "Projets de loi" : "Bills"}:** ${overview.billCount}`
  );
  lines.push("");

  return lines.join("\n");
}

/**
 * Get hydrated session overview from the Parliament database
 */
export async function getHydratedSessionOverview(args: {
  sessionId: string;
  language: Lang;
}): Promise<HydratedSessionOverview | null> {
  const { sessionId, language } = args;
  const dbg = debugLib("rag:session");
  const db = getDb();

  // Fetch session
  const sessionRows = await db
    .select()
    .from(coreSession)
    .where(eq(coreSession.id, sessionId))
    .limit(1);

  if (sessionRows.length === 0) {
    dbg("Session not found: %s", sessionId);
    return null;
  }

  const session = sessionRows[0];

  // Count bills in this session
  const billCountResult = await db
    .select({ count: count() })
    .from(billsBill)
    .where(eq(billsBill.sessionId, sessionId));

  const billCount = billCountResult[0]?.count || 0;

  const overviewData = {
    session: {
      id: session.id,
      parliamentnum: session.parliamentnum,
      sessnum: session.sessnum,
      name: session.name,
      start: formatDate(session.start),
      end: formatDate(session.end),
    },
    billCount,
  };

  const markdown = formatSessionMarkdown(overviewData, language);

  return {
    ...overviewData,
    markdown,
    languageUsed: language,
  };
}
