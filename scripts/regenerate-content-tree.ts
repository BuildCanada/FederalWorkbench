/**
 * Regenerate content for all legislation with correct document order
 *
 * This script re-parses the original XML files and regenerates:
 * - content_tree JSONB field for sections (using preserveOrder=true)
 * - section content plain text (using preserveOrder=true)
 * - definition text for defined_terms (using preserveOrder=true)
 * - preamble provisions text (using preserveOrder=true)
 * - treaty text and definitions (using preserveOrder=true)
 *
 * Updates the database without changing any IDs (preserving RAG embedding references).
 *
 * Usage:
 *   pnpm db:leg:regen-tree [options]
 *
 * Options:
 *   --dry-run       Parse files but don't update database
 *   --limit=N       Process only N files (for testing)
 *   --type=act|regulation  Process only acts or regulations
 *   --ids=ID1,ID2   Process specific document IDs
 *   --verbose       Show detailed output
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import postgres from "postgres";
import {
  getLegislationFiles,
  normalizeRegulationId,
} from "@/lib/legislation/parser";
import type { LegislationType } from "@/lib/legislation/types";
import {
  type ExtractedContent,
  extractAllContent,
  parseFileWithPreservedOrder,
} from "@/lib/legislation/utils/content-tree";

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error("POSTGRES_URL environment variable is required");
}

// Increase connection pool for parallel processing
const client = postgres(connectionString, { max: 10, debug: false });

// Concurrency limit for parallel file processing
// Keep low to avoid deadlocks when multiple files update same tables
const PARALLEL_FILES = 4;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const verbose = args.includes("--verbose");
const limit = args.find((a) => a.startsWith("--limit="))?.split("=")[1];
const typeArg = args.find((a) => a.startsWith("--type="))?.split("=")[1] as
  | LegislationType
  | undefined;
const idsArg = args.find((a) => a.startsWith("--ids="))?.split("=")[1];
const specificIds = idsArg ? idsArg.split(",").map((id) => id.trim()) : null;

const BASE_PATH = "./data/legislation";
const UPDATE_BATCH_SIZE = 500;

type Stats = {
  filesProcessed: number;
  filesFailed: number;
  filesEn: number;
  filesFr: number;
  // Content tree updates (hierarchy path, content_tree JSONB)
  sectionsUpdated: number;
  sectionsNotFound: number;
  sectionsExpected: number;
  sectionsNoMatch: number;
  // Section content updates (plain text content)
  sectionContentExpected: number;
  sectionContentUpdated: number;
  sectionContentNotFound: number;
  // Definition updates
  definitionsExpected: number;
  definitionsUpdated: number;
  definitionsNotFound: number;
  // Preamble updates
  preamblesExpected: number;
  preamblesUpdated: number;
  // Treaty updates
  treatiesExpected: number;
  treatiesUpdated: number;
  treatiesNotFound: number;
};

const stats: Stats = {
  filesProcessed: 0,
  filesFailed: 0,
  filesEn: 0,
  filesFr: 0,
  sectionsUpdated: 0,
  sectionsNotFound: 0,
  sectionsExpected: 0,
  sectionsNoMatch: 0,
  sectionContentExpected: 0,
  sectionContentUpdated: 0,
  sectionContentNotFound: 0,
  definitionsExpected: 0,
  definitionsUpdated: 0,
  definitionsNotFound: 0,
  preamblesExpected: 0,
  preamblesUpdated: 0,
  treatiesExpected: 0,
  treatiesUpdated: 0,
  treatiesNotFound: 0,
};

function log(message: string) {
  console.log(`[regen-tree] ${message}`);
}

function logVerbose(message: string) {
  if (verbose) {
    console.log(`  ${message}`);
  }
}

/**
 * Update contentTree for sections from extracted content.
 * Uses limsId AND language to match sections in the database (same pattern as updateSectionContent).
 * Uses batched updates within a transaction for atomicity and performance.
 */
async function updateContentTree(
  extracted: ExtractedContent,
  language: "en" | "fr"
): Promise<void> {
  const contentTrees = extracted.contentTrees;

  if (contentTrees.length === 0) {
    logVerbose("  No content trees extracted from file");
    return;
  }

  // Filter to only content trees with limsId (can be updated directly by limsId + language)
  const updatable = contentTrees.filter((t) => t.limsId);
  const skipped = contentTrees.length - updatable.length;

  if (skipped > 0) {
    logVerbose(`  Skipping ${skipped} content trees without limsId`);
    stats.sectionsNoMatch += skipped;
  }

  if (updatable.length === 0) {
    logVerbose("  No updatable content trees (all missing limsId)");
    return;
  }

  stats.sectionsExpected += updatable.length;

  if (dryRun) {
    logVerbose(`[DRY RUN] Would update ${updatable.length} sections`);
    stats.sectionsUpdated += updatable.length;
    return;
  }

  // Process in batches within a transaction
  await client.begin(async (tx) => {
    for (let i = 0; i < updatable.length; i += UPDATE_BATCH_SIZE) {
      const batch = updatable.slice(i, i + UPDATE_BATCH_SIZE);

      const limsIds = batch.map((u) => u.limsId);
      const trees = batch.map((u) => JSON.stringify(u.contentTree));
      const paths = batch.map((u) => JSON.stringify(u.hierarchyPath));

      // Update by matching limsMetadata->>'id' AND language
      const result = await tx`
        UPDATE legislation.sections AS s
        SET
          content_tree = data.content_tree::jsonb,
          hierarchy_path = data.hierarchy_path::jsonb
        FROM unnest(${limsIds}::text[], ${trees}::text[], ${paths}::text[]) AS data(lims_id, content_tree, hierarchy_path)
        WHERE s.lims_metadata->>'id' = data.lims_id
          AND s.language = ${language}
      `;

      stats.sectionsUpdated += result.count;

      // Track sections not found (limsId mismatch)
      if (result.count < batch.length) {
        const missing = batch.length - result.count;
        stats.sectionsNotFound += missing;
        logVerbose(
          `  Warning: ${missing} sections not found in database (limsId mismatch)`
        );
      }

      if (verbose && batch.length > 50) {
        logVerbose(
          `  Batch ${Math.floor(i / UPDATE_BATCH_SIZE) + 1}: updated ${result.count} sections`
        );
      }
    }
  });
}

/**
 * Update definitions from extracted content.
 *
 * NOTE: Position-based extraction (sectionOrder/definitionOrder) doesn't include limsId,
 * so this script cannot match definitions to database rows. The main import pipeline
 * now handles content joining correctly during import.
 */
function updateDefinitions(
  extracted: ExtractedContent,
  _language: "en" | "fr"
): void {
  const definitionTexts = extracted.definitionTexts;

  if (definitionTexts.length === 0) {
    logVerbose("  No definitions found in file");
    return;
  }

  stats.definitionsExpected += definitionTexts.length;
  stats.definitionsNotFound += definitionTexts.length;

  logVerbose(
    `  Skipping ${definitionTexts.length} definitions - position-based content extraction doesn't include limsId for DB matching. Use main import pipeline.`
  );
}

/**
 * Update section content from extracted content.
 *
 * NOTE: Position-based extraction (sectionOrder/definitionOrder) doesn't include limsId,
 * so this script cannot match sections to database rows. The main import pipeline
 * now handles content joining correctly during import.
 */
function updateSectionContent(
  extracted: ExtractedContent,
  _language: "en" | "fr"
): void {
  const sectionContents = extracted.sectionContents;

  if (sectionContents.length === 0) {
    logVerbose("  No section content found in file");
    return;
  }

  stats.sectionContentExpected += sectionContents.length;
  stats.sectionContentNotFound += sectionContents.length;

  logVerbose(
    `  Skipping ${sectionContents.length} section contents - position-based content extraction doesn't include limsId for DB matching. Use main import pipeline.`
  );
}

/**
 * Update preamble for an act from extracted content.
 * Preambles are stored as JSONB arrays in the acts table.
 * Uses act_id AND language since act_id is shared between EN/FR rows.
 */
async function updatePreamble(
  extracted: ExtractedContent,
  docId: string,
  docType: LegislationType,
  language: "en" | "fr"
): Promise<void> {
  // Only acts have preambles
  if (docType !== "act") {
    return;
  }

  const preambleProvisions = extracted.preamble;

  if (!preambleProvisions || preambleProvisions.length === 0) {
    logVerbose("  No preamble found in file");
    return;
  }

  stats.preamblesExpected++;

  if (dryRun) {
    logVerbose(
      `[DRY RUN] Would update preamble with ${preambleProvisions.length} provisions`
    );
    stats.preamblesUpdated++;
    return;
  }

  // Update the preamble JSONB for this act (filter by language since act_id is shared)
  const result = await client`
    UPDATE legislation.acts
    SET preamble = ${JSON.stringify(preambleProvisions)}::jsonb
    WHERE act_id = ${docId}
      AND language = ${language}
  `;

  if (result.count > 0) {
    stats.preamblesUpdated++;
    logVerbose(
      `  Updated preamble with ${preambleProvisions.length} provisions`
    );
  } else {
    logVerbose(`  Preamble not updated (act not found: ${docId})`);
  }
}

/**
 * Update treaties for a document from extracted content.
 * Treaties are stored as JSONB arrays in both acts and regulations tables.
 *
 * Uses a read-modify-write pattern for efficiency (1 read + 1 write vs N writes).
 * Preserves structural fields like `sections`, `preamble`, `signatureText`.
 *
 * Note: Acts need language filter (act_id shared between EN/FR).
 * Regulations don't need it (regulation_id is language-specific: _c. vs _ch.).
 */
async function updateTreaties(
  extracted: ExtractedContent,
  docId: string,
  docType: LegislationType,
  language: "en" | "fr"
): Promise<void> {
  const treaties = extracted.treaties;

  if (!treaties || treaties.length === 0) {
    logVerbose("  No treaties found in file");
    return;
  }

  stats.treatiesExpected += treaties.length;

  if (dryRun) {
    logVerbose(`[DRY RUN] Would update ${treaties.length} treaties`);
    stats.treatiesUpdated += treaties.length;
    return;
  }

  const table =
    docType === "act" ? "legislation.acts" : "legislation.regulations";
  const idColumn = docType === "act" ? "act_id" : "regulation_id";

  // Read current treaties from DB
  const languageFilter = docType === "act" ? "AND language = $2" : "";
  const readParams = docType === "act" ? [docId, language] : [docId];

  const currentRows = await client.unsafe(
    `
    SELECT treaties
    FROM ${table}
    WHERE ${idColumn} = $1
      AND treaties IS NOT NULL
      ${languageFilter}
    `,
    readParams
  );

  if (currentRows.length === 0) {
    stats.treatiesNotFound += treaties.length;
    logVerbose(`  Treaties not found in DB for ${docType}: ${docId}`);
    return;
  }

  const currentTreaties = currentRows[0].treaties as Record<string, unknown>[];
  if (!Array.isArray(currentTreaties)) {
    stats.treatiesNotFound += treaties.length;
    logVerbose(`  Invalid treaties format in DB for ${docType}: ${docId}`);
    return;
  }

  // Merge extracted text/definitions into current treaties
  let updatedCount = 0;
  for (let i = 0; i < treaties.length && i < currentTreaties.length; i++) {
    const treatyData = treaties[i];
    currentTreaties[i] = {
      ...currentTreaties[i],
      text: treatyData.text,
      ...(treatyData.definitions && { definitions: treatyData.definitions }),
    };
    updatedCount++;
  }

  // Write back merged treaties
  const writeParams =
    docType === "act"
      ? [JSON.stringify(currentTreaties), docId, language]
      : [JSON.stringify(currentTreaties), docId];

  const result = await client.unsafe(
    `
    UPDATE ${table}
    SET treaties = $1::jsonb
    WHERE ${idColumn} = $2
      ${languageFilter}
    `,
    writeParams
  );

  if (result.count > 0) {
    stats.treatiesUpdated += updatedCount;
    logVerbose(`  Updated ${updatedCount} treaties for ${docType}`);
  } else {
    stats.treatiesNotFound += treaties.length;
    logVerbose(`  Failed to update treaties for ${docType}: ${docId}`);
  }

  // Track treaties that couldn't be matched (XML has more than DB)
  if (treaties.length > currentTreaties.length) {
    const unmatched = treaties.length - currentTreaties.length;
    stats.treatiesNotFound += unmatched;
    logVerbose(
      `  Warning: ${unmatched} treaties in XML not found in DB (array length mismatch)`
    );
  }
}

/**
 * Filter files by specific IDs
 */
function filterByIds(
  files: {
    path: string;
    type: LegislationType;
    language: "en" | "fr";
    id: string;
  }[],
  ids: string[]
): {
  path: string;
  type: LegislationType;
  language: "en" | "fr";
  id: string;
}[] {
  return files.filter((file) => {
    const normalizedFileId =
      file.type === "regulation" ? normalizeRegulationId(file.id) : file.id;

    return ids.some((id) => {
      const normalizedId =
        file.type === "regulation" ? normalizeRegulationId(id) : id;
      return normalizedFileId === normalizedId || file.id === id;
    });
  });
}

async function main() {
  log("Regenerating content_tree and definitions for legislation");
  log(
    `Options: dry-run=${dryRun}, limit=${limit || "none"}, type=${typeArg || "all"}, ids=${specificIds ? specificIds.length : "none"}`
  );

  let files: {
    path: string;
    type: LegislationType;
    language: "en" | "fr";
    id: string;
  }[];

  if (specificIds) {
    const allFiles = getLegislationFiles(BASE_PATH, typeArg, undefined);
    files = filterByIds(allFiles, specificIds);
    log(`Filtering by ${specificIds.length} specific IDs`);
  } else {
    files = getLegislationFiles(
      BASE_PATH,
      typeArg,
      limit ? Number.parseInt(limit, 10) : undefined
    );
  }

  log(`Found ${files.length} files to process (${PARALLEL_FILES} parallel)`);

  const startTime = Date.now();

  // Process a single file - returns true on success
  async function processFile(file: (typeof files)[0]): Promise<boolean> {
    try {
      logVerbose(`Processing: ${file.path}`);

      // Parse the file ONCE with preserveOrder=true
      const parsed = parseFileWithPreservedOrder(file.path);

      // Extract ALL content in a single tree walk
      const extracted = extractAllContent(parsed);

      // Run updates sequentially within each file to avoid deadlocks
      // (file-level parallelism is sufficient, 8 files * 1 transaction = 8 concurrent)
      await updateContentTree(extracted, file.language);
      await updateSectionContent(extracted, file.language);
      await updateDefinitions(extracted, file.language);
      await updatePreamble(extracted, file.id, file.type, file.language);
      await updateTreaties(extracted, file.id, file.type, file.language);

      return true;
    } catch (error) {
      log(
        `ERROR processing ${file.path}: ${error instanceof Error ? error.message : String(error)}`
      );
      if (verbose && error instanceof Error) {
        console.error(error.stack);
      }
      return false;
    }
  }

  // Process files in parallel batches
  for (let i = 0; i < files.length; i += PARALLEL_FILES) {
    const batch = files.slice(i, i + PARALLEL_FILES);
    const results = await Promise.all(batch.map(processFile));

    // Update stats
    for (let j = 0; j < results.length; j++) {
      if (results[j]) {
        stats.filesProcessed++;
        if (batch[j].language === "en") {
          stats.filesEn++;
        } else {
          stats.filesFr++;
        }
      } else {
        stats.filesFailed++;
      }
    }

    // Progress logging
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (stats.filesProcessed / (Date.now() - startTime)) * 1000;
    log(
      `Processed ${stats.filesProcessed}/${files.length} files (${rate.toFixed(1)} files/sec) [${elapsed}s]`
    );
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  log("");
  log("=== Regeneration Complete ===");
  log(
    `Files processed: ${stats.filesProcessed} (${stats.filesEn} EN, ${stats.filesFr} FR)`
  );
  log(`Files failed: ${stats.filesFailed}`);
  log("");
  log("Content Trees (hierarchy_path, content_tree):");
  log(`  Expected: ${stats.sectionsExpected}`);
  log(`  Updated: ${stats.sectionsUpdated}`);
  log(`  Skipped (no limsId): ${stats.sectionsNoMatch}`);
  log(`  Not found in DB: ${stats.sectionsNotFound}`);
  log("");
  log("Section Content (plain text):");
  log(`  Expected: ${stats.sectionContentExpected}`);
  log(`  Updated: ${stats.sectionContentUpdated}`);
  log(`  Not found in DB: ${stats.sectionContentNotFound}`);
  log("");
  log("Definitions:");
  log(`  Expected: ${stats.definitionsExpected}`);
  log(`  Updated: ${stats.definitionsUpdated}`);
  log(`  Not found in DB: ${stats.definitionsNotFound}`);
  log("");
  log("Preambles:");
  log(`  Expected: ${stats.preamblesExpected}`);
  log(`  Updated: ${stats.preamblesUpdated}`);
  log("");
  log("Treaties:");
  log(`  Expected: ${stats.treatiesExpected}`);
  log(`  Updated: ${stats.treatiesUpdated}`);
  log(`  Not found in DB: ${stats.treatiesNotFound}`);
  log("");
  log(`Total time: ${totalTime}s`);

  // Warn prominently if there's a mismatch
  if (stats.sectionsNotFound > 0) {
    log("");
    log(
      `WARNING: ${stats.sectionsNotFound} content trees from XML were not found in database.`
    );
    log(
      "This may indicate a schema drift or that the database needs to be re-imported."
    );
    log("Run with --verbose to see which batches had mismatches.");
  }

  if (stats.sectionsNoMatch > 0) {
    log("");
    log(
      `NOTE: ${stats.sectionsNoMatch} content trees were skipped (missing limsId).`
    );
    log(
      "This can happen for headings, stubs, or sections without lims:id attribute."
    );
  }

  if (stats.sectionContentNotFound > 0) {
    log("");
    log(
      `WARNING: ${stats.sectionContentNotFound} section contents from XML were not found in database.`
    );
    log(
      "This may indicate a schema drift or that the database needs to be re-imported."
    );
  }

  if (stats.definitionsNotFound > 0) {
    log("");
    log(
      `WARNING: ${stats.definitionsNotFound} definitions from XML were not found in database.`
    );
    log(
      "This may indicate a schema drift or that the database needs to be re-imported."
    );
  }

  if (stats.treatiesNotFound > 0) {
    log("");
    log(
      `WARNING: ${stats.treatiesNotFound} treaties from XML were not found in database.`
    );
    log("This may indicate a schema drift or array length mismatch.");
  }

  await client.end();
  process.exit(stats.filesFailed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
