/**
 * Generate legislation embeddings for acts, regulations, defined terms, and supplementary content
 *
 * Usage:
 *   npx tsx scripts/embeddings/legislation/index.ts
 *   npx tsx scripts/embeddings/legislation/index.ts --limit=100 --dry-run
 *   npx tsx scripts/embeddings/legislation/index.ts --acts-only --skip-existing
 *   npx tsx scripts/embeddings/legislation/index.ts --truncate
 *   npx tsx scripts/embeddings/legislation/index.ts --sync-progress
 *   npx tsx scripts/embeddings/legislation/index.ts --clear-progress
 *   npx tsx scripts/embeddings/legislation/index.ts --additional-only
 *   npx tsx scripts/embeddings/legislation/index.ts --link-terms
 *
 * Options:
 *   --limit=N          Process N items per type (applies to each type separately)
 *   --skip-existing    Skip resources that already exist in the database
 *   --truncate         Delete all existing legislation embeddings before starting
 *   --dry-run          Count chunks without writing to database or calling API
 *   --acts-only        Only process acts and act sections
 *   --regs-only        Only process regulations and regulation sections
 *   --terms-only       Only process defined terms
 *   --additional-only  Only process preambles, treaties, cross-refs, ToP, signatures, related provisions, footnotes, publication items
 *   --sync-progress    Rebuild SQLite progress cache from Postgres
 *   --clear-progress   Clear local progress tracking
 *   --link-terms       Only link EN/FR defined term pairs (no embeddings)
 *   --skip-link-terms  Skip automatic term linking after processing defined terms
 *
 * Content Types:
 *   - Acts: Metadata chunks + section content chunks
 *   - Regulations: Metadata chunks + section content chunks
 *   - Defined Terms: Legal definitions with bilingual context
 *   - Preambles: Legally significant introductory text
 *   - Treaties: Convention/agreement content attached to legislation
 *   - Cross-references: Links between acts and regulations
 *   - Table of Provisions: Navigation structure for documents
 *   - Signature Blocks: Treaty signatory information
 *   - Related Provisions: Cross-references to related/amending provisions
 *   - Footnotes: Section footnotes as independent embeddings linked via sectionId
 *   - Marginal Notes: Section headings as lightweight index for discoverability
 *   - Publication Items: Regulation recommendations and notices (Gazette publication content)
 *
 * Memory Usage:
 *   This script loads data in batches to avoid memory issues. For the full
 *   dataset (~350k chunks), processing is done incrementally. If you encounter
 *   memory issues, you can:
 *   - Use --acts-only, --regs-only, --terms-only, or --additional-only
 *   - Increase Node.js heap size: NODE_OPTIONS="--max-old-space-size=4096" npx tsx ...
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { processActs } from "./acts";
import {
  processCrossReferences,
  processFootnotes,
  processMarginalNotes,
  processPreambles,
  processPublicationItems,
  processRelatedProvisions,
  processSignatureBlocks,
  processTableOfProvisions,
  processTreaties,
} from "./additional-content";
import { processDefinedTerms } from "./defined-terms";
import { linkDefinedTermPairs } from "./link-defined-terms";
import { processRegulations } from "./regulations";
import {
  formatDuration,
  PROGRESS_DB_PATH,
  type ProcessError,
  ProgressTracker,
  parsePositiveInteger,
  promptConfirmation,
  readOptValue,
  syncProgressFromPostgres,
  validateEnvironment,
} from "./utilities";

// ---------- CLI args ----------
const args = process.argv.slice(2);

const limitStr = readOptValue(args, "limit");
const skipExisting = args.includes("--skip-existing");
const truncate = args.includes("--truncate");
const dryRun = args.includes("--dry-run");
const actsOnly = args.includes("--acts-only");
const regsOnly = args.includes("--regs-only");
const termsOnly = args.includes("--terms-only");
const additionalOnly = args.includes("--additional-only");
const syncProgress = args.includes("--sync-progress");
const clearProgress = args.includes("--clear-progress");
const linkTerms = args.includes("--link-terms");
const skipLinkTerms = args.includes("--skip-link-terms");

const limit = parsePositiveInteger(limitStr, "--limit");

// Validate conflicting flags
const exclusiveFlags = [actsOnly, regsOnly, termsOnly, additionalOnly].filter(
  Boolean
).length;
if (exclusiveFlags > 1) {
  console.error(
    "Error: Cannot use --acts-only, --regs-only, --terms-only, and --additional-only together. Choose one or omit all."
  );
  process.exit(1);
}

// ---------- DB setup ----------
validateEnvironment(dryRun);

const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!dbUrl) {
  throw new Error("DATABASE_URL or POSTGRES_URL required");
}
const connection = postgres(dbUrl);
const db = drizzle(connection);

// ---------- Progress Tracker ----------
const progressTracker = new ProgressTracker();

// ---------- Table Operations ----------
async function truncateTablesWithConfirmation(): Promise<void> {
  console.log("\n⚠️  WARNING: TRUNCATE TABLES OPERATION\n");
  console.log("This will delete all data from the following tables:");
  console.log("  • rag.leg_embeddings (all vector embeddings)");
  console.log("  • rag.leg_resources (all resource metadata)\n");
  console.log("⚠️  This action CANNOT be undone!\n");

  const confirmed = await promptConfirmation(
    "Are you sure you want to truncate these tables? Type Y to continue"
  );
  if (!confirmed) {
    console.log("\n❌ Operation cancelled by user\n");
    process.exit(0);
  }

  console.log("\n🧹 Truncating tables...");
  await db.execute(sql`TRUNCATE TABLE rag.leg_embeddings CASCADE`);
  console.log("   ✅ Truncated leg_embeddings table");
  await db.execute(sql`TRUNCATE TABLE rag.leg_resources CASCADE`);
  console.log("   ✅ Truncated leg_resources table");

  // Clear progress tracker since data is gone
  progressTracker.clearAll();
  console.log("   ✅ Cleared progress tracker");

  console.log("\n✨ Tables truncated successfully\n");
}

async function clearProgressWithConfirmation(): Promise<void> {
  const count = progressTracker.totalCount();
  console.log("\n⚠️  WARNING: CLEAR PROGRESS OPERATION\n");
  console.log(
    `This will clear ${count.toLocaleString()} tracked items from the local SQLite database.`
  );
  console.log(`File: ${PROGRESS_DB_PATH}\n`);

  const confirmed = await promptConfirmation(
    "Are you sure you want to clear progress? Type Y to continue"
  );
  if (!confirmed) {
    console.log("\n❌ Operation cancelled by user\n");
    return;
  }

  progressTracker.clearAll();
  console.log("\n✅ Progress cleared\n");
}

// ---------- Main ----------
async function main() {
  const startTime = Date.now();

  console.log("\n📚 Legislation Embeddings Generator\n");
  console.log(`Limit: ${limit ?? "none"}`);
  console.log(`Skip existing: ${skipExisting ? "yes" : "no"}`);
  console.log(`Truncate: ${truncate ? "yes" : "no"}`);
  console.log(`Dry run: ${dryRun ? "yes" : "no"}`);
  console.log(`Acts only: ${actsOnly ? "yes" : "no"}`);
  console.log(`Regs only: ${regsOnly ? "yes" : "no"}`);
  console.log(`Terms only: ${termsOnly ? "yes" : "no"}`);
  console.log(`Additional only: ${additionalOnly ? "yes" : "no"}`);
  console.log(`Sync progress: ${syncProgress ? "yes" : "no"}`);
  console.log(`Clear progress: ${clearProgress ? "yes" : "no"}`);
  console.log(`Link terms only: ${linkTerms ? "yes" : "no"}`);
  console.log(`Skip link terms: ${skipLinkTerms ? "yes" : "no"}`);
  console.log(
    `Progress cache: ${progressTracker.totalCount().toLocaleString()} items in ${PROGRESS_DB_PATH}\n`
  );

  // Handle special operations first
  if (truncate && !dryRun) {
    await truncateTablesWithConfirmation();
  }

  if (clearProgress) {
    await clearProgressWithConfirmation();
    await connection.end();
    progressTracker.close();
    return;
  }

  if (syncProgress) {
    console.log("\n📥 Syncing progress from Postgres...\n");
    await syncProgressFromPostgres(db, progressTracker);
    console.log(
      `\n✅ Progress synced: ${progressTracker.totalCount().toLocaleString()} items now cached\n`
    );
    await connection.end();
    progressTracker.close();
    return;
  }

  // Handle link-terms-only operation
  if (linkTerms) {
    console.log("\n🔗 Linking defined term pairs...\n");
    const linkStats = await linkDefinedTermPairs(db, { dryRun, limit });
    console.log("\n=== Link Terms Summary ===");
    console.log(`Terms processed: ${linkStats.totalTerms}`);
    console.log(`Pairs linked: ${linkStats.pairsLinked}`);
    console.log(`No match found: ${linkStats.noMatchFound}`);
    if (linkStats.errors > 0) {
      console.log(`Errors: ${linkStats.errors}`);
    }
    await connection.end();
    progressTracker.close();
    return;
  }

  // Process acts, regulations, and/or defined terms
  let totalChunks = 0;
  let totalSkipped = 0;
  const allErrors: ProcessError[] = [];

  const processOptions = {
    db,
    progressTracker,
    limit,
    dryRun,
    skipExisting,
  };

  // Determine what to process based on flags
  const processAll = !actsOnly && !regsOnly && !termsOnly && !additionalOnly;

  if (actsOnly || processAll) {
    const actsResult = await processActs(processOptions);
    totalChunks += actsResult.chunksProcessed;
    totalSkipped += actsResult.chunksSkipped;
    allErrors.push(...actsResult.errors);
  }

  if (regsOnly || processAll) {
    const regsResult = await processRegulations(processOptions);
    totalChunks += regsResult.chunksProcessed;
    totalSkipped += regsResult.chunksSkipped;
    allErrors.push(...regsResult.errors);
  }

  if (termsOnly || processAll) {
    const termsResult = await processDefinedTerms(processOptions);
    totalChunks += termsResult.chunksProcessed;
    totalSkipped += termsResult.chunksSkipped;
    allErrors.push(...termsResult.errors);

    // Automatically link term pairs after processing (unless skipped)
    if (!skipLinkTerms && !dryRun) {
      console.log("\n🔗 Linking defined term pairs...");
      const linkStats = await linkDefinedTermPairs(db, { dryRun: false });
      console.log(
        `   Linked ${linkStats.pairsLinked} pairs (${linkStats.noMatchFound} no match)`
      );
    }
  }

  // Process additional content types (preambles, treaties, cross-refs, etc.)
  if (additionalOnly || processAll) {
    const preambleResult = await processPreambles(processOptions);
    totalChunks += preambleResult.chunksProcessed;
    totalSkipped += preambleResult.chunksSkipped;
    allErrors.push(...preambleResult.errors);

    const treatyResult = await processTreaties(processOptions);
    totalChunks += treatyResult.chunksProcessed;
    totalSkipped += treatyResult.chunksSkipped;
    allErrors.push(...treatyResult.errors);

    const crossRefResult = await processCrossReferences(processOptions);
    totalChunks += crossRefResult.chunksProcessed;
    totalSkipped += crossRefResult.chunksSkipped;
    allErrors.push(...crossRefResult.errors);

    const topResult = await processTableOfProvisions(processOptions);
    totalChunks += topResult.chunksProcessed;
    totalSkipped += topResult.chunksSkipped;
    allErrors.push(...topResult.errors);

    const sigResult = await processSignatureBlocks(processOptions);
    totalChunks += sigResult.chunksProcessed;
    totalSkipped += sigResult.chunksSkipped;
    allErrors.push(...sigResult.errors);

    const relatedResult = await processRelatedProvisions(processOptions);
    totalChunks += relatedResult.chunksProcessed;
    totalSkipped += relatedResult.chunksSkipped;
    allErrors.push(...relatedResult.errors);

    const footnoteResult = await processFootnotes(processOptions);
    totalChunks += footnoteResult.chunksProcessed;
    totalSkipped += footnoteResult.chunksSkipped;
    allErrors.push(...footnoteResult.errors);

    const marginalNoteResult = await processMarginalNotes(processOptions);
    totalChunks += marginalNoteResult.chunksProcessed;
    totalSkipped += marginalNoteResult.chunksSkipped;
    allErrors.push(...marginalNoteResult.errors);

    const publicationItemResult = await processPublicationItems(processOptions);
    totalChunks += publicationItemResult.chunksProcessed;
    totalSkipped += publicationItemResult.chunksSkipped;
    allErrors.push(...publicationItemResult.errors);
  }

  const elapsed = Date.now() - startTime;
  const chunksPerSecond =
    elapsed > 0 ? totalChunks / (elapsed / 1000) : totalChunks;

  console.log(`\n✨ Complete! Total chunks: ${totalChunks}`);
  console.log(`⏱️  Duration: ${formatDuration(elapsed)}`);
  console.log(`📈 Rate: ${chunksPerSecond.toFixed(1)} chunks/sec`);
  console.log(`⏭️  Skipped: ${totalSkipped} existing chunks`);

  // Report errors if any
  if (allErrors.length > 0) {
    console.log(`\n⚠️  Errors: ${allErrors.length} items had errors`);

    // Group errors by type for cleaner output
    const errorsByType = new Map<string, ProcessError[]>();
    for (const error of allErrors) {
      const existing = errorsByType.get(error.itemType);
      if (existing) {
        existing.push(error);
      } else {
        errorsByType.set(error.itemType, [error]);
      }
    }

    for (const [itemType, errors] of errorsByType) {
      console.log(`   • ${itemType}: ${errors.length} errors`);
      // Show first 3 examples of each error type
      const examples = errors.slice(0, 3);
      for (const err of examples) {
        console.log(`     - ${err.itemId}: ${err.message}`);
      }
      if (errors.length > 3) {
        console.log(`     ... and ${errors.length - 3} more`);
      }
    }
  }

  // Estimate full run time if running with a limit
  if (limit && totalChunks > 0) {
    const estimatedTotalChunks = 280_000;
    const estimatedMs = (estimatedTotalChunks / chunksPerSecond) * 1000;
    console.log(
      `📊 Estimated full run: ${formatDuration(estimatedMs)} (for ~${estimatedTotalChunks.toLocaleString()} chunks)`
    );
  }

  console.log(
    `\n📋 Progress cache: ${progressTracker.totalCount().toLocaleString()} items tracked\n`
  );

  await connection.end();
  progressTracker.close();
}

main().catch(async (err) => {
  console.error("\n❌ Fatal error:", err);
  progressTracker.close();
  await connection.end().catch(() => {
    // Ignore connection close errors during fatal shutdown
  });
  process.exit(1);
});
