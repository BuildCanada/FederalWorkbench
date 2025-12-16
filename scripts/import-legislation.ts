/**
 * Import Canadian Federal Legislation from XML files
 *
 * Usage:
 *   npx tsx scripts/import-legislation.ts [options]
 *
 * Options:
 *   --prod          Use production database (.env.production.local)
 *   --limit=N       Process only N files (for testing)
 *   --dry-run       Parse files but don't insert into database
 *   --type=act|regulation  Process only acts or regulations
 *   --lang=en|fr    Process only English or French files
 *   --skip-existing Skip files that have already been imported
 *   --truncate      Truncate all legislation tables before importing (prompts for confirmation)
 *   --force         Skip confirmation prompt for --truncate
 *   --verbose       Show detailed output
 *   --ids=ID1,ID2   Import specific document IDs (comma-separated)
 *                   For acts: A-1,A-0.6,C-11
 *                   For regulations: SOR-2000-1,SI-2000-100,C.R.C.,_c._10
 *   --subset         Import strategic subset (25 acts + related regulations)
 *   --subset=NAME    Import named subset (strategic, smoke)
 *   --images         Download images from Justice Canada website
 */

import { existsSync } from "node:fs";
import { config } from "dotenv";

// Check for --prod flag before loading env (must happen before other imports that use env vars)
const isProd = process.argv.includes("--prod");
const envFile = isProd ? ".env.production.local" : ".env.local";
const envResult = config({ path: envFile, override: true });
if (envResult.error) {
  console.error(`[import] Error loading ${envFile}:`, envResult.error.message);
} else if (!existsSync(envFile)) {
  console.warn(`[import] Warning: ${envFile} not found`);
}

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  acts,
  crossReferences,
  definedTerms,
  regulations,
  sections,
} from "@/lib/db/legislation/schema";
import {
  getEnablingActFromRelationships,
  type LookupData,
  lookupRegulation,
  lookupStatute,
  parseLookupXml,
} from "@/lib/legislation/lookup-parser";
import {
  getLegislationFiles,
  normalizeRegulationId,
  parseLegislationXml,
} from "@/lib/legislation/parser";
import {
  parseSubsetArg,
  type ResolvedSubset,
  resolveSubset,
} from "@/lib/legislation/subsets";
import type {
  Language,
  LegislationType,
  ParsedDocument,
} from "@/lib/legislation/types";
import { linkDefinedTermPairs } from "./embeddings/legislation/link-defined-terms";

// Database connection
const connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error("POSTGRES_URL environment variable is required");
}

// Debug: show which database host we're connecting to
try {
  const dbUrl = new URL(connectionString);
  console.log(`[import] Database host: ${dbUrl.host}`);
} catch {
  console.log("[import] Database: (unable to parse URL)");
}

const client = postgres(connectionString, { max: 10, debug: false });
const db = drizzle(client);

// Parse command line arguments
const args = process.argv.slice(2);
const limit = args.find((a) => a.startsWith("--limit="))?.split("=")[1];
const dryRun = args.includes("--dry-run");
const verbose = args.includes("--verbose");
const skipExisting = args.includes("--skip-existing");
const typeArg = args.find((a) => a.startsWith("--type="))?.split("=")[1] as
  | LegislationType
  | undefined;
const langArg = args.find((a) => a.startsWith("--lang="))?.split("=")[1] as
  | "en"
  | "fr"
  | undefined;
const idsArg = args.find((a) => a.startsWith("--ids="))?.split("=")[1];
const truncateMode = args.includes("--truncate");
const forceMode = args.includes("--force");
const downloadImages = args.includes("--images");

// Parse --subset flag
let subsetName: string | null = null;
try {
  subsetName = parseSubsetArg(args);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

// Parse specific IDs if provided
const specificIds = idsArg ? idsArg.split(",").map((id) => id.trim()) : null;

const BASE_PATH = "./data/legislation";

// PostgreSQL has a limit of 65535 parameters per query
// With ~30 columns per section, batch size of 2000 keeps us under the limit (2000 * 30 = 60000)
const INSERT_BATCH_SIZE = 2000;

// SQLite progress tracker for fast existence checks
const PROGRESS_DB_PATH = "scripts/.leg-import-progress.db";

/**
 * SQLite-based progress tracker for fast existence checks.
 * Avoids slow Postgres queries when checking if files have been imported.
 */
class ImportProgressTracker {
  private readonly sqlite: Database.Database;
  private readonly checkStmt: Database.Statement;
  private readonly insertStmt: Database.Statement;
  private readonly insertManyStmt: Database.Transaction<
    (keys: string[]) => void
  >;
  private readonly clearAllStmt: Database.Statement;

  constructor(dbPath: string = PROGRESS_DB_PATH) {
    if (dbPath !== ":memory:") {
      const dir = dbPath.split("/").slice(0, -1).join("/");
      if (dir && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    this.sqlite = new Database(dbPath);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("synchronous = NORMAL");

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS imported (
        key TEXT PRIMARY KEY,
        created_at INTEGER DEFAULT (unixepoch())
      ) WITHOUT ROWID;
    `);

    this.checkStmt = this.sqlite.prepare(
      "SELECT 1 FROM imported WHERE key = ?"
    );
    this.insertStmt = this.sqlite.prepare(
      "INSERT OR IGNORE INTO imported (key) VALUES (?)"
    );
    this.clearAllStmt = this.sqlite.prepare("DELETE FROM imported");
    this.insertManyStmt = this.sqlite.transaction((keys: string[]) => {
      for (const key of keys) {
        this.insertStmt.run(key);
      }
    });
  }

  has(key: string): boolean {
    return this.checkStmt.get(key) !== undefined;
  }

  mark(key: string): void {
    this.insertStmt.run(key);
  }

  markMany(keys: string[]): void {
    if (keys.length > 0) {
      this.insertManyStmt(keys);
    }
  }

  clearAll(): void {
    this.clearAllStmt.run();
  }

  close(): void {
    this.sqlite.close();
  }
}

// Global progress tracker instance
let progressTracker: ImportProgressTracker | null = null;

function getProgressTracker(): ImportProgressTracker {
  if (!progressTracker) {
    progressTracker = new ImportProgressTracker();
  }
  return progressTracker;
}

/**
 * Build a unique key for a file (type:id:language)
 */
function buildFileKey(
  type: LegislationType,
  id: string,
  language: Language
): string {
  return `${type}:${id}:${language}`;
}

type ImportStats = {
  filesProcessed: number;
  filesSkipped: number;
  filesFailed: number;
  actsInserted: number;
  regulationsInserted: number;
  sectionsInserted: number;
  definedTermsInserted: number;
  crossReferencesInserted: number;
  // Term linking stats (populated after all files processed)
  termPairsLinked: number;
  termPairsNoMatch: number;
  // Image download stats
  imagesDownloaded: number;
  imagesExisting: number;
  imagesFailed: number;
};

const stats: ImportStats = {
  filesProcessed: 0,
  filesSkipped: 0,
  filesFailed: 0,
  actsInserted: 0,
  regulationsInserted: 0,
  sectionsInserted: 0,
  definedTermsInserted: 0,
  crossReferencesInserted: 0,
  termPairsLinked: 0,
  termPairsNoMatch: 0,
  imagesDownloaded: 0,
  imagesExisting: 0,
  imagesFailed: 0,
};

// Collect unique image sources from all processed documents
const imageSourcesToDownload = new Set<string>();

// Base URL for downloading images from Justice Canada
const JUSTICE_IMAGES_BASE_URL = "https://laws-lois.justice.gc.ca/images";
const LOCAL_IMAGES_PATH = "public/legislation/images";
const IMAGE_DOWNLOAD_CONCURRENCY = 5;

// Load lookup.xml metadata
const LOOKUP_PATH = `${BASE_PATH}/lookup/lookup.xml`;
let lookupData: LookupData | null = null;

/**
 * Load the lookup.xml data for enrichment
 */
function loadLookupData(): LookupData | null {
  try {
    const data = parseLookupXml(LOOKUP_PATH);
    log(
      `Loaded lookup.xml: ${data.statutes.size} statutes, ${data.regulations.size} regulations`
    );
    return data;
  } catch (error) {
    log(
      `Warning: Could not load lookup.xml: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * Enrich a parsed document with lookup.xml metadata
 * - Adds reversedShortTitle and consolidateFlag
 * - Validates/populates enablingActId from relationships
 */
function enrichDocumentWithLookup(doc: ParsedDocument): void {
  if (!lookupData) {
    return;
  }

  if (doc.type === "act" && doc.act) {
    const lookup = lookupStatute(lookupData, doc.act.actId, doc.act.language);
    if (lookup) {
      doc.act.reversedShortTitle = lookup.reversedShortTitle;
      doc.act.consolidateFlag = lookup.consolidateFlag;
      logVerbose(
        `  Enriched act ${doc.act.actId} (${doc.act.language}): reversedShortTitle="${lookup.reversedShortTitle}", consolidateFlag=${lookup.consolidateFlag}`
      );
    }
  } else if (doc.type === "regulation" && doc.regulation) {
    const lookup = lookupRegulation(
      lookupData,
      doc.regulation.instrumentNumber,
      doc.regulation.language
    );
    if (lookup) {
      doc.regulation.reversedShortTitle = lookup.reversedShortTitle;
      doc.regulation.consolidateFlag = lookup.consolidateFlag;
      logVerbose(
        `  Enriched regulation ${doc.regulation.regulationId} (${doc.regulation.language}): reversedShortTitle="${lookup.reversedShortTitle}", consolidateFlag=${lookup.consolidateFlag}`
      );

      // If enablingActId is not set, try to get it from relationships
      if (!doc.regulation.enablingActId && lookup.id) {
        const enablingActId = getEnablingActFromRelationships(
          lookupData,
          lookup.id,
          doc.regulation.language
        );
        if (enablingActId) {
          doc.regulation.enablingActId = enablingActId;
          logVerbose(
            `  Set enablingActId from relationships: ${enablingActId}`
          );
        }
      }
    }
  }
}

/**
 * Collect image sources from a parsed document.
 * Adds all unique image sources to the global Set for later downloading.
 */
function collectImageSources(doc: ParsedDocument): void {
  for (const section of doc.sections) {
    if (section.contentFlags?.imageSources) {
      for (const source of section.contentFlags.imageSources) {
        imageSourcesToDownload.add(source);
      }
    }
  }
}

type ImageDownloadResult = "downloaded" | "existing" | "failed";

/**
 * Download an image from Justice Canada to local public directory.
 * Creates directory structure as needed.
 */
async function downloadImage(source: string): Promise<ImageDownloadResult> {
  const url = `${JUSTICE_IMAGES_BASE_URL}/${source}`;
  const localPath = join(LOCAL_IMAGES_PATH, source);
  const localDir = dirname(localPath);

  // Skip if already downloaded
  if (existsSync(localPath)) {
    logVerbose(`  Image already exists: ${source}`);
    return "existing";
  }

  // Create directory structure
  if (!existsSync(localDir)) {
    mkdirSync(localDir, { recursive: true });
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      log(`  Failed to download ${source}: HTTP ${response.status}`);
      return "failed";
    }

    const buffer = await response.arrayBuffer();
    writeFileSync(localPath, Buffer.from(buffer));
    logVerbose(`  Downloaded: ${source}`);
    return "downloaded";
  } catch (error) {
    log(
      `  Failed to download ${source}: ${error instanceof Error ? error.message : String(error)}`
    );
    return "failed";
  }
}

/**
 * Download all collected images from Justice Canada.
 */
async function downloadAllImages(): Promise<void> {
  if (imageSourcesToDownload.size === 0) {
    log("No images to download");
    return;
  }

  log("");
  log("=== Downloading Images ===");
  log(`Found ${imageSourcesToDownload.size} unique images`);

  // Ensure base directory exists
  if (!existsSync(LOCAL_IMAGES_PATH)) {
    mkdirSync(LOCAL_IMAGES_PATH, { recursive: true });
  }

  const sources = Array.from(imageSourcesToDownload);
  const total = sources.length;

  for (let i = 0; i < total; i += IMAGE_DOWNLOAD_CONCURRENCY) {
    const batch = sources.slice(i, i + IMAGE_DOWNLOAD_CONCURRENCY);
    const results = await Promise.all(batch.map(downloadImage));

    for (const result of results) {
      if (result === "downloaded") {
        stats.imagesDownloaded++;
      } else if (result === "existing") {
        stats.imagesExisting++;
      } else {
        stats.imagesFailed++;
      }
    }

    const processed = Math.min(i + IMAGE_DOWNLOAD_CONCURRENCY, total);
    if (processed === total || processed % 25 === 0) {
      log(`Progress: ${processed}/${total} images`);
    }
  }
}

/**
 * Check if a file has already been imported using SQLite progress tracker.
 * Much faster than querying Postgres for each file.
 */
function fileAlreadyImported(
  type: LegislationType,
  id: string,
  language: Language
): boolean {
  const tracker = getProgressTracker();
  const key = buildFileKey(type, id, language);
  return tracker.has(key);
}

/**
 * Mark a file as imported in SQLite progress tracker.
 */
function markFileImported(
  type: LegislationType,
  id: string,
  language: Language
): void {
  const tracker = getProgressTracker();
  const key = buildFileKey(type, id, language);
  tracker.mark(key);
}

function log(message: string) {
  console.log(`[import] ${message}`);
}

function logVerbose(message: string) {
  if (verbose) {
    console.log(`  ${message}`);
  }
}

/**
 * Prompt user to confirm truncate operation
 */
function confirmTruncate(): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log("");
    console.log("⚠️  WARNING: --truncate will perform the following actions:");
    console.log("   • DELETE all data from legislation.acts");
    console.log("   • DELETE all data from legislation.regulations");
    console.log("   • DELETE all data from legislation.sections");
    console.log("   • DELETE all data from legislation.defined_terms");
    console.log("   • DELETE all data from legislation.cross_references");
    console.log("   • Clear the SQLite progress cache");
    console.log("");
    console.log(
      "   This will also invalidate any existing embeddings for legislation."
    );
    console.log("");

    rl.question("Are you sure you want to continue? (y/n): ", (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      const confirmed = normalized === "y" || normalized === "yes";
      if (!confirmed) {
        console.log("Truncate cancelled.");
      }
      resolve(confirmed);
    });
  });
}

/**
 * Insert a parsed document into the database
 * Each document is a single language version - no bilingual merging needed
 * Uses a transaction for atomicity and better performance
 */
async function insertDocument(doc: ParsedDocument): Promise<void> {
  if (dryRun) {
    log(
      `[DRY RUN] Would insert ${doc.type} (${doc.language}): ${doc.act?.actId || doc.regulation?.regulationId}`
    );
    logVerbose(`  Sections: ${doc.sections.length}`);
    logVerbose(`  Defined Terms: ${doc.definedTerms.length}`);
    logVerbose(`  Cross References: ${doc.crossReferences.length}`);
    return;
  }

  // Wrap all inserts in a transaction for atomicity
  await db.transaction(async (tx) => {
    // Insert act or regulation - one record per language, no merge needed
    if (doc.type === "act" && doc.act) {
      await tx.insert(acts).values({
        actId: doc.act.actId,
        language: doc.act.language,
        title: doc.act.title,
        longTitle: doc.act.longTitle,
        runningHead: doc.act.runningHead,
        status: doc.act.status,
        inForceDate: doc.act.inForceDate,
        consolidationDate: doc.act.consolidationDate,
        lastAmendedDate: doc.act.lastAmendedDate,
        enactedDate: doc.act.enactedDate,
        billOrigin: doc.act.billOrigin,
        billType: doc.act.billType,
        hasPreviousVersion: doc.act.hasPreviousVersion,
        consolidatedNumber: doc.act.consolidatedNumber,
        consolidatedNumberOfficial: doc.act.consolidatedNumberOfficial,
        annualStatuteYear: doc.act.annualStatuteYear,
        annualStatuteChapter: doc.act.annualStatuteChapter,
        shortTitleStatus: doc.act.shortTitleStatus,
        reversedShortTitle: doc.act.reversedShortTitle,
        consolidateFlag: doc.act.consolidateFlag ?? false,
        limsMetadata: doc.act.limsMetadata,
        billHistory: doc.act.billHistory,
        recentAmendments: doc.act.recentAmendments,
        preamble: doc.act.preamble,
        relatedProvisions: doc.act.relatedProvisions,
        treaties: doc.act.treaties,
        signatureBlocks: doc.act.signatureBlocks,
        tableOfProvisions: doc.act.tableOfProvisions,
      });
      stats.actsInserted++;
    } else if (doc.type === "regulation" && doc.regulation) {
      await tx.insert(regulations).values({
        regulationId: doc.regulation.regulationId,
        language: doc.regulation.language,
        instrumentNumber: doc.regulation.instrumentNumber,
        regulationType: doc.regulation.regulationType,
        gazettePart: doc.regulation.gazettePart,
        title: doc.regulation.title,
        longTitle: doc.regulation.longTitle,
        reversedShortTitle: doc.regulation.reversedShortTitle,
        consolidateFlag: doc.regulation.consolidateFlag ?? false,
        enablingAuthorities: doc.regulation.enablingAuthorities,
        enablingActId: doc.regulation.enablingActId,
        enablingActTitle: doc.regulation.enablingActTitle,
        status: doc.regulation.status,
        hasPreviousVersion: doc.regulation.hasPreviousVersion,
        registrationDate: doc.regulation.registrationDate,
        consolidationDate: doc.regulation.consolidationDate,
        lastAmendedDate: doc.regulation.lastAmendedDate,
        limsMetadata: doc.regulation.limsMetadata,
        regulationMakerOrder: doc.regulation.regulationMakerOrder,
        enablingAuthorityOrder: doc.regulation.enablingAuthorityOrder,
        recentAmendments: doc.regulation.recentAmendments,
        relatedProvisions: doc.regulation.relatedProvisions,
        treaties: doc.regulation.treaties,
        recommendations: doc.regulation.recommendations,
        notices: doc.regulation.notices,
        signatureBlocks: doc.regulation.signatureBlocks,
        tableOfProvisions: doc.regulation.tableOfProvisions,
      });
      stats.regulationsInserted++;
    }

    // Batch insert sections (much faster than row-by-row)
    if (doc.sections.length > 0) {
      const sectionValues = doc.sections.map((section) => ({
        actId: section.actId,
        regulationId: section.regulationId,
        canonicalSectionId: section.canonicalSectionId,
        sectionLabel: section.sectionLabel,
        sectionOrder: section.sectionOrder,
        language: section.language,
        sectionType: section.sectionType,
        hierarchyPath: section.hierarchyPath,
        marginalNote: section.marginalNote,
        content: section.content,
        contentTree: section.contentTree,
        status: section.status,
        xmlType: section.xmlType,
        xmlTarget: section.xmlTarget,
        changeType: section.changeType,
        inForceStartDate: section.inForceStartDate,
        lastAmendedDate: section.lastAmendedDate,
        enactedDate: section.enactedDate,
        limsMetadata: section.limsMetadata,
        historicalNotes: section.historicalNotes,
        footnotes: section.footnotes,
        scheduleId: section.scheduleId,
        scheduleBilingual: section.scheduleBilingual,
        scheduleSpanLanguages: section.scheduleSpanLanguages,
        scheduleOriginatingRef: section.scheduleOriginatingRef,
        contentFlags: section.contentFlags,
        formattingAttributes: section.formattingAttributes,
        provisionHeading: section.provisionHeading,
        internalReferences: section.internalReferences ?? null,
      }));

      // Insert sections in batches to avoid PostgreSQL parameter limit
      for (let i = 0; i < sectionValues.length; i += INSERT_BATCH_SIZE) {
        const batch = sectionValues.slice(i, i + INSERT_BATCH_SIZE);
        await tx.insert(sections).values(batch);
      }
      stats.sectionsInserted += doc.sections.length;
    }

    // Batch insert defined terms (usually small, but batch anyway for consistency)
    if (doc.definedTerms.length > 0) {
      const termValues = doc.definedTerms.map((term) => ({
        language: term.language,
        term: term.term,
        termNormalized: term.termNormalized,
        pairedTerm: term.pairedTerm,
        definition: term.definition,
        actId: term.actId,
        regulationId: term.regulationId,
        sectionLabel: term.sectionLabel,
        scopeType: term.scopeType,
        scopeSections: term.scopeSections,
        scopeRawText: term.scopeRawText,
        limsMetadata: term.limsMetadata,
      }));

      for (let i = 0; i < termValues.length; i += INSERT_BATCH_SIZE) {
        const batch = termValues.slice(i, i + INSERT_BATCH_SIZE);
        await tx.insert(definedTerms).values(batch);
      }
      stats.definedTermsInserted += doc.definedTerms.length;
    }

    // Batch insert cross references
    if (doc.crossReferences.length > 0) {
      const refValues = doc.crossReferences.map((ref) => ({
        sourceActId: ref.sourceActId,
        sourceRegulationId: ref.sourceRegulationId,
        sourceSectionLabel: ref.sourceSectionLabel,
        targetType: ref.targetType,
        targetRef: ref.targetRef,
        referenceText: ref.referenceText,
      }));

      for (let i = 0; i < refValues.length; i += INSERT_BATCH_SIZE) {
        const batch = refValues.slice(i, i + INSERT_BATCH_SIZE);
        await tx.insert(crossReferences).values(batch);
      }
      stats.crossReferencesInserted += doc.crossReferences.length;
    }
  });
}

/**
 * Check if a file should be skipped based on SQLite progress tracker.
 * Much faster than querying Postgres for each file.
 */
function shouldSkipFile(file: {
  type: LegislationType;
  id: string;
  language: Language;
}): boolean {
  if (!skipExisting) {
    return false;
  }

  // For regulations, normalize the ID from the filename
  const id =
    file.type === "regulation" ? normalizeRegulationId(file.id) : file.id;
  return fileAlreadyImported(file.type, id, file.language);
}

/**
 * Filter files by specific IDs
 */
function filterByIds(
  files: {
    path: string;
    type: LegislationType;
    language: Language;
    id: string;
  }[],
  ids: string[]
): { path: string; type: LegislationType; language: Language; id: string }[] {
  return files.filter((file) => {
    // For regulations, normalize the ID for comparison
    const normalizedFileId =
      file.type === "regulation" ? normalizeRegulationId(file.id) : file.id;

    return ids.some((id) => {
      const normalizedId =
        file.type === "regulation" ? normalizeRegulationId(id) : id;
      return normalizedFileId === normalizedId || file.id === id;
    });
  });
}

/**
 * Truncate all legislation tables
 */
async function truncateLegislationTables() {
  log("Truncating all legislation tables...");
  // Use raw SQL for TRUNCATE CASCADE since Drizzle doesn't support it directly
  await client`TRUNCATE TABLE legislation.sections CASCADE`;
  await client`TRUNCATE TABLE legislation.defined_terms CASCADE`;
  await client`TRUNCATE TABLE legislation.cross_references CASCADE`;
  await client`TRUNCATE TABLE legislation.regulations CASCADE`;
  await client`TRUNCATE TABLE legislation.acts CASCADE`;
  log("All legislation tables truncated");
}

/**
 * Main import function
 */
async function main() {
  log("Starting legislation import");
  if (isProd) {
    log("⚠️  PRODUCTION MODE - Using .env.production.local");
  }
  log(
    `Options: limit=${limit || "none"}, dry-run=${dryRun}, skip-existing=${skipExisting}, truncate=${truncateMode}, type=${typeArg || "all"}, lang=${langArg || "all"}, subset=${subsetName || "none"}, ids=${specificIds ? specificIds.length : "none"}, images=${downloadImages}`
  );

  // Truncate tables if requested (with confirmation unless --force)
  if (truncateMode && !dryRun) {
    if (!forceMode) {
      const confirmed = await confirmTruncate();
      if (!confirmed) {
        process.exit(0);
      }
    }
    await truncateLegislationTables();
    // Also clear SQLite progress tracker to stay in sync
    getProgressTracker().clearAll();
    log("SQLite progress cache cleared");
  }

  // Load lookup.xml metadata for enrichment
  lookupData = loadLookupData();

  // Resolve subset if specified (requires lookup.xml)
  let resolvedSubset: ResolvedSubset | null = null;

  if (subsetName) {
    if (!lookupData) {
      log("ERROR: --subset requires lookup.xml but it could not be loaded");
      log(`Expected location: ${LOOKUP_PATH}`);
      process.exit(1);
    }

    try {
      resolvedSubset = resolveSubset(
        subsetName as "strategic" | "smoke",
        lookupData
      );
      log("");
      log(`=== Subset: ${resolvedSubset.name} ===`);
      log(`Acts: ${resolvedSubset.actIds.size}`);
      log(`Regulations: ${resolvedSubset.regulationFilenames.size}`);
    } catch (error) {
      log(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  // Get list of files to process
  let files: {
    path: string;
    type: LegislationType;
    language: Language;
    id: string;
  }[];

  if (specificIds) {
    // Filter by specific IDs (existing functionality)
    const allFiles = getLegislationFiles(
      BASE_PATH,
      typeArg,
      undefined,
      langArg
    );
    files = filterByIds(allFiles, specificIds);
    log(`Filtering by ${specificIds.length} specific IDs`);
  } else {
    // Normal mode - get all files with optional type/lang/limit filters
    files = getLegislationFiles(
      BASE_PATH,
      typeArg,
      limit ? Number.parseInt(limit, 10) : undefined,
      langArg
    );
  }

  // Apply subset filter
  if (resolvedSubset) {
    const beforeCount = files.length;

    files = files.filter((file) => {
      if (file.type === "act") {
        return resolvedSubset.actIds.has(file.id);
      }
      // For regulations, file.id is already in filename format
      return resolvedSubset.regulationFilenames.has(file.id);
    });

    log(`Filtered: ${beforeCount} → ${files.length} files`);

    // In dry-run mode, show detailed breakdown
    if (dryRun) {
      const actFiles = files.filter((f) => f.type === "act");
      const regFiles = files.filter((f) => f.type === "regulation");

      log("");
      log("=== Subset Dry Run ===");
      log(`Total files: ${files.length}`);
      log(
        `  Acts: ${actFiles.length} (${actFiles.filter((f) => f.language === "en").length} EN, ${actFiles.filter((f) => f.language === "fr").length} FR)`
      );
      log(
        `  Regulations: ${regFiles.length} (${regFiles.filter((f) => f.language === "en").length} EN, ${regFiles.filter((f) => f.language === "fr").length} FR)`
      );
      log("");
      log("Act IDs:");
      for (const actId of resolvedSubset.actIds) {
        log(`  ${actId}`);
      }
      log("");
      log(
        `Regulation files: ${resolvedSubset.regulationFilenames.size} unique`
      );
    }
  }

  log(`Found ${files.length} files to process`);

  for (const file of files) {
    try {
      const skipDbInsert = shouldSkipFile(file);

      // If skipping DB insert but not collecting images, skip entirely
      if (skipDbInsert && !downloadImages) {
        stats.filesSkipped++;
        logVerbose(`Skipping (already exists): ${file.path}`);
        continue;
      }

      logVerbose(`Processing: ${file.path}`);

      const doc = parseLegislationXml(file.path, file.language);
      enrichDocumentWithLookup(doc);

      // Collect image sources for later downloading
      if (downloadImages) {
        collectImageSources(doc);
      }

      // Skip DB insert if already imported
      if (skipDbInsert) {
        stats.filesSkipped++;
        continue;
      }

      await insertDocument(doc);

      // Mark as imported in SQLite progress tracker
      const id =
        file.type === "regulation" ? normalizeRegulationId(file.id) : file.id;
      markFileImported(file.type, id, file.language);

      stats.filesProcessed++;

      if (stats.filesProcessed % 10 === 0) {
        log(
          `Processed ${stats.filesProcessed}/${files.length} files (${stats.filesSkipped} skipped)...`
        );
      }
    } catch (error) {
      stats.filesFailed++;
      const err = error as Error & { cause?: Error };
      const cause = err.cause as Record<string, unknown> | undefined;
      if (cause) {
        // Log the PostgreSQL error details
        log(`ERROR processing ${file.path}:`);
        log(`  Cause keys: ${Object.keys(cause).join(", ")}`);
        if (cause.code) {
          log(`  Code: ${cause.code}`);
        }
        if (cause.severity) {
          log(`  Severity: ${cause.severity}`);
        }
        if (cause.detail) {
          log(`  Detail: ${String(cause.detail).slice(0, 300)}`);
        }
        if (cause.column) {
          log(`  Column: ${cause.column}`);
        }
        if (cause.constraint) {
          log(`  Constraint: ${cause.constraint}`);
        }
        if (cause.hint) {
          log(`  Hint: ${cause.hint}`);
        }
      } else {
        log(`ERROR processing ${file.path}: (no cause)`);
      }
    }
  }

  // Link bilingual defined term pairs
  // This must happen after all files are processed so both EN and FR terms exist
  if (stats.definedTermsInserted > 0 || !dryRun) {
    log("");
    log("=== Linking Bilingual Term Pairs ===");
    try {
      const linkStats = await linkDefinedTermPairs(db, { dryRun });
      stats.termPairsLinked = linkStats.pairsLinked;
      stats.termPairsNoMatch = linkStats.noMatchFound;
      log(`Term pairs linked: ${stats.termPairsLinked}`);
      if (stats.termPairsNoMatch > 0) {
        log(`Terms without match: ${stats.termPairsNoMatch}`);
      }
    } catch (error) {
      log(
        `ERROR linking term pairs: ${error instanceof Error ? error.message : String(error)}`
      );
      if (verbose && error instanceof Error) {
        console.error(error.stack);
      }
    }
  }

  // Download images if requested
  if (downloadImages && !dryRun) {
    await downloadAllImages();
  } else if (downloadImages && dryRun) {
    log("");
    log("=== Images (Dry Run) ===");
    log(`Would download ${imageSourcesToDownload.size} unique images`);
    if (verbose) {
      for (const source of imageSourcesToDownload) {
        log(`  ${source}`);
      }
    }
  }

  log("");
  log("=== Import Complete ===");
  log(`Files processed: ${stats.filesProcessed}`);
  log(`Files skipped: ${stats.filesSkipped}`);
  log(`Files failed: ${stats.filesFailed}`);
  if (!dryRun) {
    log(`Acts inserted: ${stats.actsInserted}`);
    log(`Regulations inserted: ${stats.regulationsInserted}`);
    log(`Sections inserted: ${stats.sectionsInserted}`);
    log(`Defined terms inserted: ${stats.definedTermsInserted}`);
    log(`Cross references inserted: ${stats.crossReferencesInserted}`);
    log(`Term pairs linked: ${stats.termPairsLinked}`);
    if (downloadImages) {
      log(`Images downloaded: ${stats.imagesDownloaded}`);
      if (stats.imagesExisting > 0) {
        log(`Images existing: ${stats.imagesExisting}`);
      }
      if (stats.imagesFailed > 0) {
        log(`Images failed: ${stats.imagesFailed}`);
      }
    }
  }

  // Clean up SQLite connection
  if (progressTracker) {
    progressTracker.close();
  }

  process.exit(stats.filesFailed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  // Clean up SQLite connection on error
  if (progressTracker) {
    progressTracker.close();
  }
  process.exit(1);
});
