import debugLib from "debug";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/connection";
import {
  type CorePolitician,
  coreElectedmember,
  coreParty,
  corePolitician,
  coreRiding,
} from "@/lib/db/parliament/schema";
import { formatDate, type Lang } from "@/lib/rag/parliament/types";

/**
 * Hydrated politician profile with full context
 */
export type HydratedPoliticianProfile = {
  politician: {
    id: number;
    name: string;
    slug: string;
    gender?: string;
  };
  /** Whether the politician is currently serving (has a role with no end date) */
  isCurrentlyServing: boolean;
  /** Current role - only set if isCurrentlyServing is true */
  currentRole?: {
    partyId: number;
    partyName: string;
    partyShort: string;
    ridingId: number;
    ridingName: string;
    province: string;
    startDate?: string;
  };
  /** Most recent role - only set if isCurrentlyServing is false (former MP) */
  lastRole?: {
    partyId: number;
    partyName: string;
    partyShort: string;
    ridingId: number;
    ridingName: string;
    province: string;
    startDate?: string;
    endDate?: string;
  };
  previousRoles: Array<{
    partyName: string;
    ridingName: string;
    startDate?: string;
    endDate?: string;
  }>;
  markdown: string;
  languageUsed: Lang;
};

/**
 * Format a politician profile as readable markdown
 */
export function formatPoliticianMarkdown(
  profile: Omit<HydratedPoliticianProfile, "markdown" | "languageUsed">,
  lang: Lang
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${profile.politician.name}`);
  lines.push("");

  // Status indicator for former MPs
  if (!profile.isCurrentlyServing) {
    lines.push(
      `**${lang === "fr" ? "Statut" : "Status"}:** ${lang === "fr" ? "Ancien député" : "Former MP"}`
    );
    lines.push("");
  }

  // Current role (only for currently serving MPs)
  if (profile.currentRole) {
    lines.push(`## ${lang === "fr" ? "Rôle actuel" : "Current Role"}`);
    lines.push(
      `**${lang === "fr" ? "Parti" : "Party"}:** ${profile.currentRole.partyName} (${profile.currentRole.partyShort})`
    );
    lines.push(
      `**${lang === "fr" ? "Circonscription" : "Riding"}:** ${profile.currentRole.ridingName}`
    );
    lines.push(
      `**${lang === "fr" ? "Province" : "Province"}:** ${profile.currentRole.province}`
    );
    if (profile.currentRole.startDate) {
      lines.push(
        `**${lang === "fr" ? "Depuis" : "Since"}:** ${profile.currentRole.startDate}`
      );
    }
    lines.push("");
  }

  // Last role (only for former MPs)
  if (profile.lastRole) {
    lines.push(`## ${lang === "fr" ? "Dernier rôle" : "Last Role"}`);
    lines.push(
      `**${lang === "fr" ? "Parti" : "Party"}:** ${profile.lastRole.partyName} (${profile.lastRole.partyShort})`
    );
    lines.push(
      `**${lang === "fr" ? "Circonscription" : "Riding"}:** ${profile.lastRole.ridingName}`
    );
    lines.push(
      `**${lang === "fr" ? "Province" : "Province"}:** ${profile.lastRole.province}`
    );
    if (profile.lastRole.startDate) {
      lines.push(
        `**${lang === "fr" ? "Début" : "Start"}:** ${profile.lastRole.startDate}`
      );
    }
    if (profile.lastRole.endDate) {
      lines.push(
        `**${lang === "fr" ? "Fin" : "End"}:** ${profile.lastRole.endDate}`
      );
    }
    lines.push("");
  }

  // Previous roles
  if (profile.previousRoles.length > 0) {
    lines.push(`## ${lang === "fr" ? "Rôles précédents" : "Previous Roles"}`);
    for (const role of profile.previousRoles) {
      const dates =
        role.startDate && role.endDate
          ? `${role.startDate} - ${role.endDate}`
          : role.startDate || "";
      lines.push(
        `- ${role.partyName}, ${role.ridingName} ${dates ? `(${dates})` : ""}`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get hydrated politician profile from the Parliament database
 *
 * Fetches the full politician profile with party and riding information.
 *
 * @param args - Politician identification and language preference
 * @returns Hydrated politician profile with markdown content
 */
export async function getHydratedPoliticianProfile(args: {
  politicianId?: number;
  slug?: string;
  language: Lang;
}): Promise<HydratedPoliticianProfile | null> {
  const { politicianId, slug, language } = args;
  const dbg = debugLib("rag:politician");
  const db = getDb();

  // Fetch politician
  let politicianRows: CorePolitician[];
  if (politicianId) {
    politicianRows = await db
      .select()
      .from(corePolitician)
      .where(eq(corePolitician.id, politicianId))
      .limit(1);
  } else if (slug) {
    politicianRows = await db
      .select()
      .from(corePolitician)
      .where(eq(corePolitician.slug, slug))
      .limit(1);
  } else {
    return null;
  }

  if (politicianRows.length === 0) {
    dbg("Politician not found: %s", politicianId || slug);
    return null;
  }

  const politician = politicianRows[0];

  // Fetch elected member records (current and past roles)
  const electedRecords = await db
    .select({
      member: coreElectedmember,
      party: coreParty,
      riding: coreRiding,
    })
    .from(coreElectedmember)
    .leftJoin(coreParty, eq(coreElectedmember.partyId, coreParty.id))
    .leftJoin(coreRiding, eq(coreElectedmember.ridingId, coreRiding.id))
    .where(eq(coreElectedmember.politicianId, politician.id))
    .orderBy(desc(coreElectedmember.startDate));

  // Find the current role (record with no end date) - only exists if actively serving
  const currentRecord = electedRecords.find((r) => !r.member.endDate);
  const isCurrentlyServing = !!currentRecord;

  // For former MPs, get their most recent role (first in the list, ordered by startDate desc)
  const lastRecord = isCurrentlyServing ? undefined : electedRecords[0];

  // Previous roles are all other records (excluding current or last)
  const previousRecords = electedRecords.filter(
    (r) => r !== currentRecord && r !== lastRecord
  );

  // Helper to build role object from a record
  const buildRoleData = (record: (typeof electedRecords)[0]) => ({
    partyId: record.party?.id || 0,
    partyName:
      (language === "fr" ? record.party?.nameFr : record.party?.nameEn) ||
      record.party?.nameEn ||
      "Unknown",
    partyShort:
      (language === "fr"
        ? record.party?.shortNameFr
        : record.party?.shortNameEn) ||
      record.party?.shortNameEn ||
      "?",
    ridingId: record.riding?.id || 0,
    ridingName:
      (language === "fr" ? record.riding?.nameFr : record.riding?.nameEn) ||
      record.riding?.nameEn ||
      "Unknown",
    province: record.riding?.province || "",
    startDate: formatDate(record.member.startDate) || undefined,
    endDate: formatDate(record.member.endDate) || undefined,
  });

  // Current role (only for currently serving MPs)
  const currentRole = currentRecord ? buildRoleData(currentRecord) : undefined;

  // Last role (only for former MPs)
  const lastRole = lastRecord ? buildRoleData(lastRecord) : undefined;

  const previousRoles = previousRecords.map((r) => ({
    partyName:
      (language === "fr" ? r.party?.nameFr : r.party?.nameEn) ||
      r.party?.nameEn ||
      "Unknown",
    ridingName:
      (language === "fr" ? r.riding?.nameFr : r.riding?.nameEn) ||
      r.riding?.nameEn ||
      "Unknown",
    startDate: formatDate(r.member.startDate) || undefined,
    endDate: formatDate(r.member.endDate) || undefined,
  }));

  const profileData = {
    politician: {
      id: politician.id,
      name: politician.name,
      slug: politician.slug,
      gender: politician.gender || undefined,
    },
    isCurrentlyServing,
    currentRole,
    lastRole,
    previousRoles,
  };

  const markdown = formatPoliticianMarkdown(profileData, language);

  return {
    ...profileData,
    markdown,
    languageUsed: language,
  };
}
