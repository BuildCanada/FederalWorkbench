/**
 * Defined term processing for legislation embeddings
 *
 * Processes defined terms from acts and regulations, generating embeddings for
 * semantic search on legal terminology. Uses streaming/batching to avoid OOM.
 */

import { and, count, eq, sql } from "drizzle-orm";

import {
  acts,
  type DefinedTerm,
  definedTerms,
  regulations,
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

/**
 * Build searchable text content for a defined term.
 * Includes term, definition, and source context for better retrieval.
 */
export function buildTermContent(
  term: DefinedTerm,
  documentTitle: string
): string {
  const lang = validateLanguage(term.language);
  const parts: string[] = [];

  if (lang === "fr") {
    parts.push(`Terme défini: ${term.term}`);
    if (term.pairedTerm) {
      parts.push(`Terme anglais: ${term.pairedTerm}`);
    }
    parts.push(`Source: ${documentTitle}`);
    if (term.sectionLabel) {
      parts.push(`Article: ${term.sectionLabel}`);
    }
    if (term.scopeType && term.scopeType !== "act") {
      parts.push(`Portée: ${term.scopeType}`);
    }
    parts.push(`\nDéfinition:\n${term.definition}`);
  } else {
    parts.push(`Defined Term: ${term.term}`);
    if (term.pairedTerm) {
      parts.push(`French term: ${term.pairedTerm}`);
    }
    parts.push(`Source: ${documentTitle}`);
    if (term.sectionLabel) {
      parts.push(`Section: ${term.sectionLabel}`);
    }
    if (term.scopeType && term.scopeType !== "act") {
      parts.push(`Scope: ${term.scopeType}`);
    }
    parts.push(`\nDefinition:\n${term.definition}`);
  }

  return parts.join("\n");
}

/**
 * Build chunk for a single defined term.
 */
function buildTermChunk(
  term: DefinedTerm,
  documentTitle: string
): ChunkData | null {
  const lang = validateLanguage(term.language);
  if (!lang) {
    return null;
  }

  const termKey = buildResourceKey("defined_term", term.id, lang, 0);

  return {
    content: buildTermContent(term, documentTitle),
    chunkIndex: 0,
    totalChunks: 1,
    resourceKey: termKey,
    metadata: {
      sourceType: "defined_term",
      language: lang,
      termId: term.id,
      term: term.term,
      termPaired: term.pairedTerm ?? undefined,
      actId: term.actId ?? undefined,
      regulationId: term.regulationId ?? undefined,
      documentTitle,
      sectionLabel: term.sectionLabel ?? undefined,
      scopeType: term.scopeType ?? undefined,
      scopeSections: term.scopeSections ?? undefined,
      chunkIndex: 0,
    },
  };
}

/**
 * Process all defined terms, generating embeddings.
 * Uses streaming/batching with JOINs for efficient title lookups.
 */
export async function processDefinedTerms(
  options: ProcessOptions
): Promise<ProcessResult> {
  const { db, progressTracker, limit, dryRun, skipExisting } = options;

  console.log("• Processing defined terms...");

  if (skipExisting) {
    await ensureProgressSynced(db, progressTracker, "defined_term");
  }

  // Get total count first
  const [{ count: totalCountRaw }] = await db
    .select({ count: count() })
    .from(definedTerms);
  const totalCount = limit ? Math.min(limit, totalCountRaw) : totalCountRaw;
  console.log(`   Found ${totalCount} defined terms (processing in batches)`);

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

  // Process defined terms in batches with JOINs for efficient title lookup
  for (let offset = 0; offset < totalCount; offset += DB_FETCH_BATCH_SIZE) {
    const batchLimit = Math.min(DB_FETCH_BATCH_SIZE, totalCount - offset);
    const batchNum = Math.floor(offset / DB_FETCH_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(totalCount / DB_FETCH_BATCH_SIZE);
    console.log(
      `   📥 Fetching DB batch ${batchNum}/${totalBatches} (offset ${offset})...`
    );

    // Fetch batch of defined terms with document titles via LEFT JOINs
    // This avoids loading all acts/regulations into memory
    const batchTerms = await db
      .select({
        // All defined term fields
        id: definedTerms.id,
        language: definedTerms.language,
        term: definedTerms.term,
        termNormalized: definedTerms.termNormalized,
        pairedTerm: definedTerms.pairedTerm,
        pairedTermId: definedTerms.pairedTermId,
        definition: definedTerms.definition,
        actId: definedTerms.actId,
        regulationId: definedTerms.regulationId,
        sectionLabel: definedTerms.sectionLabel,
        scopeType: definedTerms.scopeType,
        scopeSections: definedTerms.scopeSections,
        scopeRawText: definedTerms.scopeRawText,
        limsMetadata: definedTerms.limsMetadata,
        createdAt: definedTerms.createdAt,
        // Document title from JOIN (acts take precedence)
        documentTitle:
          sql<string>`COALESCE(${acts.title}, ${regulations.title}, 'Unknown Document')`.as(
            "document_title"
          ),
      })
      .from(definedTerms)
      .leftJoin(
        acts,
        and(
          eq(definedTerms.actId, acts.actId),
          eq(definedTerms.language, acts.language)
        )
      )
      .leftJoin(
        regulations,
        and(
          eq(definedTerms.regulationId, regulations.regulationId),
          eq(definedTerms.language, regulations.language)
        )
      )
      .orderBy(definedTerms.id)
      .limit(batchLimit)
      .offset(offset);

    if (batchTerms.length === 0) {
      break;
    }

    // Build chunks for this batch
    const batchChunks: ChunkData[] = [];

    for (let i = 0; i < batchTerms.length; i++) {
      const termRow = batchTerms[i];
      logProgress(offset + i + 1, totalCount, "Defined Terms");

      // Reconstruct term object (drizzle flattens the result)
      const term: DefinedTerm = {
        id: termRow.id,
        language: termRow.language,
        term: termRow.term,
        termNormalized: termRow.termNormalized,
        pairedTerm: termRow.pairedTerm,
        pairedTermId: termRow.pairedTermId,
        definition: termRow.definition,
        actId: termRow.actId,
        regulationId: termRow.regulationId,
        sectionLabel: termRow.sectionLabel,
        scopeType: termRow.scopeType,
        scopeSections: termRow.scopeSections,
        scopeRawText: termRow.scopeRawText,
        limsMetadata: termRow.limsMetadata,
        createdAt: termRow.createdAt,
      };

      const documentTitle = termRow.documentTitle ?? "Unknown Document";
      const chunk = buildTermChunk(term, documentTitle);

      if (!chunk) {
        errors.push({
          itemType: "term",
          itemId: term.id,
          message: `Invalid language "${term.language}"`,
          retryable: false,
        });
        continue;
      }

      batchChunks.push(chunk);
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
      label: `defined terms batch ${batchNum}`,
      dryRun,
    });

    totalInserted += inserted;
    totalSkipped += skipped;
  }

  console.log(
    `   ↳ Defined Terms: ${totalInserted} chunks embedded (${totalSkipped} skipped)`
  );
  if (errors.length > 0) {
    console.log(`   ⚠️  ${errors.length} defined terms had errors`);
  }

  return {
    chunksProcessed: totalInserted,
    chunksSkipped: totalSkipped,
    itemsProcessed: totalItems,
    errors,
  };
}
