/**
 * Import Canadian Federal Legislation from XML files
 *
 * Usage:
 *   npx tsx scripts/import-legislation.ts [options]
 *
 * Options:
 *   --limit=N       Process only N files (for testing)
 *   --dry-run       Parse files but don't insert into database
 *   --type=act|regulation  Process only acts or regulations
 *   --lang=en|fr    Process only English or French files
 *   --skip-existing Skip files that have already been imported
 *   --truncate      Truncate all legislation tables before importing
 *   --verbose       Show detailed output
 *   --ids=ID1,ID2   Import specific document IDs (comma-separated)
 *                   For acts: A-1,A-0.6,C-11
 *                   For regulations: SOR-2000-1,SI-2000-100,C.R.C.,_c._10
 *   --sample        Import a sample of different regulation types (CRC, SI, SOR)
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import { and, eq } from "drizzle-orm";
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
  getLegislationFiles,
  normalizeRegulationId,
  parseLegislationXml,
} from "@/lib/legislation/parser";
import type {
  Language,
  LegislationType,
  ParsedDocument,
} from "@/lib/legislation/types";

// Database connection
const connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error("POSTGRES_URL environment variable is required");
}

const client = postgres(connectionString, { max: 10 });
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
const sampleMode = args.includes("--sample");
const truncateMode = args.includes("--truncate");

// Sample document IDs for comprehensive testing (mix of CRC, SI, SOR regulations)
const SAMPLE_ACTS = [
  "A-0.6",
  "A-1",
  "A-1.3",
  "A-1.5",
  "A-10.1",
  "A-10.4",
  "A-10.5",
  "A-10.6",
  "A-10.7",
  "A-11.2",
  "A-11.3",
  "A-11.31",
  "A-11.4",
  "A-11.44",
  "A-11.5",
  "A-11.7",
  "A-11.9",
  "A-12",
  "A-12.8",
  "A-13.4",
];

const SAMPLE_REGULATIONS = {
  // CRC regulations (Consolidated Regulations of Canada)
  CRC: [
    "C.R.C.,_c._10",
    "C.R.C.,_c._100",
    "C.R.C.,_c._101",
    "C.R.C.,_c._102",
    "C.R.C.,_c._103",
    "C.R.C.,_c._104",
    "C.R.C.,_c._1013",
  ],
  // SI regulations (Statutory Instruments)
  SI: [
    "SI-2000-100",
    "SI-2000-101",
    "SI-2000-102",
    "SI-2000-103",
    "SI-2000-104",
    "SI-2000-111",
    "SI-2000-16",
  ],
  // SOR regulations (Statutory Orders and Regulations)
  SOR: [
    "SOR-2000-1",
    "SOR-2000-100",
    "SOR-2000-107",
    "SOR-2000-108",
    "SOR-2000-111",
    "SOR-2000-112",
  ],
};

// French equivalents for sample regulations
const SAMPLE_REGULATIONS_FR = {
  CRC: [
    "C.R.C.,_ch._10",
    "C.R.C.,_ch._100",
    "C.R.C.,_ch._101",
    "C.R.C.,_ch._102",
    "C.R.C.,_ch._103",
    "C.R.C.,_ch._104",
    "C.R.C.,_ch._1013",
  ],
  SI: [
    "TR-2000-100",
    "TR-2000-101",
    "TR-2000-102",
    "TR-2000-103",
    "TR-2000-104",
    "TR-2000-111",
    "TR-2000-16",
  ],
  SOR: [
    "DORS-2000-1",
    "DORS-2000-100",
    "DORS-2000-107",
    "DORS-2000-108",
    "DORS-2000-111",
    "DORS-2000-112",
  ],
};

// Parse specific IDs if provided
const specificIds = idsArg ? idsArg.split(",").map((id) => id.trim()) : null;

const BASE_PATH = "./data/legislation";

type ImportStats = {
  filesProcessed: number;
  filesSkipped: number;
  filesFailed: number;
  actsInserted: number;
  regulationsInserted: number;
  sectionsInserted: number;
  definedTermsInserted: number;
  crossReferencesInserted: number;
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
};

/**
 * Check if an act already exists in the database for a specific language
 */
async function actExists(actId: string, language: Language): Promise<boolean> {
  const rows = await db
    .select({ id: acts.id })
    .from(acts)
    .where(and(eq(acts.actId, actId), eq(acts.language, language)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Check if a regulation already exists in the database for a specific language
 */
async function regulationExists(
  regulationId: string,
  language: Language
): Promise<boolean> {
  const rows = await db
    .select({ id: regulations.id })
    .from(regulations)
    .where(
      and(
        eq(regulations.regulationId, regulationId),
        eq(regulations.language, language)
      )
    )
    .limit(1);
  return rows.length > 0;
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
        recentAmendments: doc.regulation.recentAmendments,
        relatedProvisions: doc.regulation.relatedProvisions,
        treaties: doc.regulation.treaties,
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
        contentHtml: section.contentHtml,
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
      }));
      await tx.insert(sections).values(sectionValues);
      stats.sectionsInserted += doc.sections.length;
    }

    // Batch insert defined terms
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
      await tx.insert(definedTerms).values(termValues);
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
        targetSectionRef: ref.targetSectionRef,
        referenceText: ref.referenceText,
      }));
      await tx.insert(crossReferences).values(refValues);
      stats.crossReferencesInserted += doc.crossReferences.length;
    }
  });
}

/**
 * Check if a file should be skipped based on existing data
 */
async function shouldSkipFile(file: {
  type: LegislationType;
  id: string;
  language: Language;
}): Promise<boolean> {
  if (!skipExisting) {
    return false;
  }

  if (file.type === "act") {
    return await actExists(file.id, file.language);
  }
  // For regulations, we need to normalize the ID from the filename
  const normalizedId = normalizeRegulationId(file.id);
  return await regulationExists(normalizedId, file.language);
}

/**
 * Get sample files for comprehensive testing
 */
function getSampleFiles(): {
  path: string;
  type: LegislationType;
  language: Language;
  id: string;
}[] {
  const files: {
    path: string;
    type: LegislationType;
    language: Language;
    id: string;
  }[] = [];

  // Add acts (same IDs for EN and FR)
  if (!typeArg || typeArg === "act") {
    if (!langArg || langArg === "en") {
      for (const actId of SAMPLE_ACTS) {
        files.push({
          path: `${BASE_PATH}/eng/acts/${actId}.xml`,
          type: "act",
          language: "en",
          id: actId,
        });
      }
    }
    if (!langArg || langArg === "fr") {
      for (const actId of SAMPLE_ACTS) {
        files.push({
          path: `${BASE_PATH}/fra/lois/${actId}.xml`,
          type: "act",
          language: "fr",
          id: actId,
        });
      }
    }
  }

  // Add regulations (different IDs for EN and FR)
  if (!typeArg || typeArg === "regulation") {
    if (!langArg || langArg === "en") {
      for (const regs of Object.values(SAMPLE_REGULATIONS)) {
        for (const regId of regs) {
          files.push({
            path: `${BASE_PATH}/eng/regulations/${regId}.xml`,
            type: "regulation",
            language: "en",
            id: regId,
          });
        }
      }
    }
    if (!langArg || langArg === "fr") {
      for (const regs of Object.values(SAMPLE_REGULATIONS_FR)) {
        for (const regId of regs) {
          files.push({
            path: `${BASE_PATH}/fra/reglements/${regId}.xml`,
            type: "regulation",
            language: "fr",
            id: regId,
          });
        }
      }
    }
  }

  return files;
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
  await client`TRUNCATE TABLE legislation.cross_references CASCADE`;
  await client`TRUNCATE TABLE legislation.defined_terms CASCADE`;
  await client`TRUNCATE TABLE legislation.sections CASCADE`;
  await client`TRUNCATE TABLE legislation.regulations CASCADE`;
  await client`TRUNCATE TABLE legislation.acts CASCADE`;
  log("All legislation tables truncated");
}

/**
 * Main import function
 */
async function main() {
  log("Starting legislation import");
  log(
    `Options: limit=${limit || "none"}, dry-run=${dryRun}, skip-existing=${skipExisting}, truncate=${truncateMode}, type=${typeArg || "all"}, lang=${langArg || "all"}, sample=${sampleMode}, ids=${specificIds ? specificIds.length : "none"}`
  );

  // Truncate tables if requested
  if (truncateMode && !dryRun) {
    await truncateLegislationTables();
  }

  // Get list of files to process
  let files: {
    path: string;
    type: LegislationType;
    language: Language;
    id: string;
  }[];

  if (sampleMode) {
    // Use sample set for comprehensive testing
    files = getSampleFiles();
    log(`Using sample set: ${files.length} files`);
  } else if (specificIds) {
    // Get all files and filter by specific IDs
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

  log(`Found ${files.length} files to process`);

  for (const file of files) {
    try {
      // Check if we should skip this file
      if (await shouldSkipFile(file)) {
        stats.filesSkipped++;
        logVerbose(`Skipping (already exists): ${file.path}`);
        continue;
      }

      logVerbose(`Processing: ${file.path}`);

      const doc = parseLegislationXml(file.path, file.language);
      await insertDocument(doc);

      stats.filesProcessed++;

      if (stats.filesProcessed % 10 === 0) {
        log(
          `Processed ${stats.filesProcessed}/${files.length} files (${stats.filesSkipped} skipped)...`
        );
      }
    } catch (error) {
      stats.filesFailed++;
      log(
        `ERROR processing ${file.path}: ${error instanceof Error ? error.message : String(error)}`
      );
      if (verbose && error instanceof Error) {
        console.error(error.stack);
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
  }

  process.exit(stats.filesFailed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
