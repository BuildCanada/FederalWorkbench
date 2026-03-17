import debugLib from "debug";
import { eq } from "drizzle-orm";
import TurndownService from "turndown";
import { getDb } from "@/lib/db/connection";
import {
  corePolitician,
  hansardsDocument,
  hansardsStatement,
} from "@/lib/db/parliament/schema";
import { formatDate, formatTime, type Lang } from "@/lib/rag/parliament/types";

/** Shared turndown instance for HTML-to-markdown conversion */
const turndown = new TurndownService();

/**
 * Hydrated Hansard statement with full context
 */
export type HydratedHansardStatement = {
  statement: {
    id: number;
    sequence: number;
    contentEn: string | null;
    contentFr: string | null;
    time: Date | null;
    procedural: boolean;
  };
  document: {
    id: number;
    date: Date | null;
    number: string;
    sessionId: string;
  };
  speaker: {
    id: number;
    name: string;
    slug: string;
  } | null;
  markdown: string;
  languageUsed: Lang;
};

/**
 * Format a Hansard statement as readable markdown
 */
export function formatHansardMarkdown(
  statement: HydratedHansardStatement["statement"],
  document: HydratedHansardStatement["document"],
  speaker: HydratedHansardStatement["speaker"],
  lang: Lang
): string {
  const lines: string[] = [];

  // Header
  const dateStr = document.date ? formatDate(document.date) : "Unknown Date";
  lines.push(`# Hansard - ${dateStr}`);
  lines.push("");

  // Metadata
  lines.push(`**Session:** ${document.sessionId}`);
  lines.push(`**Document:** ${document.number}`);
  if (speaker) {
    lines.push(`**Speaker:** ${speaker.name}`);
  }
  if (statement.time) {
    const timeStr = formatTime(statement.time);
    if (timeStr) {
      lines.push(`**Time:** ${timeStr}`);
    }
  }
  if (statement.procedural) {
    lines.push(`**Type:** ${lang === "fr" ? "Procédure" : "Procedural"}`);
  }
  lines.push("");

  // Content (convert HTML to markdown)
  lines.push("---");
  lines.push("");
  const rawContent =
    lang === "fr"
      ? statement.contentFr || statement.contentEn
      : statement.contentEn || statement.contentFr;
  const content = rawContent
    ? turndown.turndown(rawContent)
    : "(No content available)";
  lines.push(content);

  return lines.join("\n");
}

/**
 * Get hydrated Hansard statement from the Parliament database
 *
 * Fetches the full statement with speaker and document context.
 *
 * @param args - Statement identification and language preference
 * @returns Hydrated Hansard statement with markdown content
 */
export async function getHydratedHansardStatement(args: {
  statementId: number;
  language: Lang;
}): Promise<HydratedHansardStatement | null> {
  const { statementId, language } = args;
  const dbg = debugLib("rag:hansard");
  const db = getDb();

  // Fetch the statement with document info
  const rows = await db
    .select({
      statement: hansardsStatement,
      document: hansardsDocument,
    })
    .from(hansardsStatement)
    .innerJoin(
      hansardsDocument,
      eq(hansardsStatement.documentId, hansardsDocument.id)
    )
    .where(eq(hansardsStatement.id, statementId))
    .limit(1);

  if (rows.length === 0) {
    dbg("Statement not found: %d", statementId);
    return null;
  }

  const { statement, document } = rows[0];

  // Fetch speaker if available
  let speaker: HydratedHansardStatement["speaker"] = null;
  if (statement.politicianId) {
    const politicianRows = await db
      .select()
      .from(corePolitician)
      .where(eq(corePolitician.id, statement.politicianId))
      .limit(1);

    if (politicianRows.length > 0) {
      const pol = politicianRows[0];
      speaker = {
        id: pol.id,
        name: pol.name,
        slug: pol.slug,
      };
    }
  }

  const statementData = {
    id: statement.id,
    sequence: statement.sequence,
    contentEn: statement.contentEn,
    contentFr: statement.contentFr,
    time: statement.time,
    procedural: statement.procedural ?? false,
  };

  const documentData = {
    id: document.id,
    date: document.date,
    number: document.number,
    sessionId: document.sessionId,
  };

  const markdown = formatHansardMarkdown(
    statementData,
    documentData,
    speaker,
    language
  );

  return {
    statement: statementData,
    document: documentData,
    speaker,
    markdown,
    languageUsed: language,
  };
}
