import debugLib from "debug";
import { and, count, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/connection";
import {
  type CoreParty,
  coreElectedmember,
  coreParty,
} from "@/lib/db/parliament/schema";
import type { Lang } from "@/lib/rag/parliament/types";

/**
 * Hydrated party with full context
 */
export type HydratedPartyInfo = {
  party: {
    id: number;
    slug: string;
    nameEn: string | null;
    nameFr: string | null;
    shortNameEn: string | null;
    shortNameFr: string | null;
  };
  memberCount: number;
  markdown: string;
  languageUsed: Lang;
};

/**
 * Format a party as readable markdown
 */
export function formatPartyMarkdown(
  info: Omit<HydratedPartyInfo, "markdown" | "languageUsed">,
  lang: Lang
): string {
  const lines: string[] = [];
  const name =
    (lang === "fr" ? info.party.nameFr : info.party.nameEn) ||
    info.party.nameEn ||
    "Unknown Party";
  const shortName =
    (lang === "fr" ? info.party.shortNameFr : info.party.shortNameEn) ||
    info.party.shortNameEn;

  lines.push(`# ${name}`);
  lines.push("");

  if (shortName) {
    lines.push(`**${lang === "fr" ? "Acronyme" : "Acronym"}:** ${shortName}`);
  }
  lines.push(
    `**${lang === "fr" ? "Membres actuels" : "Current Members"}:** ${info.memberCount}`
  );
  lines.push("");

  return lines.join("\n");
}

/**
 * Get hydrated party info from the Parliament database
 */
export async function getHydratedPartyInfo(args: {
  partyId?: number;
  slug?: string;
  language: Lang;
}): Promise<HydratedPartyInfo | null> {
  const { partyId, slug, language } = args;
  const dbg = debugLib("rag:party");
  const db = getDb();

  // Fetch party
  let partyRows: CoreParty[];
  if (partyId) {
    partyRows = await db
      .select()
      .from(coreParty)
      .where(eq(coreParty.id, partyId))
      .limit(1);
  } else if (slug) {
    partyRows = await db
      .select()
      .from(coreParty)
      .where(eq(coreParty.slug, slug))
      .limit(1);
  } else {
    return null;
  }

  if (partyRows.length === 0) {
    dbg("Party not found: %s", partyId || slug);
    return null;
  }

  const party = partyRows[0];

  // Count current members (those without end date)
  const memberCountResult = await db
    .select({ count: count() })
    .from(coreElectedmember)
    .where(
      and(
        eq(coreElectedmember.partyId, party.id),
        isNull(coreElectedmember.endDate)
      )
    );

  const memberCount = memberCountResult[0]?.count || 0;

  const infoData = {
    party: {
      id: party.id,
      slug: party.slug,
      nameEn: party.nameEn,
      nameFr: party.nameFr,
      shortNameEn: party.shortNameEn,
      shortNameFr: party.shortNameFr,
    },
    memberCount,
  };

  const markdown = formatPartyMarkdown(infoData, language);

  return {
    ...infoData,
    markdown,
    languageUsed: language,
  };
}
