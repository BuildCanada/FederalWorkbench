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
 * Build bilingual metadata text for a regulation.
 * Includes ALL enabling authorities when multiple are present.
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
    // Include all enabling authorities (or fall back to legacy single field)
    if (reg.enablingAuthorities && reg.enablingAuthorities.length > 0) {
      if (reg.enablingAuthorities.length === 1) {
        parts.push(`Loi habilitante: ${reg.enablingAuthorities[0].actTitle}`);
      } else {
        parts.push("Lois habilitantes:");
        for (const auth of reg.enablingAuthorities) {
          parts.push(`  - ${auth.actTitle} (${auth.actId})`);
        }
      }
    } else if (reg.enablingActTitle) {
      parts.push(`Loi habilitante: ${reg.enablingActTitle}`);
    }
    if (reg.consolidationDate) {
      parts.push(`Consolidation: ${reg.consolidationDate}`);
    }
    if (reg.lastAmendedDate) {
      parts.push(`Dernière modification: ${reg.lastAmendedDate}`);
    }
    if (reg.gazettePart) {
      parts.push(`Partie de la Gazette: ${reg.gazettePart}`);
    }
    if (reg.regulationMakerOrder) {
      const rmo = reg.regulationMakerOrder;
      if (rmo.regulationMaker) {
        let madeBy = `Pris par: ${rmo.regulationMaker}`;
        if (rmo.orderNumber) {
          madeBy += `, ${rmo.orderNumber}`;
        }
        if (rmo.orderDate) {
          madeBy += ` (${rmo.orderDate})`;
        }
        parts.push(madeBy);
      }
    }
    if (reg.hasPreviousVersion === "true") {
      parts.push("Versions antérieures: Oui");
    }
    if (reg.recentAmendments && reg.recentAmendments.length > 0) {
      parts.push("Modifications récentes:");
      for (const amendment of reg.recentAmendments) {
        let amendText = `  - ${amendment.citation}`;
        if (amendment.date) {
          amendText += ` (${amendment.date})`;
        }
        parts.push(amendText);
      }
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
    // Include all enabling authorities (or fall back to legacy single field)
    if (reg.enablingAuthorities && reg.enablingAuthorities.length > 0) {
      if (reg.enablingAuthorities.length === 1) {
        parts.push(`Enabling Act: ${reg.enablingAuthorities[0].actTitle}`);
      } else {
        parts.push("Enabling Acts:");
        for (const auth of reg.enablingAuthorities) {
          parts.push(`  - ${auth.actTitle} (${auth.actId})`);
        }
      }
    } else if (reg.enablingActTitle) {
      parts.push(`Enabling Act: ${reg.enablingActTitle}`);
    }
    if (reg.consolidationDate) {
      parts.push(`Consolidation: ${reg.consolidationDate}`);
    }
    if (reg.lastAmendedDate) {
      parts.push(`Last Amended: ${reg.lastAmendedDate}`);
    }
    if (reg.gazettePart) {
      parts.push(`Gazette Part: ${reg.gazettePart}`);
    }
    if (reg.regulationMakerOrder) {
      const rmo = reg.regulationMakerOrder;
      if (rmo.regulationMaker) {
        let madeBy = `Made by: ${rmo.regulationMaker}`;
        if (rmo.orderNumber) {
          madeBy += `, ${rmo.orderNumber}`;
        }
        if (rmo.orderDate) {
          madeBy += ` (${rmo.orderDate})`;
        }
        parts.push(madeBy);
      }
    }
    if (reg.hasPreviousVersion === "true") {
      parts.push("Previous Versions: Yes");
    }
    if (reg.recentAmendments && reg.recentAmendments.length > 0) {
      parts.push("Recent Amendments:");
      for (const amendment of reg.recentAmendments) {
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
  const regPairedKey = buildPairedResourceKey(
    "regulation",
    reg.regulationId,
    lang,
    0
  );

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
      // Include all enabling authorities when available
      enablingAuthorities: reg.enablingAuthorities ?? undefined,
      // Legacy: First enabling act for backwards compatibility
      enablingActId: reg.enablingActId ?? undefined,
      enablingActTitle: reg.enablingActTitle ?? undefined,
      registrationDate: reg.registrationDate ?? undefined,
      consolidationDate: reg.consolidationDate ?? undefined,
      lastAmendedDate: reg.lastAmendedDate ?? undefined,
      gazettePart: reg.gazettePart ?? undefined,
      regulationMakerOrder: reg.regulationMakerOrder ?? undefined,
      recentAmendments: reg.recentAmendments ?? undefined,
      hasPreviousVersion: reg.hasPreviousVersion ?? undefined,
      chunkIndex: 0,
      pairedResourceKey: regPairedKey,
    },
  });

  // Process sections
  for (const section of regSections) {
    if (shouldSkipSection(section)) {
      continue;
    }

    // Include historical notes in chunk content for amendment searchability
    const chunkOptions: ChunkSectionOptions = {
      historicalNotes: section.historicalNotes,
      language: lang,
    };
    const sectionChunks = chunkSection(section, reg.title, chunkOptions);

    // Use "schedule" source type for schedule sections, otherwise "regulation_section"
    const sourceType =
      section.sectionType === "schedule" ? "schedule" : "regulation_section";

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
          regulationId: reg.regulationId,
          documentTitle: reg.title,
          sectionLabel: section.sectionLabel,
          marginalNote: section.marginalNote ?? undefined,
          sectionStatus: section.status ?? undefined,
          sectionType: section.sectionType ?? undefined,
          hierarchyPath: section.hierarchyPath ?? undefined,
          contentFlags: section.contentFlags ?? undefined,
          sectionInForceDate: section.inForceStartDate ?? undefined,
          sectionRole: section.xmlType ?? undefined, // xmlType -> sectionRole
          historicalNotes: section.historicalNotes ?? undefined,
          scheduleId: section.scheduleId ?? undefined,
          scheduleBilingual: section.scheduleBilingual ?? undefined,
          scheduleSpanLanguages: section.scheduleSpanLanguages ?? undefined,
          chunkIndex: chunk.chunkIndex,
          pairedResourceKey: sectionPairedKey,
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
      ensureProgressSynced(db, progressTracker, "schedule"),
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
