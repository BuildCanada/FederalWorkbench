/**
 * Act processing for legislation embeddings
 *
 * Processes acts and their sections, generating metadata chunks and content embeddings.
 * Uses streaming/batching to avoid loading all data into memory.
 */

import { asc, count, inArray } from "drizzle-orm";

import { type Act, acts, sections } from "@/lib/db/legislation/schema";
import {
  type ChunkSectionOptions,
  chunkSection,
  shouldSkipSection,
} from "@/lib/rag/legislation/chunking";

import {
  buildPairedResourceKey,
  buildResourceKey,
  type ChunkData,
  DB_FETCH_BATCH_SIZE,
  ensureProgressSynced,
  filterNewChunks,
  insertChunksBatched,
  logProgress,
  type ProcessError,
  type ProcessOptions,
  type ProcessResult,
  validateLanguage,
} from "./utilities";

/**
 * Build bilingual metadata text for an act.
 */
export function buildActMetadataText(act: Act): string {
  const parts: string[] = [];
  const lang = validateLanguage(act.language);

  if (lang === "fr") {
    parts.push(`Loi: ${act.title}`);
    if (act.longTitle) {
      parts.push(`Titre complet: ${act.longTitle}`);
    }
    if (act.runningHead) {
      parts.push(`Titre abrégé: ${act.runningHead}`);
    }
    if (act.shortTitleStatus) {
      const statusText =
        act.shortTitleStatus === "official" ? "officiel" : "non officiel";
      parts.push(`Statut du titre abrégé: ${statusText}`);
    }
    if (act.reversedShortTitle) {
      parts.push(`Index alphabétique: ${act.reversedShortTitle}`);
    }
    parts.push(`Identifiant: ${act.actId}`);
    parts.push(`Statut: ${act.status}`);
    if (act.inForceDate) {
      parts.push(`En vigueur: ${act.inForceDate}`);
    }
    if (act.enactedDate) {
      parts.push(`Sanctionnée: ${act.enactedDate}`);
    }
    if (act.lastAmendedDate) {
      parts.push(`Dernière modification: ${act.lastAmendedDate}`);
    }
    if (act.consolidationDate) {
      parts.push(`Consolidation: ${act.consolidationDate}`);
    }
    if (act.billOrigin) {
      const origin =
        act.billOrigin === "commons" ? "Chambre des communes" : "Sénat";
      parts.push(`Origine: ${origin}`);
    }
    if (act.billType) {
      parts.push(`Type de projet de loi: ${act.billType}`);
    }
    if (act.consolidatedNumber) {
      parts.push(`Numéro de consolidation: ${act.consolidatedNumber}`);
    }
    if (act.consolidatedNumberOfficial) {
      const officialText =
        act.consolidatedNumberOfficial === "yes" ? "oui" : "non";
      parts.push(`Numéro de consolidation officiel: ${officialText}`);
    }
    if (act.annualStatuteYear && act.annualStatuteChapter) {
      parts.push(
        `Lois annuelles: ${act.annualStatuteYear}, ch. ${act.annualStatuteChapter}`
      );
    }
    if (act.billHistory) {
      const bh = act.billHistory;
      if (bh.billNumber) {
        parts.push(`Numéro du projet de loi: ${bh.billNumber}`);
      }
      if (bh.parliament?.session && bh.parliament?.number) {
        parts.push(
          `Parlement: ${bh.parliament.number}e législature, ${bh.parliament.session}e session`
        );
      }
      const assentStage = bh.stages?.find((s) => s.stage === "assented-to");
      if (assentStage?.date) {
        parts.push(`Sanction royale: ${assentStage.date}`);
      }
    }
    if (act.hasPreviousVersion === "true") {
      parts.push("Versions antérieures: Oui");
    }
    if (act.recentAmendments && act.recentAmendments.length > 0) {
      parts.push("Modifications récentes:");
      for (const amendment of act.recentAmendments) {
        let amendText = `  - ${amendment.citation}`;
        if (amendment.date) {
          amendText += ` (${amendment.date})`;
        }
        parts.push(amendText);
      }
    }
  } else {
    parts.push(`Act: ${act.title}`);
    if (act.longTitle) {
      parts.push(`Long Title: ${act.longTitle}`);
    }
    if (act.runningHead) {
      parts.push(`Short Title: ${act.runningHead}`);
    }
    if (act.shortTitleStatus) {
      parts.push(`Short Title Status: ${act.shortTitleStatus}`);
    }
    if (act.reversedShortTitle) {
      parts.push(`Alphabetical Index: ${act.reversedShortTitle}`);
    }
    parts.push(`ID: ${act.actId}`);
    parts.push(`Status: ${act.status}`);
    if (act.inForceDate) {
      parts.push(`In Force: ${act.inForceDate}`);
    }
    if (act.enactedDate) {
      parts.push(`Enacted: ${act.enactedDate}`);
    }
    if (act.lastAmendedDate) {
      parts.push(`Last Amended: ${act.lastAmendedDate}`);
    }
    if (act.consolidationDate) {
      parts.push(`Consolidation: ${act.consolidationDate}`);
    }
    if (act.billOrigin) {
      const origin =
        act.billOrigin === "commons" ? "House of Commons" : "Senate";
      parts.push(`Origin: ${origin}`);
    }
    if (act.billType) {
      parts.push(`Bill Type: ${act.billType}`);
    }
    if (act.consolidatedNumber) {
      parts.push(`Consolidated Number: ${act.consolidatedNumber}`);
    }
    if (act.consolidatedNumberOfficial) {
      parts.push(
        `Consolidated Number Official: ${act.consolidatedNumberOfficial}`
      );
    }
    if (act.annualStatuteYear && act.annualStatuteChapter) {
      parts.push(
        `Annual Statutes: ${act.annualStatuteYear}, c. ${act.annualStatuteChapter}`
      );
    }
    if (act.billHistory) {
      const bh = act.billHistory;
      if (bh.billNumber) {
        parts.push(`Bill Number: ${bh.billNumber}`);
      }
      if (bh.parliament?.session && bh.parliament?.number) {
        parts.push(
          `Parliament: ${bh.parliament.number}${getOrdinalSuffix(Number(bh.parliament.number))} Parliament, ${bh.parliament.session}${getOrdinalSuffix(Number(bh.parliament.session))} Session`
        );
      }
      const assentStage = bh.stages?.find((s) => s.stage === "assented-to");
      if (assentStage?.date) {
        parts.push(`Royal Assent: ${assentStage.date}`);
      }
    }
    if (act.hasPreviousVersion === "true") {
      parts.push("Previous Versions: Yes");
    }
    if (act.recentAmendments && act.recentAmendments.length > 0) {
      parts.push("Recent Amendments:");
      for (const amendment of act.recentAmendments) {
        let amendText = `  - ${amendment.citation}`;
        if (amendment.date) {
          amendText += ` (${amendment.date})`;
        }
        parts.push(amendText);
      }
    }
  }

  return parts.join("\n");
}

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, etc.)
 */
function getOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/**
 * Build chunks for a single act and its sections.
 */
function buildActChunks(
  act: Act,
  actSections: (typeof sections.$inferSelect)[]
): { chunks: ChunkData[]; skippedInvalidLang: boolean } {
  const lang = validateLanguage(act.language);
  if (!lang) {
    return { chunks: [], skippedInvalidLang: true };
  }

  const chunks: ChunkData[] = [];
  const actKey = buildResourceKey("act", act.actId, lang, 0);
  const actPairedKey = buildPairedResourceKey("act", act.actId, lang, 0);

  // Add act metadata chunk (chunkIndex 0)
  chunks.push({
    content: buildActMetadataText(act),
    chunkIndex: 0,
    totalChunks: 1,
    resourceKey: actKey,
    metadata: {
      sourceType: "act",
      language: lang,
      actId: act.actId,
      documentTitle: act.title,
      longTitle: act.longTitle ?? undefined,
      reversedShortTitle: act.reversedShortTitle ?? undefined,
      shortTitleStatus: act.shortTitleStatus ?? undefined,
      consolidatedNumberOfficial: act.consolidatedNumberOfficial ?? undefined,
      status: act.status,
      inForceDate: act.inForceDate ?? undefined,
      consolidationDate: act.consolidationDate ?? undefined,
      enactedDate: act.enactedDate ?? undefined,
      billOrigin: act.billOrigin ?? undefined,
      runningHead: act.runningHead ?? undefined,
      billType: act.billType ?? undefined,
      lastAmendedDate: act.lastAmendedDate ?? undefined,
      consolidatedNumber: act.consolidatedNumber ?? undefined,
      annualStatuteYear: act.annualStatuteYear ?? undefined,
      annualStatuteChapter: act.annualStatuteChapter ?? undefined,
      billHistory: act.billHistory ?? undefined,
      recentAmendments: act.recentAmendments ?? undefined,
      hasPreviousVersion: act.hasPreviousVersion ?? undefined,
      chunkIndex: 0,
      pairedResourceKey: actPairedKey,
    },
  });

  // Process sections
  for (const section of actSections) {
    if (shouldSkipSection(section)) {
      continue;
    }

    // Include historical notes in chunk content for amendment searchability
    const chunkOptions: ChunkSectionOptions = {
      historicalNotes: section.historicalNotes,
      language: lang,
    };
    const sectionChunks = chunkSection(section, act.title, chunkOptions);

    // Use "schedule" source type for schedule sections, otherwise "act_section"
    const sourceType =
      section.sectionType === "schedule" ? "schedule" : "act_section";

    for (const chunk of sectionChunks) {
      const sectionKey = buildResourceKey(
        sourceType,
        section.id,
        lang,
        chunk.chunkIndex
      );
      const sectionPairedKey = buildPairedResourceKey(
        sourceType,
        section.id,
        lang,
        chunk.chunkIndex
      );

      chunks.push({
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunk.totalChunks,
        resourceKey: sectionKey,
        metadata: {
          sourceType,
          sectionId: section.id,
          language: lang,
          actId: act.actId,
          documentTitle: act.title,
          sectionLabel: section.sectionLabel,
          marginalNote: section.marginalNote ?? undefined,
          sectionStatus: section.status ?? undefined,
          sectionType: section.sectionType ?? undefined,
          hierarchyPath: section.hierarchyPath ?? undefined,
          contentFlags: section.contentFlags ?? undefined,
          sectionInForceDate: section.inForceStartDate ?? undefined,
          sectionLastAmendedDate: section.lastAmendedDate ?? undefined,
          sectionEnactedDate: section.enactedDate ?? undefined,
          sectionRole: section.xmlType ?? undefined, // xmlType -> sectionRole
          amendmentTarget: section.xmlTarget ?? undefined, // xmlTarget -> amendmentTarget
          historicalNotes: section.historicalNotes ?? undefined,
          scheduleId: section.scheduleId ?? undefined,
          scheduleBilingual: section.scheduleBilingual ?? undefined,
          scheduleSpanLanguages: section.scheduleSpanLanguages ?? undefined,
          scheduleOriginatingRef: section.scheduleOriginatingRef ?? undefined,
          provisionHeading: section.provisionHeading ?? undefined,
          internalReferences: section.internalReferences ?? undefined,
          chunkIndex: chunk.chunkIndex,
          pairedResourceKey: sectionPairedKey,
        },
      });
    }
  }

  return { chunks, skippedInvalidLang: false };
}

/**
 * Process all acts and their sections, generating embeddings.
 * Uses streaming/batching to avoid loading all data into memory.
 */
export async function processActs(
  options: ProcessOptions
): Promise<ProcessResult> {
  const { db, progressTracker, limit, dryRun, skipExisting } = options;

  console.log("• Processing acts...");

  if (skipExisting) {
    await Promise.all([
      ensureProgressSynced(db, progressTracker, "act"),
      ensureProgressSynced(db, progressTracker, "act_section"),
      ensureProgressSynced(db, progressTracker, "schedule"),
    ]);
  }

  // Get total count first
  const [{ count: totalCountRaw }] = await db
    .select({ count: count() })
    .from(acts);
  const totalCount = limit ? Math.min(limit, totalCountRaw) : totalCountRaw;
  console.log(`   Found ${totalCount} acts (processing in batches)`);

  if (totalCount === 0) {
    return {
      chunksProcessed: 0,
      chunksSkipped: 0,
      itemsProcessed: 0,
      errors: [],
    };
  }

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalItems = 0;
  const errors: ProcessError[] = [];

  // Process acts in batches to avoid OOM
  for (let offset = 0; offset < totalCount; offset += DB_FETCH_BATCH_SIZE) {
    const batchLimit = Math.min(DB_FETCH_BATCH_SIZE, totalCount - offset);
    const batchNum = Math.floor(offset / DB_FETCH_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(totalCount / DB_FETCH_BATCH_SIZE);
    console.log(
      `   📥 Fetching DB batch ${batchNum}/${totalBatches} (offset ${offset})...`
    );

    // Fetch batch of acts
    const batchActs = await db
      .select()
      .from(acts)
      .orderBy(acts.actId)
      .limit(batchLimit)
      .offset(offset);

    if (batchActs.length === 0) {
      break;
    }

    // Fetch sections for this batch of acts only
    const actIds = [...new Set(batchActs.map((a) => a.actId))];
    const batchSections = await db
      .select()
      .from(sections)
      .where(inArray(sections.actId, actIds))
      .orderBy(asc(sections.sectionOrder));

    // Group sections by actId+language for O(1) lookup
    const sectionsByAct = new Map<string, (typeof sections.$inferSelect)[]>();
    for (const section of batchSections) {
      if (!section.actId) {
        continue;
      }
      const key = `${section.actId}:${section.language}`;
      const existing = sectionsByAct.get(key);
      if (existing) {
        existing.push(section);
      } else {
        sectionsByAct.set(key, [section]);
      }
    }

    // Build chunks for this batch
    const batchChunks: ChunkData[] = [];

    for (let i = 0; i < batchActs.length; i++) {
      const act = batchActs[i];
      logProgress(offset + i + 1, totalCount, "Acts");

      const actSections =
        sectionsByAct.get(`${act.actId}:${act.language}`) ?? [];
      const { chunks, skippedInvalidLang: wasSkippedLang } = buildActChunks(
        act,
        actSections
      );

      if (wasSkippedLang) {
        errors.push({
          itemType: "act",
          itemId: act.actId,
          message: `Invalid language "${act.language}"`,
          retryable: false,
        });
        continue;
      }

      batchChunks.push(...chunks);
      totalItems++;
    }

    // Filter and insert this batch immediately to free memory
    const { newChunks, skipped } = filterNewChunks(
      batchChunks,
      progressTracker,
      skipExisting
    );

    const inserted = await insertChunksBatched({
      db,
      chunks: newChunks,
      progressTracker,
      label: `acts batch ${batchNum}`,
      dryRun,
    });

    totalInserted += inserted;
    totalSkipped += skipped;
  }

  console.log(
    `   ↳ Acts: ${totalInserted} chunks embedded (${totalSkipped} skipped)`
  );
  if (errors.length > 0) {
    console.log(`   ⚠️  ${errors.length} acts had errors`);
  }

  return {
    chunksProcessed: totalInserted,
    chunksSkipped: totalSkipped,
    itemsProcessed: totalItems,
    errors,
  };
}
