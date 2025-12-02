/**
 * Additional content processing for legislation embeddings
 *
 * Handles preambles, treaties, cross-references, table of provisions, and signature blocks.
 * These are supplementary content types that provide important legal context.
 */

import { count, sql } from "drizzle-orm";

import {
  acts,
  crossReferences,
  type PreambleProvision,
  type RelatedProvisionInfo,
  regulations,
  type SignatureBlock,
  type TableOfProvisionsEntry,
  type TreatyContent,
} from "@/lib/db/legislation/schema";

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

// ---------- Preamble Processing ----------

/**
 * Build searchable content for a preamble provision.
 */
function buildPreambleContent(
  preamble: PreambleProvision,
  _index: number,
  documentTitle: string,
  language: "en" | "fr"
): string {
  const parts: string[] = [];

  if (language === "fr") {
    parts.push(`Préambule de: ${documentTitle}`);
    if (preamble.marginalNote) {
      parts.push(`Note: ${preamble.marginalNote}`);
    }
    parts.push(`\n${preamble.text}`);
  } else {
    parts.push(`Preamble of: ${documentTitle}`);
    if (preamble.marginalNote) {
      parts.push(`Note: ${preamble.marginalNote}`);
    }
    parts.push(`\n${preamble.text}`);
  }

  return parts.join("\n");
}

/**
 * Process preambles from acts.
 */
export async function processPreambles(
  options: ProcessOptions
): Promise<ProcessResult> {
  const { db, progressTracker, limit, dryRun, skipExisting } = options;

  console.log("• Processing preambles...");

  if (skipExisting) {
    await ensureProgressSynced(db, progressTracker, "preamble");
  }

  // Get acts with preambles
  const [{ count: totalCountRaw }] = await db
    .select({ count: count() })
    .from(acts)
    .where(
      sql`${acts.preamble} IS NOT NULL AND jsonb_array_length(${acts.preamble}) > 0`
    );

  const totalCount = limit ? Math.min(limit, totalCountRaw) : totalCountRaw;
  console.log(`   Found ${totalCount} acts with preambles`);

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

  for (let offset = 0; offset < totalCount; offset += DB_FETCH_BATCH_SIZE) {
    const batchLimit = Math.min(DB_FETCH_BATCH_SIZE, totalCount - offset);
    const batchNum = Math.floor(offset / DB_FETCH_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(totalCount / DB_FETCH_BATCH_SIZE);
    console.log(`   📥 Fetching preamble batch ${batchNum}/${totalBatches}...`);

    const batchActs = await db
      .select()
      .from(acts)
      .where(
        sql`${acts.preamble} IS NOT NULL AND jsonb_array_length(${acts.preamble}) > 0`
      )
      .orderBy(acts.actId)
      .limit(batchLimit)
      .offset(offset);

    const batchChunks: ChunkData[] = [];

    for (const act of batchActs) {
      const lang = validateLanguage(act.language);
      if (!lang) {
        errors.push({
          itemType: "preamble",
          itemId: act.actId,
          message: `Invalid language "${act.language}"`,
          retryable: false,
        });
        continue;
      }

      const preambleItems = act.preamble ?? [];
      for (let i = 0; i < preambleItems.length; i++) {
        const preamble = preambleItems[i];
        logProgress(offset + totalItems + 1, totalCount, "Preambles");

        const resourceKey = buildResourceKey(
          "preamble",
          `${act.actId}:${i}`,
          lang,
          0
        );
        batchChunks.push({
          content: buildPreambleContent(preamble, i, act.title, lang),
          chunkIndex: 0,
          totalChunks: 1,
          resourceKey,
          metadata: {
            sourceType: "preamble",
            language: lang,
            actId: act.actId,
            documentTitle: act.title,
            preambleIndex: i,
            chunkIndex: 0,
          },
        });
      }
      totalItems++;
    }

    const { newChunks, skipped } = filterNewChunks(
      batchChunks,
      progressTracker,
      skipExisting
    );
    const inserted = await insertChunksBatched({
      db,
      chunks: newChunks,
      progressTracker,
      label: `preambles batch ${batchNum}`,
      dryRun,
    });

    totalInserted += inserted;
    totalSkipped += skipped;
  }

  console.log(
    `   ↳ Preambles: ${totalInserted} chunks embedded (${totalSkipped} skipped)`
  );
  if (errors.length > 0) {
    console.log(`   ⚠️  ${errors.length} preambles had errors`);
  }

  return {
    chunksProcessed: totalInserted,
    chunksSkipped: totalSkipped,
    itemsProcessed: totalItems,
    errors,
  };
}

// ---------- Treaty Processing ----------

/**
 * Build searchable content for a treaty/convention.
 */
function buildTreatyContent(
  treaty: TreatyContent,
  documentTitle: string,
  language: "en" | "fr"
): string {
  const parts: string[] = [];

  if (language === "fr") {
    if (treaty.title) {
      parts.push(`Traité/Convention: ${treaty.title}`);
    }
    parts.push(`Source: ${documentTitle}`);
    parts.push(`\n${treaty.text}`);
  } else {
    if (treaty.title) {
      parts.push(`Treaty/Convention: ${treaty.title}`);
    }
    parts.push(`Source: ${documentTitle}`);
    parts.push(`\n${treaty.text}`);
  }

  return parts.join("\n");
}

/**
 * Process treaties from acts and regulations.
 */
export async function processTreaties(
  options: ProcessOptions
): Promise<ProcessResult> {
  const { db, progressTracker, limit, dryRun, skipExisting } = options;

  console.log("• Processing treaties...");

  if (skipExisting) {
    await ensureProgressSynced(db, progressTracker, "treaty");
  }

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalItems = 0;
  const errors: ProcessError[] = [];

  // Process act treaties
  const [{ count: actTreatyCount }] = await db
    .select({ count: count() })
    .from(acts)
    .where(
      sql`${acts.treaties} IS NOT NULL AND jsonb_array_length(${acts.treaties}) > 0`
    );

  const actLimit = limit ? Math.min(limit, actTreatyCount) : actTreatyCount;
  console.log(`   Found ${actLimit} acts with treaties`);

  for (let offset = 0; offset < actLimit; offset += DB_FETCH_BATCH_SIZE) {
    const batchLimit = Math.min(DB_FETCH_BATCH_SIZE, actLimit - offset);

    const batchActs = await db
      .select()
      .from(acts)
      .where(
        sql`${acts.treaties} IS NOT NULL AND jsonb_array_length(${acts.treaties}) > 0`
      )
      .orderBy(acts.actId)
      .limit(batchLimit)
      .offset(offset);

    const batchChunks: ChunkData[] = [];

    for (const act of batchActs) {
      const lang = validateLanguage(act.language);
      if (!lang) {
        errors.push({
          itemType: "treaty",
          itemId: `act:${act.actId}`,
          message: `Invalid language "${act.language}"`,
          retryable: false,
        });
        continue;
      }

      const treaties = act.treaties ?? [];
      for (let i = 0; i < treaties.length; i++) {
        const treaty = treaties[i];
        const resourceKey = buildResourceKey(
          "treaty",
          `act:${act.actId}:${i}`,
          lang,
          0
        );
        batchChunks.push({
          content: buildTreatyContent(treaty, act.title, lang),
          chunkIndex: 0,
          totalChunks: 1,
          resourceKey,
          metadata: {
            sourceType: "treaty",
            language: lang,
            actId: act.actId,
            documentTitle: act.title,
            treatyTitle: treaty.title,
            chunkIndex: 0,
          },
        });
      }
      totalItems++;
    }

    const { newChunks, skipped } = filterNewChunks(
      batchChunks,
      progressTracker,
      skipExisting
    );
    const inserted = await insertChunksBatched({
      db,
      chunks: newChunks,
      progressTracker,
      label: "act treaties",
      dryRun,
    });

    totalInserted += inserted;
    totalSkipped += skipped;
  }

  // Process regulation treaties
  const [{ count: regTreatyCount }] = await db
    .select({ count: count() })
    .from(regulations)
    .where(
      sql`${regulations.treaties} IS NOT NULL AND jsonb_array_length(${regulations.treaties}) > 0`
    );

  const regLimit = limit ? Math.min(limit, regTreatyCount) : regTreatyCount;
  console.log(`   Found ${regLimit} regulations with treaties`);

  for (let offset = 0; offset < regLimit; offset += DB_FETCH_BATCH_SIZE) {
    const batchLimit = Math.min(DB_FETCH_BATCH_SIZE, regLimit - offset);

    const batchRegs = await db
      .select()
      .from(regulations)
      .where(
        sql`${regulations.treaties} IS NOT NULL AND jsonb_array_length(${regulations.treaties}) > 0`
      )
      .orderBy(regulations.regulationId)
      .limit(batchLimit)
      .offset(offset);

    const batchChunks: ChunkData[] = [];

    for (const reg of batchRegs) {
      const lang = validateLanguage(reg.language);
      if (!lang) {
        errors.push({
          itemType: "treaty",
          itemId: `reg:${reg.regulationId}`,
          message: `Invalid language "${reg.language}"`,
          retryable: false,
        });
        continue;
      }

      const treaties = reg.treaties ?? [];
      for (let i = 0; i < treaties.length; i++) {
        const treaty = treaties[i];
        const resourceKey = buildResourceKey(
          "treaty",
          `reg:${reg.regulationId}:${i}`,
          lang,
          0
        );
        batchChunks.push({
          content: buildTreatyContent(treaty, reg.title, lang),
          chunkIndex: 0,
          totalChunks: 1,
          resourceKey,
          metadata: {
            sourceType: "treaty",
            language: lang,
            regulationId: reg.regulationId,
            documentTitle: reg.title,
            treatyTitle: treaty.title,
            chunkIndex: 0,
          },
        });
      }
      totalItems++;
    }

    const { newChunks, skipped } = filterNewChunks(
      batchChunks,
      progressTracker,
      skipExisting
    );
    const inserted = await insertChunksBatched({
      db,
      chunks: newChunks,
      progressTracker,
      label: "regulation treaties",
      dryRun,
    });

    totalInserted += inserted;
    totalSkipped += skipped;
  }

  console.log(
    `   ↳ Treaties: ${totalInserted} chunks embedded (${totalSkipped} skipped)`
  );
  if (errors.length > 0) {
    console.log(`   ⚠️  ${errors.length} treaties had errors`);
  }

  return {
    chunksProcessed: totalInserted,
    chunksSkipped: totalSkipped,
    itemsProcessed: totalItems,
    errors,
  };
}

// ---------- Cross-Reference Processing ----------

/**
 * Build searchable content for a cross-reference.
 * Cross-references are language-neutral, so we include both EN and FR labels
 * for better bilingual search matching.
 */
function buildCrossRefContent(
  ref: {
    sourceActId: string | null;
    sourceRegulationId: string | null;
    sourceSectionLabel: string | null;
    targetType: string;
    targetRef: string;
    targetSectionRef: string | null;
    referenceText: string | null;
  },
  sourceTitleEn: string,
  sourceTitleFr: string
): string {
  const parts: string[] = [];

  // Include both languages for bilingual search matching
  parts.push("Cross-reference / Référence croisée");
  parts.push(`Source: ${sourceTitleEn}`);
  if (sourceTitleFr !== sourceTitleEn) {
    parts.push(`Source (FR): ${sourceTitleFr}`);
  }
  if (ref.sourceSectionLabel) {
    parts.push(`Source section / Article source: ${ref.sourceSectionLabel}`);
  }

  const targetTypeEn = ref.targetType === "act" ? "Act" : "Regulation";
  const targetTypeFr = ref.targetType === "act" ? "Loi" : "Règlement";
  parts.push(`Target type / Type de cible: ${targetTypeEn} / ${targetTypeFr}`);
  parts.push(`Reference / Référence: ${ref.targetRef}`);

  if (ref.targetSectionRef) {
    parts.push(`Target section / Article cible: ${ref.targetSectionRef}`);
  }
  if (ref.referenceText) {
    parts.push(`Text / Texte: ${ref.referenceText}`);
  }

  return parts.join("\n");
}

/**
 * Process cross-references.
 */
export async function processCrossReferences(
  options: ProcessOptions
): Promise<ProcessResult> {
  const { db, progressTracker, limit, dryRun, skipExisting } = options;

  console.log("• Processing cross-references...");

  if (skipExisting) {
    await ensureProgressSynced(db, progressTracker, "cross_reference");
  }

  const [{ count: totalCountRaw }] = await db
    .select({ count: count() })
    .from(crossReferences);

  const totalCount = limit ? Math.min(limit, totalCountRaw) : totalCountRaw;
  console.log(`   Found ${totalCount} cross-references`);

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

  for (let offset = 0; offset < totalCount; offset += DB_FETCH_BATCH_SIZE) {
    const batchLimit = Math.min(DB_FETCH_BATCH_SIZE, totalCount - offset);
    const batchNum = Math.floor(offset / DB_FETCH_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(totalCount / DB_FETCH_BATCH_SIZE);
    console.log(
      `   📥 Fetching cross-ref batch ${batchNum}/${totalBatches}...`
    );

    // Use JOINs to fetch titles efficiently instead of loading all acts/regulations
    // LEFT JOIN with acts table for EN and FR titles
    // LEFT JOIN with regulations table for EN and FR titles
    const batchRefs = await db
      .select({
        // Cross-reference fields
        id: crossReferences.id,
        sourceActId: crossReferences.sourceActId,
        sourceRegulationId: crossReferences.sourceRegulationId,
        sourceSectionLabel: crossReferences.sourceSectionLabel,
        targetType: crossReferences.targetType,
        targetRef: crossReferences.targetRef,
        targetSectionRef: crossReferences.targetSectionRef,
        referenceText: crossReferences.referenceText,
        // Document titles via COALESCE - try act first, then regulation
        sourceTitleEn: sql<string>`COALESCE(
          (SELECT title FROM legislation.acts WHERE act_id = ${crossReferences.sourceActId} AND language = 'en' LIMIT 1),
          (SELECT title FROM legislation.regulations WHERE regulation_id = ${crossReferences.sourceRegulationId} AND language = 'en' LIMIT 1),
          'Unknown Document'
        )`.as("source_title_en"),
        sourceTitleFr: sql<string>`COALESCE(
          (SELECT title FROM legislation.acts WHERE act_id = ${crossReferences.sourceActId} AND language = 'fr' LIMIT 1),
          (SELECT title FROM legislation.regulations WHERE regulation_id = ${crossReferences.sourceRegulationId} AND language = 'fr' LIMIT 1),
          'Document inconnu'
        )`.as("source_title_fr"),
      })
      .from(crossReferences)
      .orderBy(crossReferences.id)
      .limit(batchLimit)
      .offset(offset);

    const batchChunks: ChunkData[] = [];

    // Process each cross-reference once (cross-refs are language-neutral)
    for (const ref of batchRefs) {
      logProgress(offset + totalItems + 1, totalCount, "Cross-refs");

      const sourceTitleEn = ref.sourceTitleEn ?? "Unknown Document";
      const sourceTitleFr = ref.sourceTitleFr ?? "Document inconnu";

      // Use "en" as default language for metadata since cross-refs are bilingual
      const resourceKey = buildResourceKey("cross_reference", ref.id, "en", 0);
      batchChunks.push({
        content: buildCrossRefContent(ref, sourceTitleEn, sourceTitleFr),
        chunkIndex: 0,
        totalChunks: 1,
        resourceKey,
        metadata: {
          sourceType: "cross_reference",
          language: "en", // Default to EN for language-neutral content
          crossRefId: ref.id,
          actId: ref.sourceActId ?? undefined,
          regulationId: ref.sourceRegulationId ?? undefined,
          documentTitle: sourceTitleEn,
          sectionLabel: ref.sourceSectionLabel ?? undefined,
          targetType: ref.targetType,
          targetRef: ref.targetRef,
          targetSectionRef: ref.targetSectionRef ?? undefined,
          referenceText: ref.referenceText ?? undefined,
          chunkIndex: 0,
        },
      });
      totalItems++;
    }

    const { newChunks, skipped } = filterNewChunks(
      batchChunks,
      progressTracker,
      skipExisting
    );
    const inserted = await insertChunksBatched({
      db,
      chunks: newChunks,
      progressTracker,
      label: `cross-refs batch ${batchNum}`,
      dryRun,
    });

    totalInserted += inserted;
    totalSkipped += skipped;
  }

  console.log(
    `   ↳ Cross-refs: ${totalInserted} chunks embedded (${totalSkipped} skipped)`
  );
  if (errors.length > 0) {
    console.log(`   ⚠️  ${errors.length} cross-references had errors`);
  }

  return {
    chunksProcessed: totalInserted,
    chunksSkipped: totalSkipped,
    itemsProcessed: totalItems,
    errors,
  };
}

// ---------- Table of Provisions Processing ----------

/**
 * Build searchable content for a table of provisions entry.
 */
function buildProvisionContent(
  provision: TableOfProvisionsEntry,
  documentTitle: string,
  language: "en" | "fr"
): string {
  const parts: string[] = [];
  const levelPrefix = "  ".repeat(provision.level);

  if (language === "fr") {
    parts.push(`Table des dispositions de: ${documentTitle}`);
    parts.push(`${levelPrefix}${provision.label}: ${provision.title}`);
  } else {
    parts.push(`Table of Provisions of: ${documentTitle}`);
    parts.push(`${levelPrefix}${provision.label}: ${provision.title}`);
  }

  return parts.join("\n");
}

/**
 * Process table of provisions from acts and regulations.
 */
export async function processTableOfProvisions(
  options: ProcessOptions
): Promise<ProcessResult> {
  const { db, progressTracker, limit, dryRun, skipExisting } = options;

  console.log("• Processing table of provisions...");

  if (skipExisting) {
    await ensureProgressSynced(db, progressTracker, "table_of_provisions");
  }

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalItems = 0;
  const errors: ProcessError[] = [];

  // Process act table of provisions
  const [{ count: actTopCount }] = await db
    .select({ count: count() })
    .from(acts)
    .where(
      sql`${acts.tableOfProvisions} IS NOT NULL AND jsonb_array_length(${acts.tableOfProvisions}) > 0`
    );

  const actLimit = limit ? Math.min(limit, actTopCount) : actTopCount;
  console.log(`   Found ${actLimit} acts with table of provisions`);

  for (let offset = 0; offset < actLimit; offset += DB_FETCH_BATCH_SIZE) {
    const batchLimit = Math.min(DB_FETCH_BATCH_SIZE, actLimit - offset);

    const batchActs = await db
      .select()
      .from(acts)
      .where(
        sql`${acts.tableOfProvisions} IS NOT NULL AND jsonb_array_length(${acts.tableOfProvisions}) > 0`
      )
      .orderBy(acts.actId)
      .limit(batchLimit)
      .offset(offset);

    const batchChunks: ChunkData[] = [];

    for (const act of batchActs) {
      const lang = validateLanguage(act.language);
      if (!lang) {
        errors.push({
          itemType: "table_of_provisions",
          itemId: `act:${act.actId}`,
          message: `Invalid language "${act.language}"`,
          retryable: false,
        });
        continue;
      }

      const provisions = act.tableOfProvisions ?? [];
      for (let i = 0; i < provisions.length; i++) {
        const provision = provisions[i];
        const resourceKey = buildResourceKey(
          "table_of_provisions",
          `act:${act.actId}:${i}`,
          lang,
          0
        );
        batchChunks.push({
          content: buildProvisionContent(provision, act.title, lang),
          chunkIndex: 0,
          totalChunks: 1,
          resourceKey,
          metadata: {
            sourceType: "table_of_provisions",
            language: lang,
            actId: act.actId,
            documentTitle: act.title,
            provisionLabel: provision.label,
            provisionTitle: provision.title,
            provisionLevel: provision.level,
            chunkIndex: 0,
          },
        });
      }
      totalItems++;
    }

    const { newChunks, skipped } = filterNewChunks(
      batchChunks,
      progressTracker,
      skipExisting
    );
    const inserted = await insertChunksBatched({
      db,
      chunks: newChunks,
      progressTracker,
      label: "act table of provisions",
      dryRun,
    });

    totalInserted += inserted;
    totalSkipped += skipped;
  }

  // Process regulation table of provisions
  const [{ count: regTopCount }] = await db
    .select({ count: count() })
    .from(regulations)
    .where(
      sql`${regulations.tableOfProvisions} IS NOT NULL AND jsonb_array_length(${regulations.tableOfProvisions}) > 0`
    );

  const regLimit = limit ? Math.min(limit, regTopCount) : regTopCount;
  console.log(`   Found ${regLimit} regulations with table of provisions`);

  for (let offset = 0; offset < regLimit; offset += DB_FETCH_BATCH_SIZE) {
    const batchLimit = Math.min(DB_FETCH_BATCH_SIZE, regLimit - offset);

    const batchRegs = await db
      .select()
      .from(regulations)
      .where(
        sql`${regulations.tableOfProvisions} IS NOT NULL AND jsonb_array_length(${regulations.tableOfProvisions}) > 0`
      )
      .orderBy(regulations.regulationId)
      .limit(batchLimit)
      .offset(offset);

    const batchChunks: ChunkData[] = [];

    for (const reg of batchRegs) {
      const lang = validateLanguage(reg.language);
      if (!lang) {
        errors.push({
          itemType: "table_of_provisions",
          itemId: `reg:${reg.regulationId}`,
          message: `Invalid language "${reg.language}"`,
          retryable: false,
        });
        continue;
      }

      const provisions = reg.tableOfProvisions ?? [];
      for (let i = 0; i < provisions.length; i++) {
        const provision = provisions[i];
        const resourceKey = buildResourceKey(
          "table_of_provisions",
          `reg:${reg.regulationId}:${i}`,
          lang,
          0
        );
        batchChunks.push({
          content: buildProvisionContent(provision, reg.title, lang),
          chunkIndex: 0,
          totalChunks: 1,
          resourceKey,
          metadata: {
            sourceType: "table_of_provisions",
            language: lang,
            regulationId: reg.regulationId,
            documentTitle: reg.title,
            provisionLabel: provision.label,
            provisionTitle: provision.title,
            provisionLevel: provision.level,
            chunkIndex: 0,
          },
        });
      }
      totalItems++;
    }

    const { newChunks, skipped } = filterNewChunks(
      batchChunks,
      progressTracker,
      skipExisting
    );
    const inserted = await insertChunksBatched({
      db,
      chunks: newChunks,
      progressTracker,
      label: "regulation table of provisions",
      dryRun,
    });

    totalInserted += inserted;
    totalSkipped += skipped;
  }

  console.log(
    `   ↳ Table of Provisions: ${totalInserted} chunks embedded (${totalSkipped} skipped)`
  );
  if (errors.length > 0) {
    console.log(`   ⚠️  ${errors.length} table of provisions had errors`);
  }

  return {
    chunksProcessed: totalInserted,
    chunksSkipped: totalSkipped,
    itemsProcessed: totalItems,
    errors,
  };
}

// ---------- Signature Block Processing ----------

/**
 * Build searchable content for a signature block.
 */
function buildSignatureContent(
  sigBlock: SignatureBlock,
  documentTitle: string,
  language: "en" | "fr"
): string {
  const parts: string[] = [];

  if (language === "fr") {
    parts.push(`Bloc de signature de: ${documentTitle}`);
    if (sigBlock.witnessClause) {
      parts.push(`Clause de témoin: ${sigBlock.witnessClause}`);
    }
    if (sigBlock.doneAt) {
      parts.push(`Fait à: ${sigBlock.doneAt}`);
    }
    for (const line of sigBlock.lines) {
      if (line.signatureName) {
        parts.push(`Signataire: ${line.signatureName}`);
      }
      if (line.signatureTitle) {
        parts.push(`Titre: ${line.signatureTitle}`);
      }
      if (line.signatureDate) {
        parts.push(`Date: ${line.signatureDate}`);
      }
      if (line.signatureLocation) {
        parts.push(`Lieu: ${line.signatureLocation}`);
      }
    }
  } else {
    parts.push(`Signature block of: ${documentTitle}`);
    if (sigBlock.witnessClause) {
      parts.push(`Witness clause: ${sigBlock.witnessClause}`);
    }
    if (sigBlock.doneAt) {
      parts.push(`Done at: ${sigBlock.doneAt}`);
    }
    for (const line of sigBlock.lines) {
      if (line.signatureName) {
        parts.push(`Signatory: ${line.signatureName}`);
      }
      if (line.signatureTitle) {
        parts.push(`Title: ${line.signatureTitle}`);
      }
      if (line.signatureDate) {
        parts.push(`Date: ${line.signatureDate}`);
      }
      if (line.signatureLocation) {
        parts.push(`Location: ${line.signatureLocation}`);
      }
    }
  }

  return parts.join("\n");
}

/**
 * Process signature blocks from acts and regulations.
 */
export async function processSignatureBlocks(
  options: ProcessOptions
): Promise<ProcessResult> {
  const { db, progressTracker, limit, dryRun, skipExisting } = options;

  console.log("• Processing signature blocks...");

  if (skipExisting) {
    await ensureProgressSynced(db, progressTracker, "signature_block");
  }

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalItems = 0;
  const errors: ProcessError[] = [];

  // Process act signature blocks
  const [{ count: actSigCount }] = await db
    .select({ count: count() })
    .from(acts)
    .where(
      sql`${acts.signatureBlocks} IS NOT NULL AND jsonb_array_length(${acts.signatureBlocks}) > 0`
    );

  const actLimit = limit ? Math.min(limit, actSigCount) : actSigCount;
  console.log(`   Found ${actLimit} acts with signature blocks`);

  for (let offset = 0; offset < actLimit; offset += DB_FETCH_BATCH_SIZE) {
    const batchLimit = Math.min(DB_FETCH_BATCH_SIZE, actLimit - offset);

    const batchActs = await db
      .select()
      .from(acts)
      .where(
        sql`${acts.signatureBlocks} IS NOT NULL AND jsonb_array_length(${acts.signatureBlocks}) > 0`
      )
      .orderBy(acts.actId)
      .limit(batchLimit)
      .offset(offset);

    const batchChunks: ChunkData[] = [];

    for (const act of batchActs) {
      const lang = validateLanguage(act.language);
      if (!lang) {
        errors.push({
          itemType: "signature_block",
          itemId: `act:${act.actId}`,
          message: `Invalid language "${act.language}"`,
          retryable: false,
        });
        continue;
      }

      const sigBlocks = act.signatureBlocks ?? [];
      for (let i = 0; i < sigBlocks.length; i++) {
        const sigBlock = sigBlocks[i];
        const resourceKey = buildResourceKey(
          "signature_block",
          `act:${act.actId}:${i}`,
          lang,
          0
        );

        // Get first signatory info for metadata
        const firstLine = sigBlock.lines[0];

        batchChunks.push({
          content: buildSignatureContent(sigBlock, act.title, lang),
          chunkIndex: 0,
          totalChunks: 1,
          resourceKey,
          metadata: {
            sourceType: "signature_block",
            language: lang,
            actId: act.actId,
            documentTitle: act.title,
            signatureName: firstLine?.signatureName,
            signatureTitle: firstLine?.signatureTitle,
            signatureDate: firstLine?.signatureDate,
            chunkIndex: 0,
          },
        });
      }
      totalItems++;
    }

    const { newChunks, skipped } = filterNewChunks(
      batchChunks,
      progressTracker,
      skipExisting
    );
    const inserted = await insertChunksBatched({
      db,
      chunks: newChunks,
      progressTracker,
      label: "act signature blocks",
      dryRun,
    });

    totalInserted += inserted;
    totalSkipped += skipped;
  }

  // Process regulation signature blocks
  const [{ count: regSigCount }] = await db
    .select({ count: count() })
    .from(regulations)
    .where(
      sql`${regulations.signatureBlocks} IS NOT NULL AND jsonb_array_length(${regulations.signatureBlocks}) > 0`
    );

  const regLimit = limit ? Math.min(limit, regSigCount) : regSigCount;
  console.log(`   Found ${regLimit} regulations with signature blocks`);

  for (let offset = 0; offset < regLimit; offset += DB_FETCH_BATCH_SIZE) {
    const batchLimit = Math.min(DB_FETCH_BATCH_SIZE, regLimit - offset);

    const batchRegs = await db
      .select()
      .from(regulations)
      .where(
        sql`${regulations.signatureBlocks} IS NOT NULL AND jsonb_array_length(${regulations.signatureBlocks}) > 0`
      )
      .orderBy(regulations.regulationId)
      .limit(batchLimit)
      .offset(offset);

    const batchChunks: ChunkData[] = [];

    for (const reg of batchRegs) {
      const lang = validateLanguage(reg.language);
      if (!lang) {
        errors.push({
          itemType: "signature_block",
          itemId: `reg:${reg.regulationId}`,
          message: `Invalid language "${reg.language}"`,
          retryable: false,
        });
        continue;
      }

      const sigBlocks = reg.signatureBlocks ?? [];
      for (let i = 0; i < sigBlocks.length; i++) {
        const sigBlock = sigBlocks[i];
        const resourceKey = buildResourceKey(
          "signature_block",
          `reg:${reg.regulationId}:${i}`,
          lang,
          0
        );

        const firstLine = sigBlock.lines[0];

        batchChunks.push({
          content: buildSignatureContent(sigBlock, reg.title, lang),
          chunkIndex: 0,
          totalChunks: 1,
          resourceKey,
          metadata: {
            sourceType: "signature_block",
            language: lang,
            regulationId: reg.regulationId,
            documentTitle: reg.title,
            signatureName: firstLine?.signatureName,
            signatureTitle: firstLine?.signatureTitle,
            signatureDate: firstLine?.signatureDate,
            chunkIndex: 0,
          },
        });
      }
      totalItems++;
    }

    const { newChunks, skipped } = filterNewChunks(
      batchChunks,
      progressTracker,
      skipExisting
    );
    const inserted = await insertChunksBatched({
      db,
      chunks: newChunks,
      progressTracker,
      label: "regulation signature blocks",
      dryRun,
    });

    totalInserted += inserted;
    totalSkipped += skipped;
  }

  console.log(
    `   ↳ Signature Blocks: ${totalInserted} chunks embedded (${totalSkipped} skipped)`
  );
  if (errors.length > 0) {
    console.log(`   ⚠️  ${errors.length} signature blocks had errors`);
  }

  return {
    chunksProcessed: totalInserted,
    chunksSkipped: totalSkipped,
    itemsProcessed: totalItems,
    errors,
  };
}

// ---------- Related Provisions Processing ----------

/**
 * Build searchable content for a related provision.
 */
export function buildRelatedProvisionContent(
  provision: RelatedProvisionInfo,
  documentTitle: string,
  language: "en" | "fr"
): string {
  const parts: string[] = [];

  if (language === "fr") {
    parts.push(`Dispositions connexes de: ${documentTitle}`);
    if (provision.label) {
      parts.push(`Étiquette: ${provision.label}`);
    }
    if (provision.source) {
      parts.push(`Source: ${provision.source}`);
    }
    if (provision.sections?.length) {
      parts.push(`Articles: ${provision.sections.join(", ")}`);
    }
    if (provision.text) {
      parts.push(`\n${provision.text}`);
    }
  } else {
    parts.push(`Related provisions of: ${documentTitle}`);
    if (provision.label) {
      parts.push(`Label: ${provision.label}`);
    }
    if (provision.source) {
      parts.push(`Source: ${provision.source}`);
    }
    if (provision.sections?.length) {
      parts.push(`Sections: ${provision.sections.join(", ")}`);
    }
    if (provision.text) {
      parts.push(`\n${provision.text}`);
    }
  }

  return parts.join("\n");
}

/**
 * Process related provisions from acts and regulations.
 */
export async function processRelatedProvisions(
  options: ProcessOptions
): Promise<ProcessResult> {
  const { db, progressTracker, limit, dryRun, skipExisting } = options;

  console.log("• Processing related provisions...");

  if (skipExisting) {
    await ensureProgressSynced(db, progressTracker, "related_provisions");
  }

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalItems = 0;
  const errors: ProcessError[] = [];

  // Process act related provisions
  const [{ count: actRelatedCount }] = await db
    .select({ count: count() })
    .from(acts)
    .where(
      sql`${acts.relatedProvisions} IS NOT NULL AND jsonb_array_length(${acts.relatedProvisions}) > 0`
    );

  const actLimit = limit ? Math.min(limit, actRelatedCount) : actRelatedCount;
  console.log(`   Found ${actLimit} acts with related provisions`);

  for (let offset = 0; offset < actLimit; offset += DB_FETCH_BATCH_SIZE) {
    const batchLimit = Math.min(DB_FETCH_BATCH_SIZE, actLimit - offset);

    const batchActs = await db
      .select()
      .from(acts)
      .where(
        sql`${acts.relatedProvisions} IS NOT NULL AND jsonb_array_length(${acts.relatedProvisions}) > 0`
      )
      .orderBy(acts.actId)
      .limit(batchLimit)
      .offset(offset);

    const batchChunks: ChunkData[] = [];

    for (const act of batchActs) {
      const lang = validateLanguage(act.language);
      if (!lang) {
        errors.push({
          itemType: "related_provisions",
          itemId: `act:${act.actId}`,
          message: `Invalid language "${act.language}"`,
          retryable: false,
        });
        continue;
      }

      const provisions = act.relatedProvisions ?? [];
      for (let i = 0; i < provisions.length; i++) {
        const provision = provisions[i];
        const resourceKey = buildResourceKey(
          "related_provisions",
          `act:${act.actId}:${i}`,
          lang,
          0
        );
        batchChunks.push({
          content: buildRelatedProvisionContent(provision, act.title, lang),
          chunkIndex: 0,
          totalChunks: 1,
          resourceKey,
          metadata: {
            sourceType: "related_provisions",
            language: lang,
            actId: act.actId,
            documentTitle: act.title,
            relatedProvisionLabel: provision.label,
            relatedProvisionSource: provision.source,
            relatedProvisionSections: provision.sections,
            chunkIndex: 0,
          },
        });
      }
      totalItems++;
    }

    const { newChunks, skipped } = filterNewChunks(
      batchChunks,
      progressTracker,
      skipExisting
    );
    const inserted = await insertChunksBatched({
      db,
      chunks: newChunks,
      progressTracker,
      label: "act related provisions",
      dryRun,
    });

    totalInserted += inserted;
    totalSkipped += skipped;
  }

  // Process regulation related provisions
  const [{ count: regRelatedCount }] = await db
    .select({ count: count() })
    .from(regulations)
    .where(
      sql`${regulations.relatedProvisions} IS NOT NULL AND jsonb_array_length(${regulations.relatedProvisions}) > 0`
    );

  const regLimit = limit ? Math.min(limit, regRelatedCount) : regRelatedCount;
  console.log(`   Found ${regLimit} regulations with related provisions`);

  for (let offset = 0; offset < regLimit; offset += DB_FETCH_BATCH_SIZE) {
    const batchLimit = Math.min(DB_FETCH_BATCH_SIZE, regLimit - offset);

    const batchRegs = await db
      .select()
      .from(regulations)
      .where(
        sql`${regulations.relatedProvisions} IS NOT NULL AND jsonb_array_length(${regulations.relatedProvisions}) > 0`
      )
      .orderBy(regulations.regulationId)
      .limit(batchLimit)
      .offset(offset);

    const batchChunks: ChunkData[] = [];

    for (const reg of batchRegs) {
      const lang = validateLanguage(reg.language);
      if (!lang) {
        errors.push({
          itemType: "related_provisions",
          itemId: `reg:${reg.regulationId}`,
          message: `Invalid language "${reg.language}"`,
          retryable: false,
        });
        continue;
      }

      const provisions = reg.relatedProvisions ?? [];
      for (let i = 0; i < provisions.length; i++) {
        const provision = provisions[i];
        const resourceKey = buildResourceKey(
          "related_provisions",
          `reg:${reg.regulationId}:${i}`,
          lang,
          0
        );
        batchChunks.push({
          content: buildRelatedProvisionContent(provision, reg.title, lang),
          chunkIndex: 0,
          totalChunks: 1,
          resourceKey,
          metadata: {
            sourceType: "related_provisions",
            language: lang,
            regulationId: reg.regulationId,
            documentTitle: reg.title,
            relatedProvisionLabel: provision.label,
            relatedProvisionSource: provision.source,
            relatedProvisionSections: provision.sections,
            chunkIndex: 0,
          },
        });
      }
      totalItems++;
    }

    const { newChunks, skipped } = filterNewChunks(
      batchChunks,
      progressTracker,
      skipExisting
    );
    const inserted = await insertChunksBatched({
      db,
      chunks: newChunks,
      progressTracker,
      label: "regulation related provisions",
      dryRun,
    });

    totalInserted += inserted;
    totalSkipped += skipped;
  }

  console.log(
    `   ↳ Related Provisions: ${totalInserted} chunks embedded (${totalSkipped} skipped)`
  );
  if (errors.length > 0) {
    console.log(`   ⚠️  ${errors.length} related provisions had errors`);
  }

  return {
    chunksProcessed: totalInserted,
    chunksSkipped: totalSkipped,
    itemsProcessed: totalItems,
    errors,
  };
}
