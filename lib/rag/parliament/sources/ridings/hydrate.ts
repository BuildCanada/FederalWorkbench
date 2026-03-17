import debugLib from "debug";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/connection";
import {
  type CoreRiding,
  coreElectedmember,
  coreParty,
  corePolitician,
  coreRiding,
} from "@/lib/db/parliament/schema";
import { formatDate, type Lang } from "@/lib/rag/parliament/types";

/**
 * Hydrated riding with current and past MPs
 */
export type HydratedRidingInfo = {
  riding: {
    id: number;
    slug: string;
    nameEn: string | null;
    nameFr: string | null;
    province: string;
  };
  currentMember?: {
    politicianId: number;
    politicianName: string;
    politicianSlug: string;
    partyName: string;
    partyShort: string;
    startDate: string | null;
  };
  previousMembers: Array<{
    politicianName: string;
    partyName: string;
    startDate: string | null;
    endDate: string | null;
  }>;
  markdown: string;
  languageUsed: Lang;
};

/**
 * Format a riding as readable markdown
 */
export function formatRidingMarkdown(
  info: Omit<HydratedRidingInfo, "markdown" | "languageUsed">,
  lang: Lang
): string {
  const lines: string[] = [];

  const name =
    (lang === "fr" ? info.riding.nameFr : info.riding.nameEn) ||
    info.riding.nameEn ||
    "Unknown Riding";

  lines.push(`# ${name}`);
  lines.push("");
  lines.push(
    `**${lang === "fr" ? "Province" : "Province"}:** ${info.riding.province}`
  );
  lines.push("");

  // Current MP
  if (info.currentMember) {
    lines.push(`## ${lang === "fr" ? "Député actuel" : "Current MP"}`);
    lines.push(`**${info.currentMember.politicianName}**`);
    lines.push(
      `${lang === "fr" ? "Parti" : "Party"}: ${info.currentMember.partyName} (${info.currentMember.partyShort})`
    );
    if (info.currentMember.startDate) {
      lines.push(
        `${lang === "fr" ? "Depuis" : "Since"}: ${info.currentMember.startDate}`
      );
    }
    lines.push("");
  }

  // Previous MPs
  if (info.previousMembers.length > 0) {
    lines.push(`## ${lang === "fr" ? "Députés précédents" : "Previous MPs"}`);
    for (const member of info.previousMembers.slice(0, 5)) {
      const dates =
        member.startDate && member.endDate
          ? `${member.startDate} - ${member.endDate}`
          : "";
      lines.push(
        `- ${member.politicianName} (${member.partyName})${dates ? ` [${dates}]` : ""}`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get hydrated riding info from the Parliament database
 */
export async function getHydratedRidingInfo(args: {
  ridingId?: number;
  slug?: string;
  language: Lang;
}): Promise<HydratedRidingInfo | null> {
  const { ridingId, slug, language } = args;
  const dbg = debugLib("rag:riding");
  const db = getDb();

  // Fetch riding
  let ridingRows: CoreRiding[];
  if (ridingId) {
    ridingRows = await db
      .select()
      .from(coreRiding)
      .where(eq(coreRiding.id, ridingId))
      .limit(1);
  } else if (slug) {
    ridingRows = await db
      .select()
      .from(coreRiding)
      .where(eq(coreRiding.slug, slug))
      .limit(1);
  } else {
    return null;
  }

  if (ridingRows.length === 0) {
    dbg("Riding not found: %s", ridingId || slug);
    return null;
  }

  const riding = ridingRows[0];

  // Fetch elected members for this riding
  const memberRows = await db
    .select({
      member: coreElectedmember,
      politician: corePolitician,
      party: coreParty,
    })
    .from(coreElectedmember)
    .leftJoin(
      corePolitician,
      eq(coreElectedmember.politicianId, corePolitician.id)
    )
    .leftJoin(coreParty, eq(coreElectedmember.partyId, coreParty.id))
    .where(eq(coreElectedmember.ridingId, riding.id))
    .orderBy(desc(coreElectedmember.startDate));

  // Find current member (no end date) and previous members
  const currentRow = memberRows.find((r) => !r.member.endDate);
  const previousRows = memberRows.filter((r) => r !== currentRow);

  const currentMember = currentRow?.politician
    ? {
        politicianId: currentRow.politician.id,
        politicianName: currentRow.politician.name,
        politicianSlug: currentRow.politician.slug,
        partyName:
          (language === "fr"
            ? currentRow.party?.nameFr
            : currentRow.party?.nameEn) ||
          currentRow.party?.nameEn ||
          "Unknown",
        partyShort:
          (language === "fr"
            ? currentRow.party?.shortNameFr
            : currentRow.party?.shortNameEn) ||
          currentRow.party?.shortNameEn ||
          "?",
        startDate: formatDate(currentRow.member.startDate),
      }
    : undefined;

  const previousMembers = previousRows.map((r) => ({
    politicianName: r.politician?.name || "Unknown",
    partyName:
      (language === "fr" ? r.party?.nameFr : r.party?.nameEn) ||
      r.party?.nameEn ||
      "Unknown",
    startDate: formatDate(r.member.startDate),
    endDate: formatDate(r.member.endDate),
  }));

  const infoData = {
    riding: {
      id: riding.id,
      slug: riding.slug,
      nameEn: riding.nameEn,
      nameFr: riding.nameFr,
      province: riding.province,
    },
    currentMember,
    previousMembers,
  };

  const markdown = formatRidingMarkdown(infoData, language);

  return {
    ...infoData,
    markdown,
    languageUsed: language,
  };
}
