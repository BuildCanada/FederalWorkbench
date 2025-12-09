/**
 * Additional content processing for legislation embeddings
 *
 * Handles preambles, treaties, cross-references, table of provisions, signature blocks,
 * and marginal notes. These are supplementary content types that provide important
 * legal context.
 */

import { count, sql } from "drizzle-orm";

import {
  acts,
  crossReferences,
  type FootnoteInfo,
  type PreambleProvision,
  type RegulationPublicationItem,
  type RelatedProvisionInfo,
  regulations,
  type SignatureBlock,
  sections,
  type TableOfProvisionsEntry,
  type TreatyContent,
} from "@/lib/db/legislation/schema";

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

// ---------- Preamble Processing ----------

/**
 * Build searchable content for a preamble provision.
 */
export function buildPreambleContent(
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
        const pairedKey = buildPairedResourceKey(
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
            pairedResourceKey: pairedKey,
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
 * Format a section heading with appropriate indentation based on level.
 * Level 1 = Part (no indent), Level 2 = Chapter/Article (2 spaces), Level 3+ = Sub-section (4 spaces)
 */
function formatSectionHeading(section: {
  level: number;
  label?: string;
  title?: string;
}): string {
  const indent = section.level === 1 ? "" : section.level === 2 ? "  " : "    ";
  const labelPart = section.label ?? "";
  const titlePart = section.title ?? "";

  if (labelPart && titlePart) {
    return `${indent}${labelPart}: ${titlePart}`;
  }
  if (labelPart) {
    return `${indent}${labelPart}`;
  }
  if (titlePart) {
    return `${indent}${titlePart}`;
  }
  return "";
}

/**
 * Build searchable content for a treaty/convention.
 * Includes section headings outline and structured definitions for better discoverability.
 */
export function buildTreatyContent(
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

    // Append section headings outline for navigation/searchability
    if (treaty.sections && treaty.sections.length > 0) {
      parts.push("\n\nStructure du traité:");
      for (const section of treaty.sections) {
        const formatted = formatSectionHeading(section);
        if (formatted) {
          parts.push(formatted);
        }
      }
    }

    parts.push(`\n${treaty.text}`);

    // Append structured definitions for better term discoverability
    if (treaty.definitions && treaty.definitions.length > 0) {
      parts.push("\n\nDéfinitions du traité:");
      for (const def of treaty.definitions) {
        parts.push(`• ${def.term}: ${def.definition}`);
      }
    }
  } else {
    if (treaty.title) {
      parts.push(`Treaty/Convention: ${treaty.title}`);
    }
    parts.push(`Source: ${documentTitle}`);

    // Append section headings outline for navigation/searchability
    if (treaty.sections && treaty.sections.length > 0) {
      parts.push("\n\nTreaty Structure:");
      for (const section of treaty.sections) {
        const formatted = formatSectionHeading(section);
        if (formatted) {
          parts.push(formatted);
        }
      }
    }

    parts.push(`\n${treaty.text}`);

    // Append structured definitions for better term discoverability
    if (treaty.definitions && treaty.definitions.length > 0) {
      parts.push("\n\nTreaty Definitions:");
      for (const def of treaty.definitions) {
        parts.push(`• ${def.term}: ${def.definition}`);
      }
    }
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
        const pairedKey = buildPairedResourceKey(
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
            treatyDefinitionCount: treaty.definitions?.length,
            chunkIndex: 0,
            pairedResourceKey: pairedKey,
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
        const pairedKey = buildPairedResourceKey(
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
            treatyDefinitionCount: treaty.definitions?.length,
            chunkIndex: 0,
            pairedResourceKey: pairedKey,
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
 * Maximum length for target section snippets in cross-references.
 * Keeps embeddings focused while providing useful context.
 */
const TARGET_SNIPPET_MAX_LENGTH = 250;

type CrossRefData = {
  sourceSectionLabel: string | null;
  targetType: string;
  targetRef: string;
  targetSectionRef: string | null;
  referenceText: string | null;
};

/**
 * Extended cross-reference data with resolved target information.
 * Includes target document details and content snippets.
 */
type EnhancedCrossRefData = CrossRefData & {
  // Resolved target identifiers
  targetActId: string | null;
  targetRegulationId: string | null;
  targetSectionId: string | null;
  // Target document info
  targetDocumentTitleEn: string | null;
  targetDocumentTitleFr: string | null;
  // Target section snippet (if targetSectionRef resolved)
  targetSnippetEn: string | null;
  targetSnippetFr: string | null;
  // Target section marginal note for additional context
  targetMarginalNoteEn: string | null;
  targetMarginalNoteFr: string | null;
};

/**
 * Truncate text to a maximum length, breaking at word boundaries.
 */
function truncateSnippet(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  // Find the last space before maxLength
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLength * 0.7) {
    return `${truncated.slice(0, lastSpace)}...`;
  }
  return `${truncated}...`;
}

/**
 * Build searchable content for a cross-reference in English.
 * Enhanced version includes resolved target document title and content snippet.
 */
export function buildCrossRefContentEn(
  ref: EnhancedCrossRefData,
  sourceTitle: string
): string {
  const parts: string[] = [];

  parts.push("Cross-reference");
  parts.push(`Source: ${sourceTitle}`);
  if (ref.sourceSectionLabel) {
    parts.push(`Source section: ${ref.sourceSectionLabel}`);
  }

  const targetTypeLabel = ref.targetType === "act" ? "Act" : "Regulation";
  parts.push(`Target type: ${targetTypeLabel}`);
  parts.push(`Reference: ${ref.targetRef}`);

  // Include resolved target document title
  if (ref.targetDocumentTitleEn) {
    parts.push(`Target document: ${ref.targetDocumentTitleEn}`);
  }

  if (ref.targetSectionRef) {
    parts.push(`Target section: ${ref.targetSectionRef}`);
  }

  // Include target marginal note for context
  if (ref.targetMarginalNoteEn) {
    parts.push(`Target heading: ${ref.targetMarginalNoteEn}`);
  }

  if (ref.referenceText) {
    parts.push(`Text: ${ref.referenceText}`);
  }

  // Include target content snippet for semantic search
  if (ref.targetSnippetEn) {
    parts.push(`\nTarget content: ${ref.targetSnippetEn}`);
  }

  return parts.join("\n");
}

/**
 * Build searchable content for a cross-reference in French.
 * Enhanced version includes resolved target document title and content snippet.
 */
export function buildCrossRefContentFr(
  ref: EnhancedCrossRefData,
  sourceTitle: string
): string {
  const parts: string[] = [];

  parts.push("Référence croisée");
  parts.push(`Source: ${sourceTitle}`);
  if (ref.sourceSectionLabel) {
    parts.push(`Article source: ${ref.sourceSectionLabel}`);
  }

  const targetTypeLabel = ref.targetType === "act" ? "Loi" : "Règlement";
  parts.push(`Type de cible: ${targetTypeLabel}`);
  parts.push(`Référence: ${ref.targetRef}`);

  // Include resolved target document title
  if (ref.targetDocumentTitleFr) {
    parts.push(`Document cible: ${ref.targetDocumentTitleFr}`);
  }

  if (ref.targetSectionRef) {
    parts.push(`Article cible: ${ref.targetSectionRef}`);
  }

  // Include target marginal note for context
  if (ref.targetMarginalNoteFr) {
    parts.push(`Rubrique cible: ${ref.targetMarginalNoteFr}`);
  }

  if (ref.referenceText) {
    parts.push(`Texte: ${ref.referenceText}`);
  }

  // Include target content snippet for semantic search
  if (ref.targetSnippetFr) {
    parts.push(`\nContenu cible: ${ref.targetSnippetFr}`);
  }

  return parts.join("\n");
}

/**
 * Process cross-references with enhanced target resolution.
 *
 * This function resolves target references to actual documents and sections,
 * fetching snippets of target content to include in embeddings. This enables:
 * - Searches for "section 91 Criminal Code" to surface cross-references citing s.91
 * - Bidirectional discovery (find what cites X, find what X cites)
 */
export async function processCrossReferences(
  options: ProcessOptions
): Promise<ProcessResult> {
  const { db, progressTracker, limit, dryRun, skipExisting } = options;

  console.log("• Processing cross-references (with target resolution)...");

  if (skipExisting) {
    await ensureProgressSynced(db, progressTracker, "cross_reference");
  }

  const [{ count: totalCountRaw }] = await db
    .select({ count: count() })
    .from(crossReferences);

  const totalCount = limit ? Math.min(limit, totalCountRaw) : totalCountRaw;
  // Each cross-reference produces 2 chunks (EN and FR)
  const expectedChunks = totalCount * 2;
  console.log(
    `   Found ${totalCount} cross-references (${expectedChunks} chunks: EN + FR)`
  );

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

    // Enhanced query: fetch cross-references with both source AND target information
    // Uses subqueries to resolve target documents and sections
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

        // Source document titles (existing logic)
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

        // Target document titles (NEW: resolved from targetRef based on targetType)
        targetDocTitleEn: sql<string>`CASE
          WHEN ${crossReferences.targetType} = 'act' THEN
            (SELECT title FROM legislation.acts WHERE act_id = ${crossReferences.targetRef} AND language = 'en' LIMIT 1)
          WHEN ${crossReferences.targetType} = 'regulation' THEN
            (SELECT title FROM legislation.regulations WHERE regulation_id = ${crossReferences.targetRef} AND language = 'en' LIMIT 1)
          ELSE NULL
        END`.as("target_doc_title_en"),
        targetDocTitleFr: sql<string>`CASE
          WHEN ${crossReferences.targetType} = 'act' THEN
            (SELECT title FROM legislation.acts WHERE act_id = ${crossReferences.targetRef} AND language = 'fr' LIMIT 1)
          WHEN ${crossReferences.targetType} = 'regulation' THEN
            (SELECT title FROM legislation.regulations WHERE regulation_id = ${crossReferences.targetRef} AND language = 'fr' LIMIT 1)
          ELSE NULL
        END`.as("target_doc_title_fr"),

        // Target section content snippets (NEW: if targetSectionRef is provided)
        targetSnippetEn: sql<string>`CASE
          WHEN ${crossReferences.targetSectionRef} IS NOT NULL AND ${crossReferences.targetType} = 'act' THEN
            (SELECT SUBSTRING(content, 1, 500) FROM legislation.sections
             WHERE act_id = ${crossReferences.targetRef}
               AND section_label = ${crossReferences.targetSectionRef}
               AND language = 'en' LIMIT 1)
          WHEN ${crossReferences.targetSectionRef} IS NOT NULL AND ${crossReferences.targetType} = 'regulation' THEN
            (SELECT SUBSTRING(content, 1, 500) FROM legislation.sections
             WHERE regulation_id = ${crossReferences.targetRef}
               AND section_label = ${crossReferences.targetSectionRef}
               AND language = 'en' LIMIT 1)
          ELSE NULL
        END`.as("target_snippet_en"),
        targetSnippetFr: sql<string>`CASE
          WHEN ${crossReferences.targetSectionRef} IS NOT NULL AND ${crossReferences.targetType} = 'act' THEN
            (SELECT SUBSTRING(content, 1, 500) FROM legislation.sections
             WHERE act_id = ${crossReferences.targetRef}
               AND section_label = ${crossReferences.targetSectionRef}
               AND language = 'fr' LIMIT 1)
          WHEN ${crossReferences.targetSectionRef} IS NOT NULL AND ${crossReferences.targetType} = 'regulation' THEN
            (SELECT SUBSTRING(content, 1, 500) FROM legislation.sections
             WHERE regulation_id = ${crossReferences.targetRef}
               AND section_label = ${crossReferences.targetSectionRef}
               AND language = 'fr' LIMIT 1)
          ELSE NULL
        END`.as("target_snippet_fr"),

        // Target section marginal notes (NEW: for additional context)
        targetMarginalNoteEn: sql<string>`CASE
          WHEN ${crossReferences.targetSectionRef} IS NOT NULL AND ${crossReferences.targetType} = 'act' THEN
            (SELECT marginal_note FROM legislation.sections
             WHERE act_id = ${crossReferences.targetRef}
               AND section_label = ${crossReferences.targetSectionRef}
               AND language = 'en' LIMIT 1)
          WHEN ${crossReferences.targetSectionRef} IS NOT NULL AND ${crossReferences.targetType} = 'regulation' THEN
            (SELECT marginal_note FROM legislation.sections
             WHERE regulation_id = ${crossReferences.targetRef}
               AND section_label = ${crossReferences.targetSectionRef}
               AND language = 'en' LIMIT 1)
          ELSE NULL
        END`.as("target_marginal_note_en"),
        targetMarginalNoteFr: sql<string>`CASE
          WHEN ${crossReferences.targetSectionRef} IS NOT NULL AND ${crossReferences.targetType} = 'act' THEN
            (SELECT marginal_note FROM legislation.sections
             WHERE act_id = ${crossReferences.targetRef}
               AND section_label = ${crossReferences.targetSectionRef}
               AND language = 'fr' LIMIT 1)
          WHEN ${crossReferences.targetSectionRef} IS NOT NULL AND ${crossReferences.targetType} = 'regulation' THEN
            (SELECT marginal_note FROM legislation.sections
             WHERE regulation_id = ${crossReferences.targetRef}
               AND section_label = ${crossReferences.targetSectionRef}
               AND language = 'fr' LIMIT 1)
          ELSE NULL
        END`.as("target_marginal_note_fr"),

        // Target section IDs (NEW: for bidirectional lookup)
        targetSectionIdEn: sql<string>`CASE
          WHEN ${crossReferences.targetSectionRef} IS NOT NULL AND ${crossReferences.targetType} = 'act' THEN
            (SELECT id FROM legislation.sections
             WHERE act_id = ${crossReferences.targetRef}
               AND section_label = ${crossReferences.targetSectionRef}
               AND language = 'en' LIMIT 1)
          WHEN ${crossReferences.targetSectionRef} IS NOT NULL AND ${crossReferences.targetType} = 'regulation' THEN
            (SELECT id FROM legislation.sections
             WHERE regulation_id = ${crossReferences.targetRef}
               AND section_label = ${crossReferences.targetSectionRef}
               AND language = 'en' LIMIT 1)
          ELSE NULL
        END`.as("target_section_id_en"),
      })
      .from(crossReferences)
      .orderBy(crossReferences.id)
      .limit(batchLimit)
      .offset(offset);

    const batchChunks: ChunkData[] = [];

    // Process each cross-reference, creating EN and FR chunks with enhanced data
    for (const ref of batchRefs) {
      logProgress(offset + totalItems + 1, totalCount, "Cross-refs");

      const sourceTitleEn = ref.sourceTitleEn ?? "Unknown Document";
      const sourceTitleFr = ref.sourceTitleFr ?? "Document inconnu";

      // Build enhanced cross-reference data with resolved targets
      const enhancedRef: EnhancedCrossRefData = {
        sourceSectionLabel: ref.sourceSectionLabel,
        targetType: ref.targetType,
        targetRef: ref.targetRef,
        targetSectionRef: ref.targetSectionRef,
        referenceText: ref.referenceText,
        // Resolved target identifiers
        targetActId: ref.targetType === "act" ? ref.targetRef : null,
        targetRegulationId:
          ref.targetType === "regulation" ? ref.targetRef : null,
        targetSectionId: ref.targetSectionIdEn ?? null,
        // Target document info
        targetDocumentTitleEn: ref.targetDocTitleEn ?? null,
        targetDocumentTitleFr: ref.targetDocTitleFr ?? null,
        // Target section content (truncated for embedding)
        targetSnippetEn: ref.targetSnippetEn
          ? truncateSnippet(ref.targetSnippetEn, TARGET_SNIPPET_MAX_LENGTH)
          : null,
        targetSnippetFr: ref.targetSnippetFr
          ? truncateSnippet(ref.targetSnippetFr, TARGET_SNIPPET_MAX_LENGTH)
          : null,
        // Target section headings
        targetMarginalNoteEn: ref.targetMarginalNoteEn ?? null,
        targetMarginalNoteFr: ref.targetMarginalNoteFr ?? null,
      };

      // Create English chunk with enhanced content and metadata
      const resourceKeyEn = buildResourceKey(
        "cross_reference",
        ref.id,
        "en",
        0
      );
      const pairedKeyEn = buildPairedResourceKey(
        "cross_reference",
        ref.id,
        "en",
        0
      );
      batchChunks.push({
        content: buildCrossRefContentEn(enhancedRef, sourceTitleEn),
        chunkIndex: 0,
        totalChunks: 1,
        resourceKey: resourceKeyEn,
        metadata: {
          sourceType: "cross_reference",
          language: "en",
          crossRefId: ref.id,
          actId: ref.sourceActId ?? undefined,
          regulationId: ref.sourceRegulationId ?? undefined,
          documentTitle: sourceTitleEn,
          sectionLabel: ref.sourceSectionLabel ?? undefined,
          targetType: ref.targetType,
          targetRef: ref.targetRef,
          targetSectionRef: ref.targetSectionRef ?? undefined,
          referenceText: ref.referenceText ?? undefined,
          // Enhanced target fields (Task 2.1)
          targetActId: enhancedRef.targetActId ?? undefined,
          targetRegulationId: enhancedRef.targetRegulationId ?? undefined,
          targetSectionId: enhancedRef.targetSectionId ?? undefined,
          targetDocumentTitle: enhancedRef.targetDocumentTitleEn ?? undefined,
          targetSnippet: enhancedRef.targetSnippetEn ?? undefined,
          chunkIndex: 0,
          pairedResourceKey: pairedKeyEn,
        },
      });

      // Create French chunk with enhanced content and metadata
      const resourceKeyFr = buildResourceKey(
        "cross_reference",
        ref.id,
        "fr",
        0
      );
      const pairedKeyFr = buildPairedResourceKey(
        "cross_reference",
        ref.id,
        "fr",
        0
      );
      batchChunks.push({
        content: buildCrossRefContentFr(enhancedRef, sourceTitleFr),
        chunkIndex: 0,
        totalChunks: 1,
        resourceKey: resourceKeyFr,
        metadata: {
          sourceType: "cross_reference",
          language: "fr",
          crossRefId: ref.id,
          actId: ref.sourceActId ?? undefined,
          regulationId: ref.sourceRegulationId ?? undefined,
          documentTitle: sourceTitleFr,
          sectionLabel: ref.sourceSectionLabel ?? undefined,
          targetType: ref.targetType,
          targetRef: ref.targetRef,
          targetSectionRef: ref.targetSectionRef ?? undefined,
          referenceText: ref.referenceText ?? undefined,
          // Enhanced target fields (Task 2.1)
          targetActId: enhancedRef.targetActId ?? undefined,
          targetRegulationId: enhancedRef.targetRegulationId ?? undefined,
          targetSectionId: enhancedRef.targetSectionId ?? undefined,
          targetDocumentTitle: enhancedRef.targetDocumentTitleFr ?? undefined,
          targetSnippet: enhancedRef.targetSnippetFr ?? undefined,
          chunkIndex: 0,
          pairedResourceKey: pairedKeyFr,
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
 * Build searchable content for an entire table of provisions (batched).
 *
 * Instead of creating one embedding per entry (which can be 100+ per document),
 * we batch all entries into a single hierarchical outline per document.
 * This reduces embedding count while maintaining searchability for document structure.
 */
export function buildBatchedProvisionContent(
  provisions: TableOfProvisionsEntry[],
  documentTitle: string,
  language: "en" | "fr"
): string {
  const parts: string[] = [];

  // Header
  if (language === "fr") {
    parts.push(`Table des dispositions de: ${documentTitle}`);
    parts.push("");
  } else {
    parts.push(`Table of Provisions of: ${documentTitle}`);
    parts.push("");
  }

  // Build hierarchical outline of all entries
  for (const provision of provisions) {
    const levelPrefix = "  ".repeat(provision.level);
    parts.push(`${levelPrefix}${provision.label}: ${provision.title}`);
  }

  return parts.join("\n");
}

/**
 * Process table of provisions from acts and regulations.
 *
 * OPTIMIZATION: Batches all ToP entries per document into a single embedding.
 * This reduces embedding count from potentially 100+ per document to just 1,
 * while maintaining the full hierarchical structure for search.
 */
export async function processTableOfProvisions(
  options: ProcessOptions
): Promise<ProcessResult> {
  const { db, progressTracker, limit, dryRun, skipExisting } = options;

  console.log("• Processing table of provisions (batched per document)...");

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
      if (provisions.length === 0) {
        continue;
      }

      // Create ONE embedding per document with all ToP entries batched
      const resourceKey = buildResourceKey(
        "table_of_provisions",
        `act:${act.actId}`,
        lang,
        0
      );
      const pairedKey = buildPairedResourceKey(
        "table_of_provisions",
        `act:${act.actId}`,
        lang,
        0
      );
      batchChunks.push({
        content: buildBatchedProvisionContent(provisions, act.title, lang),
        chunkIndex: 0,
        totalChunks: 1,
        resourceKey,
        metadata: {
          sourceType: "table_of_provisions",
          language: lang,
          actId: act.actId,
          documentTitle: act.title,
          provisionCount: provisions.length,
          chunkIndex: 0,
          pairedResourceKey: pairedKey,
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
      if (provisions.length === 0) {
        continue;
      }

      // Create ONE embedding per document with all ToP entries batched
      const resourceKey = buildResourceKey(
        "table_of_provisions",
        `reg:${reg.regulationId}`,
        lang,
        0
      );
      const pairedKey = buildPairedResourceKey(
        "table_of_provisions",
        `reg:${reg.regulationId}`,
        lang,
        0
      );
      batchChunks.push({
        content: buildBatchedProvisionContent(provisions, reg.title, lang),
        chunkIndex: 0,
        totalChunks: 1,
        resourceKey,
        metadata: {
          sourceType: "table_of_provisions",
          language: lang,
          regulationId: reg.regulationId,
          documentTitle: reg.title,
          provisionCount: provisions.length,
          chunkIndex: 0,
          pairedResourceKey: pairedKey,
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
      label: "regulation table of provisions",
      dryRun,
    });

    totalInserted += inserted;
    totalSkipped += skipped;
  }

  console.log(
    `   ↳ Table of Provisions: ${totalInserted} documents embedded (${totalSkipped} skipped)`
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
        const pairedKey = buildPairedResourceKey(
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
            pairedResourceKey: pairedKey,
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
        const pairedKey = buildPairedResourceKey(
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
            pairedResourceKey: pairedKey,
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
        const pairedKey = buildPairedResourceKey(
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
            pairedResourceKey: pairedKey,
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
        const pairedKey = buildPairedResourceKey(
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
            pairedResourceKey: pairedKey,
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

// ---------- Footnote Processing ----------

/**
 * Build searchable content for a footnote.
 */
export function buildFootnoteContent(
  footnote: FootnoteInfo,
  sectionLabel: string,
  documentTitle: string,
  language: "en" | "fr"
): string {
  const parts: string[] = [];

  if (language === "fr") {
    parts.push(`Note de bas de page de: ${documentTitle}`);
    parts.push(`Article: ${sectionLabel}`);
    if (footnote.label) {
      parts.push(`Étiquette: ${footnote.label}`);
    }
    if (footnote.status) {
      const statusFr =
        footnote.status === "editorial" ? "éditoriale" : "officielle";
      parts.push(`Type: ${statusFr}`);
    }
    parts.push(`\n${footnote.text}`);
  } else {
    parts.push(`Footnote from: ${documentTitle}`);
    parts.push(`Section: ${sectionLabel}`);
    if (footnote.label) {
      parts.push(`Label: ${footnote.label}`);
    }
    if (footnote.status) {
      parts.push(`Type: ${footnote.status}`);
    }
    parts.push(`\n${footnote.text}`);
  }

  return parts.join("\n");
}

/**
 * Process footnotes from sections.
 * Footnotes are stored on sections, so we query sections with footnotes.
 */
export async function processFootnotes(
  options: ProcessOptions
): Promise<ProcessResult> {
  const { db, progressTracker, limit, dryRun, skipExisting } = options;

  console.log("• Processing footnotes...");

  if (skipExisting) {
    await ensureProgressSynced(db, progressTracker, "footnote");
  }

  // Count sections with footnotes
  const [{ count: totalCountRaw }] = await db
    .select({ count: count() })
    .from(sections)
    .where(
      sql`${sections.footnotes} IS NOT NULL AND jsonb_array_length(${sections.footnotes}) > 0`
    );

  const totalCount = limit ? Math.min(limit, totalCountRaw) : totalCountRaw;
  console.log(`   Found ${totalCount} sections with footnotes`);

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
    console.log(`   📥 Fetching footnote batch ${batchNum}/${totalBatches}...`);

    // Fetch sections with footnotes, including document title via subquery
    const batchSections = await db
      .select({
        id: sections.id,
        actId: sections.actId,
        regulationId: sections.regulationId,
        sectionLabel: sections.sectionLabel,
        language: sections.language,
        footnotes: sections.footnotes,
        // Get document title via COALESCE subquery
        documentTitle: sql<string>`COALESCE(
          (SELECT title FROM legislation.acts WHERE act_id = ${sections.actId} AND language = ${sections.language} LIMIT 1),
          (SELECT title FROM legislation.regulations WHERE regulation_id = ${sections.regulationId} AND language = ${sections.language} LIMIT 1),
          'Unknown Document'
        )`.as("document_title"),
      })
      .from(sections)
      .where(
        sql`${sections.footnotes} IS NOT NULL AND jsonb_array_length(${sections.footnotes}) > 0`
      )
      .orderBy(sections.id)
      .limit(batchLimit)
      .offset(offset);

    const batchChunks: ChunkData[] = [];

    for (const section of batchSections) {
      const lang = validateLanguage(section.language);
      if (!lang) {
        errors.push({
          itemType: "footnote",
          itemId: `section:${section.id}`,
          message: `Invalid language "${section.language}"`,
          retryable: false,
        });
        continue;
      }

      const footnoteList = section.footnotes ?? [];
      for (let fnIdx = 0; fnIdx < footnoteList.length; fnIdx++) {
        const footnote = footnoteList[fnIdx];
        logProgress(offset + totalItems + 1, totalCount, "Footnotes");

        // Include array index in key to handle sections with duplicate footnote IDs
        const resourceKey = buildResourceKey(
          "footnote",
          `${section.id}:${footnote.id}:${fnIdx}`,
          lang,
          0
        );
        const pairedKey = buildPairedResourceKey(
          "footnote",
          `${section.id}:${footnote.id}:${fnIdx}`,
          lang,
          0
        );

        batchChunks.push({
          content: buildFootnoteContent(
            footnote,
            section.sectionLabel,
            section.documentTitle ?? "Unknown Document",
            lang
          ),
          chunkIndex: 0,
          totalChunks: 1,
          resourceKey,
          metadata: {
            sourceType: "footnote",
            language: lang,
            actId: section.actId ?? undefined,
            regulationId: section.regulationId ?? undefined,
            sectionId: section.id,
            sectionLabel: section.sectionLabel,
            documentTitle: section.documentTitle ?? "Unknown Document",
            footnoteId: footnote.id,
            footnoteLabel: footnote.label ?? undefined,
            footnotePlacement: footnote.placement ?? undefined,
            footnoteStatus: footnote.status ?? undefined,
            chunkIndex: 0,
            pairedResourceKey: pairedKey,
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
      label: `footnotes batch ${batchNum}`,
      dryRun,
    });

    totalInserted += inserted;
    totalSkipped += skipped;
  }

  console.log(
    `   ↳ Footnotes: ${totalInserted} chunks embedded (${totalSkipped} skipped)`
  );
  if (errors.length > 0) {
    console.log(`   ⚠️  ${errors.length} sections with footnotes had errors`);
  }

  return {
    chunksProcessed: totalInserted,
    chunksSkipped: totalSkipped,
    itemsProcessed: totalItems,
    errors,
  };
}

// ---------- Marginal Note Processing ----------

/**
 * Build searchable content for a marginal note (section heading).
 * Creates a lightweight embedding that surfaces sections by their descriptive headings.
 */
export function buildMarginalNoteContent(
  marginalNote: string,
  sectionLabel: string,
  documentTitle: string,
  language: "en" | "fr"
): string {
  const parts: string[] = [];

  if (language === "fr") {
    parts.push(`Note marginale: ${marginalNote}`);
    parts.push(`Loi/Règlement: ${documentTitle}`);
    parts.push(`Article: ${sectionLabel}`);
  } else {
    parts.push(`Marginal Note: ${marginalNote}`);
    parts.push(`Act/Regulation: ${documentTitle}`);
    parts.push(`Section: ${sectionLabel}`);
  }

  return parts.join("\n");
}

/**
 * Process marginal notes from sections.
 *
 * Creates lightweight embeddings for section headings to improve discoverability.
 * Users searching for terms like "theft" will find relevant sections even if
 * the marginal note isn't within the main content window.
 */
export async function processMarginalNotes(
  options: ProcessOptions
): Promise<ProcessResult> {
  const { db, progressTracker, limit, dryRun, skipExisting } = options;

  console.log("• Processing marginal notes...");

  if (skipExisting) {
    await ensureProgressSynced(db, progressTracker, "marginal_note");
  }

  // Count sections with non-empty marginal notes
  const [{ count: totalCountRaw }] = await db
    .select({ count: count() })
    .from(sections)
    .where(
      sql`${sections.marginalNote} IS NOT NULL AND ${sections.marginalNote} != ''`
    );

  const totalCount = limit ? Math.min(limit, totalCountRaw) : totalCountRaw;
  console.log(`   Found ${totalCount} sections with marginal notes`);

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
      `   📥 Fetching marginal notes batch ${batchNum}/${totalBatches}...`
    );

    // Fetch sections with marginal notes, including document title via subquery
    const batchSections = await db
      .select({
        id: sections.id,
        actId: sections.actId,
        regulationId: sections.regulationId,
        sectionLabel: sections.sectionLabel,
        language: sections.language,
        marginalNote: sections.marginalNote,
        sectionType: sections.sectionType,
        hierarchyPath: sections.hierarchyPath,
        status: sections.status,
        // Get document title via COALESCE subquery
        documentTitle: sql<string>`COALESCE(
          (SELECT title FROM legislation.acts WHERE act_id = ${sections.actId} AND language = ${sections.language} LIMIT 1),
          (SELECT title FROM legislation.regulations WHERE regulation_id = ${sections.regulationId} AND language = ${sections.language} LIMIT 1),
          'Unknown Document'
        )`.as("document_title"),
      })
      .from(sections)
      .where(
        sql`${sections.marginalNote} IS NOT NULL AND ${sections.marginalNote} != ''`
      )
      .orderBy(sections.id)
      .limit(batchLimit)
      .offset(offset);

    const batchChunks: ChunkData[] = [];

    for (const section of batchSections) {
      const lang = validateLanguage(section.language);
      if (!lang) {
        errors.push({
          itemType: "marginal_note",
          itemId: `section:${section.id}`,
          message: `Invalid language "${section.language}"`,
          retryable: false,
        });
        continue;
      }

      // Skip sections without marginal notes (shouldn't happen due to WHERE clause)
      if (!section.marginalNote) {
        continue;
      }

      logProgress(offset + totalItems + 1, totalCount, "Marginal notes");

      const resourceKey = buildResourceKey(
        "marginal_note",
        section.id,
        lang,
        0
      );
      const pairedKey = buildPairedResourceKey(
        "marginal_note",
        section.id,
        lang,
        0
      );

      batchChunks.push({
        content: buildMarginalNoteContent(
          section.marginalNote,
          section.sectionLabel,
          section.documentTitle ?? "Unknown Document",
          lang
        ),
        chunkIndex: 0,
        totalChunks: 1,
        resourceKey,
        metadata: {
          sourceType: "marginal_note",
          language: lang,
          actId: section.actId ?? undefined,
          regulationId: section.regulationId ?? undefined,
          sectionId: section.id,
          sectionLabel: section.sectionLabel,
          marginalNote: section.marginalNote,
          documentTitle: section.documentTitle ?? "Unknown Document",
          sectionType: section.sectionType ?? undefined,
          hierarchyPath: section.hierarchyPath ?? undefined,
          sectionStatus: section.status ?? undefined,
          chunkIndex: 0,
          pairedResourceKey: pairedKey,
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
      label: `marginal notes batch ${batchNum}`,
      dryRun,
    });

    totalInserted += inserted;
    totalSkipped += skipped;
  }

  console.log(
    `   ↳ Marginal Notes: ${totalInserted} chunks embedded (${totalSkipped} skipped)`
  );
  if (errors.length > 0) {
    console.log(
      `   ⚠️  ${errors.length} sections with marginal notes had errors`
    );
  }

  return {
    chunksProcessed: totalInserted,
    chunksSkipped: totalSkipped,
    itemsProcessed: totalItems,
    errors,
  };
}

// ---------- Publication Item Processing (Recommendations/Notices) ----------

/**
 * Build searchable content for a publication item (recommendation or notice).
 * These are found in regulations and contain important publication metadata.
 */
export function buildPublicationItemContent(
  item: RegulationPublicationItem,
  _index: number,
  documentTitle: string,
  language: "en" | "fr"
): string {
  const parts: string[] = [];

  if (language === "fr") {
    const typeLabel =
      item.type === "recommendation" ? "Recommandation" : "Avis";
    parts.push(`${typeLabel} de: ${documentTitle}`);
    if (item.publicationRequirement) {
      const reqLabel =
        item.publicationRequirement === "STATUTORY"
          ? "Exigence légale"
          : "Exigence administrative";
      parts.push(`Type de publication: ${reqLabel}`);
    }
    if (item.sourceSections?.length) {
      parts.push(`Articles sources: ${item.sourceSections.join(", ")}`);
    }
    parts.push(`\n${item.content}`);
  } else {
    const typeLabel =
      item.type === "recommendation" ? "Recommendation" : "Notice";
    parts.push(`${typeLabel} from: ${documentTitle}`);
    if (item.publicationRequirement) {
      const reqLabel =
        item.publicationRequirement === "STATUTORY"
          ? "Statutory requirement"
          : "Administrative requirement";
      parts.push(`Publication type: ${reqLabel}`);
    }
    if (item.sourceSections?.length) {
      parts.push(`Source sections: ${item.sourceSections.join(", ")}`);
    }
    parts.push(`\n${item.content}`);
  }

  return parts.join("\n");
}

/**
 * Process publication items (recommendations and notices) from regulations.
 * These are important blocks that contain regulatory impact statements,
 * consultation summaries, and administrative notices.
 */
export async function processPublicationItems(
  options: ProcessOptions
): Promise<ProcessResult> {
  const { db, progressTracker, limit, dryRun, skipExisting } = options;

  console.log("• Processing publication items (recommendations/notices)...");

  if (skipExisting) {
    await ensureProgressSynced(db, progressTracker, "publication_item");
  }

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalItems = 0;
  const errors: ProcessError[] = [];

  // Process recommendations
  const [{ count: recCount }] = await db
    .select({ count: count() })
    .from(regulations)
    .where(
      sql`${regulations.recommendations} IS NOT NULL AND jsonb_array_length(${regulations.recommendations}) > 0`
    );

  const recLimit = limit ? Math.min(limit, recCount) : recCount;
  console.log(`   Found ${recLimit} regulations with recommendations`);

  for (let offset = 0; offset < recLimit; offset += DB_FETCH_BATCH_SIZE) {
    const batchLimit = Math.min(DB_FETCH_BATCH_SIZE, recLimit - offset);
    const batchNum = Math.floor(offset / DB_FETCH_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(recLimit / DB_FETCH_BATCH_SIZE);
    console.log(
      `   📥 Fetching recommendations batch ${batchNum}/${totalBatches}...`
    );

    const batchRegs = await db
      .select()
      .from(regulations)
      .where(
        sql`${regulations.recommendations} IS NOT NULL AND jsonb_array_length(${regulations.recommendations}) > 0`
      )
      .orderBy(regulations.regulationId)
      .limit(batchLimit)
      .offset(offset);

    const batchChunks: ChunkData[] = [];

    for (const reg of batchRegs) {
      const lang = validateLanguage(reg.language);
      if (!lang) {
        errors.push({
          itemType: "publication_item",
          itemId: `reg:${reg.regulationId}:recommendations`,
          message: `Invalid language "${reg.language}"`,
          retryable: false,
        });
        continue;
      }

      const recommendations = reg.recommendations ?? [];
      for (let i = 0; i < recommendations.length; i++) {
        const item = recommendations[i];
        logProgress(offset + totalItems + 1, recLimit, "Recommendations");

        const resourceKey = buildResourceKey(
          "publication_item",
          `rec:${reg.regulationId}:${i}`,
          lang,
          0
        );
        const pairedKey = buildPairedResourceKey(
          "publication_item",
          `rec:${reg.regulationId}:${i}`,
          lang,
          0
        );

        batchChunks.push({
          content: buildPublicationItemContent(item, i, reg.title, lang),
          chunkIndex: 0,
          totalChunks: 1,
          resourceKey,
          metadata: {
            sourceType: "publication_item",
            language: lang,
            regulationId: reg.regulationId,
            documentTitle: reg.title,
            publicationType: "recommendation",
            publicationRequirement: item.publicationRequirement,
            publicationSourceSections: item.sourceSections,
            publicationIndex: i,
            chunkIndex: 0,
            pairedResourceKey: pairedKey,
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
      label: `recommendations batch ${batchNum}`,
      dryRun,
    });

    totalInserted += inserted;
    totalSkipped += skipped;
  }

  // Process notices
  const [{ count: noticeCount }] = await db
    .select({ count: count() })
    .from(regulations)
    .where(
      sql`${regulations.notices} IS NOT NULL AND jsonb_array_length(${regulations.notices}) > 0`
    );

  const noticeLimit = limit ? Math.min(limit, noticeCount) : noticeCount;
  console.log(`   Found ${noticeLimit} regulations with notices`);

  for (let offset = 0; offset < noticeLimit; offset += DB_FETCH_BATCH_SIZE) {
    const batchLimit = Math.min(DB_FETCH_BATCH_SIZE, noticeLimit - offset);
    const batchNum = Math.floor(offset / DB_FETCH_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(noticeLimit / DB_FETCH_BATCH_SIZE);
    console.log(`   📥 Fetching notices batch ${batchNum}/${totalBatches}...`);

    const batchRegs = await db
      .select()
      .from(regulations)
      .where(
        sql`${regulations.notices} IS NOT NULL AND jsonb_array_length(${regulations.notices}) > 0`
      )
      .orderBy(regulations.regulationId)
      .limit(batchLimit)
      .offset(offset);

    const batchChunks: ChunkData[] = [];

    for (const reg of batchRegs) {
      const lang = validateLanguage(reg.language);
      if (!lang) {
        errors.push({
          itemType: "publication_item",
          itemId: `reg:${reg.regulationId}:notices`,
          message: `Invalid language "${reg.language}"`,
          retryable: false,
        });
        continue;
      }

      const notices = reg.notices ?? [];
      for (let i = 0; i < notices.length; i++) {
        const item = notices[i];
        logProgress(offset + totalItems + 1, noticeLimit, "Notices");

        const resourceKey = buildResourceKey(
          "publication_item",
          `notice:${reg.regulationId}:${i}`,
          lang,
          0
        );
        const pairedKey = buildPairedResourceKey(
          "publication_item",
          `notice:${reg.regulationId}:${i}`,
          lang,
          0
        );

        batchChunks.push({
          content: buildPublicationItemContent(item, i, reg.title, lang),
          chunkIndex: 0,
          totalChunks: 1,
          resourceKey,
          metadata: {
            sourceType: "publication_item",
            language: lang,
            regulationId: reg.regulationId,
            documentTitle: reg.title,
            publicationType: "notice",
            publicationRequirement: item.publicationRequirement,
            publicationSourceSections: item.sourceSections,
            publicationIndex: i,
            chunkIndex: 0,
            pairedResourceKey: pairedKey,
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
      label: `notices batch ${batchNum}`,
      dryRun,
    });

    totalInserted += inserted;
    totalSkipped += skipped;
  }

  console.log(
    `   ↳ Publication Items: ${totalInserted} chunks embedded (${totalSkipped} skipped)`
  );
  if (errors.length > 0) {
    console.log(`   ⚠️  ${errors.length} publication items had errors`);
  }

  return {
    chunksProcessed: totalInserted,
    chunksSkipped: totalSkipped,
    itemsProcessed: totalItems,
    errors,
  };
}
