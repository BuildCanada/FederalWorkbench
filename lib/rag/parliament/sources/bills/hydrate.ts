import { generateText } from "ai";
import debugLib from "debug";
import { and, eq } from "drizzle-orm";
import { myProvider } from "@/lib/ai/providers";
import { cacheGet, cacheSet } from "@/lib/cache/redis";
import { getDb } from "@/lib/db/connection";
import {
  type BillsBill,
  billsBill,
  billsBilltext,
  coreSession,
} from "@/lib/db/parliament/schema";
import { formatDate, type Lang } from "@/lib/rag/parliament/types";
import { isRagCacheDisabled } from "@/lib/rag/shared/constants";

// Regex constants for bill markdown formatting (top-level for performance)
const REGEX_PART_HEADING = /^PART\s+(\d+)(?:\s+(.+))?$/;
const REGEX_SUBSECTION_HEADING =
  /^(Short Title|Definitions|Enactment(?: of Act)?)\b/i;
const REGEX_ENUMERATION = /\([a-z]\)/;
const REGEX_ENUMERATION_SPLIT = /\s(?=\([a-z]\)\s)/g;
const REGEX_ENUMERATION_REPLACE = /^\(([a-z])\)\s*/;
const REGEX_ROMAN_NUMERAL = /\([ivx]+\)/i;
const REGEX_ROMAN_NUMERAL_SPLIT = /\s(?=\([ivx]+\)\s)/i;
const REGEX_ROMAN_NUMERAL_REPLACE = /^\(([ivx]+)\)\s*/i;
const REGEX_DEFINITION_MATCH = /^([A-Za-z][A-Za-z -]{1,60})\s+means\s+(.+)$/;
const REGEX_TOC_HEADING_PREFIX = /^##\s+/;

export type HydratedBillMarkdown = {
  markdown: string;
  bill: BillsBill;
  languageUsed: Lang; // the language of the body text actually used
  note?: string; // e.g. "French text not available; using English"
};

function institutionName(inst: string | null, lang: Lang): string | undefined {
  if (!inst) {
    return;
  }
  if (inst === "C") {
    return lang === "fr" ? "Chambre des communes" : "House of Commons";
  }
  if (inst === "S") {
    return lang === "fr" ? "Sénat" : "Senate";
  }
  return;
}

function yesNo(val: boolean | null, lang: Lang): string | undefined {
  if (val == null) {
    return;
  }
  return lang === "fr" ? (val ? "Oui" : "Non") : val ? "Yes" : "No";
}

/**
 * Heuristic markdown formatter for OpenParliament bill texts.
 * Keeps it deterministic (no LLM), focuses on readability: headings, sections, lists.
 */
export function formatBillMarkdown(
  bill: BillsBill,
  bodyText: string,
  lang: Lang,
  opts?: { includeToc?: boolean }
): string {
  const includeToc = opts?.includeToc ?? true;

  const title = lang === "fr" ? bill.nameFr : bill.nameEn;
  const inst = institutionName(bill.institution, lang);
  const introduced = formatDate(bill.introduced);
  const statusDate = formatDate(bill.statusDate);
  const becameLaw = yesNo(bill.law, lang);
  const privateMember =
    bill.privatemember == null
      ? undefined
      : lang === "fr"
        ? bill.privatemember
          ? "Projet de loi d'initiative parlementaire"
          : "Projet de loi du gouvernement"
        : bill.privatemember
          ? "Private Member's Bill"
          : "Government Bill";

  const metaLines: string[] = [];
  metaLines.push(
    `- ${lang === "fr" ? "Session" : "Session"}: ${bill.sessionId}`
  );
  if (inst) {
    metaLines.push(
      `- ${lang === "fr" ? "Institution" : "Institution"}: ${inst}`
    );
  }
  if (introduced) {
    metaLines.push(
      `- ${lang === "fr" ? "Présenté" : "Introduced"}: ${introduced}`
    );
  }
  if (statusDate) {
    metaLines.push(
      `- ${lang === "fr" ? "Date du statut" : "Status Date"}: ${statusDate}`
    );
  }
  if (bill.statusCode) {
    metaLines.push(
      `- ${lang === "fr" ? "Statut" : "Status"}: ${bill.statusCode}`
    );
  }
  if (becameLaw) {
    metaLines.push(
      `- ${lang === "fr" ? "Devenu loi" : "Became Law"}: ${becameLaw}`
    );
  }
  if (privateMember) {
    metaLines.push(`- ${lang === "fr" ? "Type" : "Type"}: ${privateMember}`);
  }

  // Normalize body text spacing and line breaks before we inject markdown.
  let text = bodyText
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ") // NBSP to space
    .replace(/[ \t]{2,}/g, " ") // collapse runs of spaces
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Insert line breaks before common section markers to make them stand out.
  text = text
    // PART N headings
    .replace(/\s+(PART\s+\d+(?:\s+[A-Z][A-Za-z0-9 ,''()-]+)?)/g, "\n\n$1")
    // Short Title / Definitions / Enactment markers
    .replace(/\s+(Short Title)\b/g, "\n\n$1")
    .replace(/\s+(Definitions)\b/g, "\n\n$1")
    .replace(/\s+(Enactment(?: of Act)?)\b/g, "\n\n$1")
    // Clause numbers at start, e.g., "1 (1) ..."
    .replace(/\s+(\d+\s*\(\d+\)\s+)/g, "\n\n$1")
    .replace(/\n{3,}/g, "\n\n");

  const lines = text.split("\n");
  const out: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      out.push("");
      continue;
    }

    // PART heading → ##
    const mPart = line.match(REGEX_PART_HEADING);
    if (mPart) {
      const partNum = mPart[1];
      const partTitle = mPart[2] ? mPart[2].trim() : "";
      out.push(`## Part ${partNum}${partTitle ? ` — ${partTitle}` : ""}`);
      continue;
    }

    // Subsection heading keywords → ###
    if (REGEX_SUBSECTION_HEADING.test(line)) {
      // Title case the known headings
      const heading = line.replace(/\s+/g, " ").trim();
      out.push(`### ${heading}`);
      continue;
    }

    // Enumerations: break inline lists into markdown bullets
    // (a) ... (b) ...
    if (REGEX_ENUMERATION.test(line)) {
      // Split on occurrences like " (a) " while keeping the marker
      const parts = line.split(REGEX_ENUMERATION_SPLIT);
      if (parts.length > 1) {
        for (const p of parts) {
          const li = p.replace(
            REGEX_ENUMERATION_REPLACE,
            (_, g1) => `- (${g1}) `
          );
          out.push(li);
        }
        continue;
      }
    }

    // Nested roman numerals: (i), (ii) → indented list
    if (REGEX_ROMAN_NUMERAL.test(line)) {
      const parts = line.split(REGEX_ROMAN_NUMERAL_SPLIT);
      if (parts.length > 1) {
        for (const p of parts) {
          const li = p.replace(
            REGEX_ROMAN_NUMERAL_REPLACE,
            (_, g1) => `  - (${g1}) `
          );
          out.push(li);
        }
        continue;
      }
    }

    // Definitions block: "term means ..." → bold term — definition
    // Heuristic: term (few words) + ' means ' present
    const defMatch = line.match(REGEX_DEFINITION_MATCH);
    if (defMatch) {
      const term = defMatch[1].trim();
      const defn = defMatch[2].trim();
      out.push(`- **${term}** — ${defn}`);
      continue;
    }

    out.push(line);
  }

  // Optional table of contents (very lightweight: collect ## and ###)
  let toc = "";
  if (includeToc) {
    const headings = out.filter((l) => l.startsWith("## "));
    if (headings.length > 0) {
      toc = [
        "\n## Table of Contents",
        ...headings.map((h) => `- ${h.replace(REGEX_TOC_HEADING_PREFIX, "")}`),
      ].join("\n");
    }
  }

  const headerTitle = `# Bill ${bill.number}: ${title || ""}`.trim();
  const meta = metaLines.join("\n");
  return [headerTitle, "", meta, toc, "", out.join("\n")]
    .filter(Boolean)
    .join("\n");
}

/**
 * Get hydrated bill markdown from the Parliament database
 *
 * Fetches the full bill text and formats it as readable markdown.
 * Includes automatic language fallback and optional translation.
 *
 * @param args - Bill identification and language preference
 * @returns Hydrated bill with markdown content
 */
export async function getHydratedBillMarkdown(args: {
  billNumber: string;
  parliament: number; // required disambiguator (e.g., 44)
  session: number; // required session within parliament (e.g., 1)
  language: Lang;
}): Promise<HydratedBillMarkdown> {
  const { billNumber, parliament, session, language } = args;
  const dbg = debugLib("rag:bill");
  const db = getDb();

  // Fetch candidates by number within the specified parliament (optionally session)
  const rows = await db
    .select({ bill: billsBill, sess: coreSession })
    .from(billsBill)
    .innerJoin(coreSession, eq(billsBill.sessionId, coreSession.id))
    .where(
      and(
        eq(billsBill.number, billNumber),
        eq(coreSession.parliamentnum, parliament),
        eq(coreSession.sessnum, session)
      )
    );

  if (rows.length === 0) {
    throw new Error(
      `Bill ${billNumber} not found in ${parliament}th Parliament, session ${session}`
    );
  }
  const bill = rows[0].bill;

  const texts = await db
    .select()
    .from(billsBilltext)
    .where(eq(billsBilltext.billId, bill.id))
    .limit(1);
  if (texts.length === 0) {
    throw new Error(
      `No billtext found for bill ${billNumber} (${bill.sessionId})`
    );
  }

  const t = texts[0];
  const en = t.textEn || "";
  const fr = t.textFr || "";

  let languageUsed: Lang = language;
  let note: string | undefined;
  let body = language === "fr" ? fr : en;

  if (!body || body.trim().length === 0) {
    // Fallback to the other language if available
    if (language === "fr" && en.trim().length > 0) {
      body = en;
      languageUsed = "en";
      note = "French text not available; using English source text.";
    } else if (language === "en" && fr.trim().length > 0) {
      body = fr;
      languageUsed = "fr";
      note = "English text not available; using French source text.";
    } else {
      throw new Error(
        `No body text available for bill ${bill.number} (${bill.sessionId})`
      );
    }
  }

  // Optional translation fallback with cache when requested language differs from available
  if (languageUsed !== language) {
    const cacheDisabled = isRagCacheDisabled();
    const cacheKey = `bill-md-body:${bill.number}:${parliament}:${session}:${language}`;
    const cached = cacheDisabled ? null : await cacheGet(cacheKey);
    if (cached) {
      dbg("cache hit %s", cacheKey);
      body = cached;
      languageUsed = language;
      note = note ? `${note} (translated)` : "Translated from source language.";
    } else {
      try {
        const model = myProvider.languageModel("chat-model");
        const { text } = await generateText({
          model,
          system:
            "Translate the following Markdown to the target language while preserving headings, lists, and formatting. Do not add commentary.",
          prompt: `Target language: ${language === "fr" ? "French" : "English"}\n\n---\n${body}`,
        });
        const translated = text.trim();
        if (translated) {
          body = translated;
          languageUsed = language;
          note = note
            ? `${note} (translated)`
            : "Translated from source language.";
          if (!cacheDisabled) {
            await cacheSet(cacheKey, body, 60 * 60 * 24 * 14); // 14 days
          }
        }
      } catch {
        // best-effort; keep original body
      }
    }
  }

  const markdown = formatBillMarkdown(bill, body, languageUsed, {
    includeToc: true,
  });
  return { markdown, bill, languageUsed, note };
}
