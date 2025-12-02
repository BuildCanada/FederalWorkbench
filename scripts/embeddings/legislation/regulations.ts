/**
 * Regulation processing for legislation embeddings
 *
 * Processes regulations and their sections, generating metadata chunks and content embeddings.
 * Uses streaming/batching to avoid loading all data into memory.
 */

import { asc, count, inArray } from "drizzle-orm";

import {
  type Regulation,
  regulations,
  sections,
} from "@/lib/db/legislation/schema";
import {
  chunkSection,
  shouldSkipSection,
} from "@/lib/rag/legislation/chunking";

import {
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
 * Build bilingual metadata text for a regulation.
 */
export function buildRegulationMetadataText(reg: Regulation): string {
  const parts: string[] = [];
  const lang = validateLanguage(reg.language);

  if (lang === "fr") {
    parts.push(`Règlement: ${reg.title}`);
    if (reg.longTitle) {
      parts.push(`Titre complet: ${reg.longTitle}`);
    }
    parts.push(`Identifiant: ${reg.regulationId}`);
    if (reg.instrumentNumber) {
      parts.push(`Numéro d'instrument: ${reg.instrumentNumber}`);
    }
    parts.push(`Statut: ${reg.status}`);
    if (reg.regulationType) {
      parts.push(`Type: ${reg.regulationType}`);
    }
    if (reg.registrationDate) {
      parts.push(`Date d'enregistrement: ${reg.registrationDate}`);
    }
    if (reg.enablingActTitle) {
      parts.push(`Loi habilitante: ${reg.enablingActTitle}`);
    }
    if (reg.consolidationDate) {
      parts.push(`Consolidation: ${reg.consolidationDate}`);
    }
  } else {
    parts.push(`Regulation: ${reg.title}`);
    if (reg.longTitle) {
      parts.push(`Long Title: ${reg.longTitle}`);
    }
    parts.push(`ID: ${reg.regulationId}`);
    if (reg.instrumentNumber) {
      parts.push(`Instrument Number: ${reg.instrumentNumber}`);
    }
    parts.push(`Status: ${reg.status}`);
    if (reg.regulationType) {
      parts.push(`Type: ${reg.regulationType}`);
    }
    if (reg.registrationDate) {
      parts.push(`Registration Date: ${reg.registrationDate}`);
    }
    if (reg.enablingActTitle) {
      parts.push(`Enabling Act: ${reg.enablingActTitle}`);
    }
    if (reg.consolidationDate) {
      parts.push(`Consolidation: ${reg.consolidationDate}`);
    }
  }

  return parts.join("\n");
}

/**
 * Build chunks for a single regulation and its sections.
 */
function buildRegulationChunks(
  reg: Regulation,
  regSections: (typeof sections.$inferSelect)[]
): { chunks: ChunkData[]; skippedInvalidLang: boolean } {
  const lang = validateLanguage(reg.language);
  if (!lang) {
    return { chunks: [], skippedInvalidLang: true };
  }

  const chunks: ChunkData[] = [];
  const regKey = buildResourceKey("regulation", reg.regulationId, lang, 0);

  // Add regulation metadata chunk (chunkIndex 0)
  chunks.push({
    content: buildRegulationMetadataText(reg),
    chunkIndex: 0,
    totalChunks: 1,
    resourceKey: regKey,
    metadata: {
      sourceType: "regulation",
      language: lang,
      regulationId: reg.regulationId,
      documentTitle: reg.title,
      longTitle: reg.longTitle ?? undefined,
      status: reg.status,
      instrumentNumber: reg.instrumentNumber ?? undefined,
      regulationType: reg.regulationType ?? undefined,
      enablingActId: reg.enablingActId ?? undefined,
      enablingActTitle: reg.enablingActTitle ?? undefined,
      registrationDate: reg.registrationDate ?? undefined,
      consolidationDate: reg.consolidationDate ?? undefined,
      chunkIndex: 0,
    },
  });

  // Process sections
  for (const section of regSections) {
    if (shouldSkipSection(section)) {
      continue;
    }

    const sectionChunks = chunkSection(section, reg.title);

    for (const chunk of sectionChunks) {
      const sectionKey = buildResourceKey(
        "regulation_section",
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
          sourceType: "regulation_section",
          sectionId: section.id,
          language: lang,
          regulationId: reg.regulationId,
          documentTitle: reg.title,
          sectionLabel: section.sectionLabel,
          marginalNote: section.marginalNote ?? undefined,
          sectionStatus: section.status ?? undefined,
          sectionType: section.sectionType ?? undefined,
          hierarchyPath: section.hierarchyPath ?? undefined,
          contentFlags: section.contentFlags ?? undefined,
          sectionInForceDate: section.inForceStartDate ?? undefined,
          historicalNotes: section.historicalNotes ?? undefined,
          chunkIndex: chunk.chunkIndex,
        },
      });
    }
  }

  return { chunks, skippedInvalidLang: false };
}

/**
 * Process all regulations and their sections, generating embeddings.
 * Uses streaming/batching to avoid loading all data into memory.
 */
export async function processRegulations(
  options: ProcessOptions
): Promise<ProcessResult> {
  const { db, progressTracker, limit, dryRun, skipExisting } = options;

  console.log("• Processing regulations...");

  if (skipExisting) {
    await Promise.all([
      ensureProgressSynced(db, progressTracker, "regulation"),
      ensureProgressSynced(db, progressTracker, "regulation_section"),
    ]);
  }

  // Get total count first
  const [{ count: totalCountRaw }] = await db
    .select({ count: count() })
    .from(regulations);
  const totalCount = limit ? Math.min(limit, totalCountRaw) : totalCountRaw;
  console.log(`   Found ${totalCount} regulations (processing in batches)`);

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

  // Process regulations in batches to avoid OOM
  for (let offset = 0; offset < totalCount; offset += DB_FETCH_BATCH_SIZE) {
    const batchLimit = Math.min(DB_FETCH_BATCH_SIZE, totalCount - offset);
    const batchNum = Math.floor(offset / DB_FETCH_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(totalCount / DB_FETCH_BATCH_SIZE);
    console.log(
      `   📥 Fetching DB batch ${batchNum}/${totalBatches} (offset ${offset})...`
    );

    // Fetch batch of regulations
    const batchRegs = await db
      .select()
      .from(regulations)
      .orderBy(regulations.regulationId)
      .limit(batchLimit)
      .offset(offset);

    if (batchRegs.length === 0) {
      break;
    }

    // Fetch sections for this batch of regulations only
    const regIds = [...new Set(batchRegs.map((r) => r.regulationId))];
    const batchSections = await db
      .select()
      .from(sections)
      .where(inArray(sections.regulationId, regIds))
      .orderBy(asc(sections.sectionOrder));

    // Group sections by regulationId+language for O(1) lookup
    const sectionsByReg = new Map<string, (typeof sections.$inferSelect)[]>();
    for (const section of batchSections) {
      if (!section.regulationId) {
        continue;
      }
      const key = `${section.regulationId}:${section.language}`;
      const existing = sectionsByReg.get(key);
      if (existing) {
        existing.push(section);
      } else {
        sectionsByReg.set(key, [section]);
      }
    }

    // Build chunks for this batch
    const batchChunks: ChunkData[] = [];

    for (let i = 0; i < batchRegs.length; i++) {
      const reg = batchRegs[i];
      logProgress(offset + i + 1, totalCount, "Regulations");

      const regSections =
        sectionsByReg.get(`${reg.regulationId}:${reg.language}`) ?? [];
      const { chunks, skippedInvalidLang: wasSkippedLang } =
        buildRegulationChunks(reg, regSections);

      if (wasSkippedLang) {
        errors.push({
          itemType: "regulation",
          itemId: reg.regulationId,
          message: `Invalid language "${reg.language}"`,
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
      label: `regulations batch ${batchNum}`,
      dryRun,
    });

    totalInserted += inserted;
    totalSkipped += skipped;
  }

  console.log(
    `   ↳ Regulations: ${totalInserted} chunks embedded (${totalSkipped} skipped)`
  );
  if (errors.length > 0) {
    console.log(`   ⚠️  ${errors.length} regulations had errors`);
  }

  return {
    chunksProcessed: totalInserted,
    chunksSkipped: totalSkipped,
    itemsProcessed: totalItems,
    errors,
  };
}
