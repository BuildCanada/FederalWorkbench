/**
 * Verify Legislation Import Completeness
 *
 * This script compares the canonical XML source files to the PostgreSQL database
 * to ensure that every detail is correctly captured during import.
 *
 * Usage:
 *   npx tsx scripts/verify-legislation.ts [options]
 *
 * Options:
 *   --act=ID         Verify a specific act (e.g., --act=A-1)
 *   --regulation=ID  Verify a specific regulation (e.g., --regulation=SOR-2000-1)
 *   --type=act|regulation  Verify all documents of a type
 *   --lang=en|fr     Verify only a specific language
 *   --verbose        Show detailed output
 *   --sample         Verify the sample set (same as import --sample)
 *   --fix            Attempt to fix discrepancies (not implemented yet)
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import { existsSync, readFileSync } from "node:fs";
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
import { parseActXml, parseRegulationXml } from "@/lib/legislation/parser";
import type {
  Language,
  ParsedAct,
  ParsedCrossReference,
  ParsedDefinedTerm,
  ParsedRegulation,
  ParsedSection,
} from "@/lib/legislation/types";

// Database connection
const connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error("POSTGRES_URL environment variable is required");
}

const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

// Parse command line arguments
const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const sampleMode = args.includes("--sample");
const cliActId = args.find((a) => a.startsWith("--act="))?.split("=")[1];
const cliRegulationId = args
  .find((a) => a.startsWith("--regulation="))
  ?.split("=")[1];
const typeFilter = args.find((a) => a.startsWith("--type="))?.split("=")[1] as
  | "act"
  | "regulation"
  | undefined;
const langFilter = args.find((a) => a.startsWith("--lang="))?.split("=")[1] as
  | Language
  | undefined;

const BASE_PATH = "./data/legislation";

// Sample document IDs for comprehensive testing (must match import-legislation.ts)
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

// Sample regulations - normalized IDs as stored in DB
const SAMPLE_REGULATIONS = {
  // CRC regulations (Consolidated Regulations of Canada)
  CRC: {
    en: [
      "C.R.C._c. 10",
      "C.R.C._c. 100",
      "C.R.C._c. 101",
      "C.R.C._c. 102",
      "C.R.C._c. 103",
      "C.R.C._c. 104",
      "C.R.C._c. 1013",
    ],
    fr: [
      "C.R.C._ch. 10",
      "C.R.C._ch. 100",
      "C.R.C._ch. 101",
      "C.R.C._ch. 102",
      "C.R.C._ch. 103",
      "C.R.C._ch. 104",
      "C.R.C._ch. 1013",
    ],
  },
  // SI regulations (Statutory Instruments)
  SI: {
    en: [
      "SI-2000-100",
      "SI-2000-101",
      "SI-2000-102",
      "SI-2000-103",
      "SI-2000-104",
      "SI-2000-111",
      "SI-2000-16",
    ],
    fr: [
      "TR-2000-100",
      "TR-2000-101",
      "TR-2000-102",
      "TR-2000-103",
      "TR-2000-104",
      "TR-2000-111",
      "TR-2000-16",
    ],
  },
  // SOR regulations (Statutory Orders and Regulations)
  SOR: {
    en: [
      "SOR-2000-1",
      "SOR-2000-100",
      "SOR-2000-107",
      "SOR-2000-108",
      "SOR-2000-111",
      "SOR-2000-112",
    ],
    fr: [
      "DORS-2000-1",
      "DORS-2000-100",
      "DORS-2000-107",
      "DORS-2000-108",
      "DORS-2000-111",
      "DORS-2000-112",
    ],
  },
};

// Get all sample regulations for a language
function getSampleRegulations(lang: Language): string[] {
  const regs: string[] = [];
  for (const type of Object.values(SAMPLE_REGULATIONS)) {
    regs.push(...type[lang]);
  }
  return regs;
}

// Test fixtures for default mode (backwards compatibility)
const TEST_FIXTURES = {
  acts: {
    en: SAMPLE_ACTS,
    fr: SAMPLE_ACTS,
  },
  regulations: {
    en: getSampleRegulations("en"),
    fr: getSampleRegulations("fr"),
  },
};

type VerificationResult = {
  passed: boolean;
  documentId: string;
  documentType: "act" | "regulation";
  language: Language;
  errors: VerificationError[];
  warnings: VerificationWarning[];
  stats: {
    sectionsVerified: number;
    definedTermsVerified: number;
    crossReferencesVerified: number;
  };
};

type VerificationError = {
  field: string;
  expected: string | number | null | undefined;
  actual: string | number | null | undefined;
  context?: string;
};

type VerificationWarning = {
  message: string;
  context?: string;
};

function log(message: string) {
  console.log(`[verify] ${message}`);
}

function logVerbose(message: string) {
  if (verbose) {
    console.log(`  ${message}`);
  }
}

function normalizeText(text: string | null | undefined): string {
  if (!text) {
    return "";
  }
  return text.replace(/\s+/g, " ").trim();
}

function compareDates(
  xmlDate: string | undefined,
  dbDate: string | null
): boolean {
  if (!xmlDate && !dbDate) {
    return true;
  }
  if (!xmlDate || !dbDate) {
    return false;
  }
  return xmlDate === dbDate;
}

/**
 * Deep equality comparison that ignores key ordering in objects
 * Treats undefined and null as equivalent
 * Treats keys with undefined values as equivalent to missing keys
 */
function deepEqual(a: unknown, b: unknown): boolean {
  // Handle null/undefined equivalence
  if (a === null || a === undefined) {
    return b === null || b === undefined;
  }
  if (b === null || b === undefined) {
    return false;
  }

  // Primitive comparison
  if (typeof a !== "object" || typeof b !== "object") {
    return a === b;
  }

  // Array comparison
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }

  // One is array, one is not
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  // Object comparison (ignores key ordering and undefined values)
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;

  // Filter out keys with undefined values for comparison
  const aKeys = Object.keys(aObj).filter((k) => aObj[k] !== undefined);
  const bKeys = Object.keys(bObj).filter((k) => bObj[k] !== undefined);

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  for (const key of aKeys) {
    // Key with undefined in b is treated as missing
    if (bObj[key] === undefined) {
      return false;
    }
    if (!deepEqual(aObj[key], bObj[key])) {
      return false;
    }
  }

  return true;
}

/**
 * Compare two values, treating undefined and null as equivalent
 */
function compareOptional(
  xmlValue: string | undefined | null,
  dbValue: string | undefined | null
): boolean {
  const xmlNorm = xmlValue ?? null;
  const dbNorm = dbValue ?? null;
  return xmlNorm === dbNorm;
}

/**
 * Verify an Act document
 */
async function verifyAct(
  actId: string,
  language: Language
): Promise<VerificationResult> {
  const errors: VerificationError[] = [];
  const warnings: VerificationWarning[] = [];
  let sectionsVerified = 0;
  let definedTermsVerified = 0;
  let crossReferencesVerified = 0;

  // Determine file path based on language
  const filePath =
    language === "en"
      ? `${BASE_PATH}/eng/acts/${actId}.xml`
      : `${BASE_PATH}/fra/lois/${actId}.xml`;

  if (!existsSync(filePath)) {
    errors.push({
      field: "file",
      expected: filePath,
      actual: "FILE NOT FOUND",
      context: `Cannot find XML file for ${actId} (${language})`,
    });
    return {
      passed: false,
      documentId: actId,
      documentType: "act",
      language,
      errors,
      warnings,
      stats: {
        sectionsVerified,
        definedTermsVerified,
        crossReferencesVerified,
      },
    };
  }

  // Parse XML
  logVerbose(`Parsing XML: ${filePath}`);
  const xmlContent = readFileSync(filePath, "utf-8");
  const parsed = parseActXml(xmlContent, language);

  if (!parsed.act) {
    errors.push({
      field: "parsing",
      expected: "valid act data",
      actual: "null",
      context: "Failed to parse act from XML",
    });
    return {
      passed: false,
      documentId: actId,
      documentType: "act",
      language,
      errors,
      warnings,
      stats: {
        sectionsVerified,
        definedTermsVerified,
        crossReferencesVerified,
      },
    };
  }

  // Fetch act from database (query by actId AND language for per-language records)
  const dbActs = await db
    .select()
    .from(acts)
    .where(and(eq(acts.actId, actId), eq(acts.language, language)))
    .limit(1);

  if (dbActs.length === 0) {
    errors.push({
      field: "database",
      expected: actId,
      actual: "NOT FOUND",
      context: "Act not found in database",
    });
    return {
      passed: false,
      documentId: actId,
      documentType: "act",
      language,
      errors,
      warnings,
      stats: {
        sectionsVerified,
        definedTermsVerified,
        crossReferencesVerified,
      },
    };
  }

  const dbAct = dbActs[0];

  // Verify Act metadata fields
  logVerbose("Verifying act metadata...");
  verifyActMetadata(parsed.act, dbAct, language, errors);

  // Verify sections
  logVerbose("Verifying sections...");
  const dbSections = await db
    .select()
    .from(sections)
    .where(and(eq(sections.actId, actId), eq(sections.language, language)));

  sectionsVerified = verifySections(
    parsed.sections,
    dbSections,
    errors,
    warnings
  );

  // Verify defined terms
  logVerbose("Verifying defined terms...");
  const dbDefinedTerms = await db
    .select()
    .from(definedTerms)
    .where(eq(definedTerms.actId, actId));

  definedTermsVerified = verifyDefinedTerms(
    parsed.definedTerms,
    dbDefinedTerms,
    errors,
    warnings
  );

  // Verify cross references
  logVerbose("Verifying cross references...");
  const dbCrossRefs = await db
    .select()
    .from(crossReferences)
    .where(eq(crossReferences.sourceActId, actId));

  crossReferencesVerified = verifyCrossReferences(
    parsed.crossReferences,
    dbCrossRefs,
    errors,
    warnings
  );

  return {
    passed: errors.length === 0,
    documentId: actId,
    documentType: "act",
    language,
    errors,
    warnings,
    stats: { sectionsVerified, definedTermsVerified, crossReferencesVerified },
  };
}

/**
 * Convert normalized regulation ID back to filename format
 * e.g., "C.R.C._c. 10" -> "C.R.C.,_c._10"
 *       "SOR-2000-1" -> "SOR-2000-1"
 */
function regulationIdToFilename(
  normalizedId: string,
  language: Language
): string {
  let fileName = normalizedId;

  // Handle French language prefixes
  if (language === "fr") {
    fileName = fileName.replace("SOR-", "DORS-").replace("SI-", "TR-");
  }

  // Handle C.R.C. format: "C.R.C._c. 10" -> "C.R.C.,_c._10"
  if (fileName.startsWith("C.R.C.")) {
    // For CRC regulations, reconstruct the filename format
    // DB format: "C.R.C._c. 10" or "C.R.C._ch. 10" (French)
    // File format: "C.R.C.,_c._10" or "C.R.C.,_ch._10"
    fileName = fileName
      .replace("C.R.C._c. ", "C.R.C.,_c._")
      .replace("C.R.C._ch. ", "C.R.C.,_ch._");
  }

  return fileName;
}

/**
 * Verify a Regulation document
 */
async function verifyRegulation(
  regId: string,
  language: Language
): Promise<VerificationResult> {
  const errors: VerificationError[] = [];
  const warnings: VerificationWarning[] = [];
  let sectionsVerified = 0;
  let definedTermsVerified = 0;
  let crossReferencesVerified = 0;

  // Convert normalized ID to filename format
  const fileName = regulationIdToFilename(regId, language);

  // Determine file path based on language
  const filePath =
    language === "en"
      ? `${BASE_PATH}/eng/regulations/${fileName}.xml`
      : `${BASE_PATH}/fra/reglements/${fileName}.xml`;

  if (!existsSync(filePath)) {
    errors.push({
      field: "file",
      expected: filePath,
      actual: "FILE NOT FOUND",
      context: `Cannot find XML file for ${regId} (${language})`,
    });
    return {
      passed: false,
      documentId: regId,
      documentType: "regulation",
      language,
      errors,
      warnings,
      stats: {
        sectionsVerified,
        definedTermsVerified,
        crossReferencesVerified,
      },
    };
  }

  // Parse XML
  logVerbose(`Parsing XML: ${filePath}`);
  const xmlContent = readFileSync(filePath, "utf-8");
  const parsed = parseRegulationXml(xmlContent, language);

  if (!parsed.regulation) {
    errors.push({
      field: "parsing",
      expected: "valid regulation data",
      actual: "null",
      context: "Failed to parse regulation from XML",
    });
    return {
      passed: false,
      documentId: regId,
      documentType: "regulation",
      language,
      errors,
      warnings,
      stats: {
        sectionsVerified,
        definedTermsVerified,
        crossReferencesVerified,
      },
    };
  }

  // Normalize regulation ID for DB lookup
  const normalizedId = parsed.regulation.regulationId;

  // Fetch regulation from database (query by regulationId AND language for per-language records)
  const dbRegs = await db
    .select()
    .from(regulations)
    .where(
      and(
        eq(regulations.regulationId, normalizedId),
        eq(regulations.language, language)
      )
    )
    .limit(1);

  if (dbRegs.length === 0) {
    errors.push({
      field: "database",
      expected: normalizedId,
      actual: "NOT FOUND",
      context: "Regulation not found in database",
    });
    return {
      passed: false,
      documentId: regId,
      documentType: "regulation",
      language,
      errors,
      warnings,
      stats: {
        sectionsVerified,
        definedTermsVerified,
        crossReferencesVerified,
      },
    };
  }

  const dbReg = dbRegs[0];

  // Verify Regulation metadata fields
  logVerbose("Verifying regulation metadata...");
  verifyRegulationMetadata(parsed.regulation, dbReg, language, errors);

  // Verify sections
  logVerbose("Verifying sections...");
  const dbSections = await db
    .select()
    .from(sections)
    .where(
      and(
        eq(sections.regulationId, normalizedId),
        eq(sections.language, language)
      )
    );

  sectionsVerified = verifySections(
    parsed.sections,
    dbSections,
    errors,
    warnings
  );

  // Verify defined terms
  logVerbose("Verifying defined terms...");
  const dbDefinedTerms = await db
    .select()
    .from(definedTerms)
    .where(eq(definedTerms.regulationId, normalizedId));

  definedTermsVerified = verifyDefinedTerms(
    parsed.definedTerms,
    dbDefinedTerms,
    errors,
    warnings
  );

  // Verify cross references
  logVerbose("Verifying cross references...");
  const dbCrossRefs = await db
    .select()
    .from(crossReferences)
    .where(eq(crossReferences.sourceRegulationId, normalizedId));

  crossReferencesVerified = verifyCrossReferences(
    parsed.crossReferences,
    dbCrossRefs,
    errors,
    warnings
  );

  return {
    passed: errors.length === 0,
    documentId: regId,
    documentType: "regulation",
    language,
    errors,
    warnings,
    stats: { sectionsVerified, definedTermsVerified, crossReferencesVerified },
  };
}

/**
 * Verify Act metadata fields match between XML and database
 */
function verifyActMetadata(
  xml: ParsedAct,
  dbRecord: typeof acts.$inferSelect,
  _language: Language,
  errors: VerificationError[]
): void {
  // Verify actId
  if (xml.actId !== dbRecord.actId) {
    errors.push({
      field: "actId",
      expected: xml.actId,
      actual: dbRecord.actId,
    });
  }

  // Verify language
  if (xml.language !== dbRecord.language) {
    errors.push({
      field: "language",
      expected: xml.language,
      actual: dbRecord.language,
    });
  }

  // Verify title (per-language record has single title field)
  if (normalizeText(xml.title) !== normalizeText(dbRecord.title)) {
    errors.push({
      field: "title",
      expected: normalizeText(xml.title),
      actual: normalizeText(dbRecord.title),
    });
  }

  // Verify long title
  if (normalizeText(xml.longTitle) !== normalizeText(dbRecord.longTitle)) {
    errors.push({
      field: "longTitle",
      expected: normalizeText(xml.longTitle),
      actual: normalizeText(dbRecord.longTitle),
    });
  }

  // Verify running head
  if (normalizeText(xml.runningHead) !== normalizeText(dbRecord.runningHead)) {
    errors.push({
      field: "runningHead",
      expected: normalizeText(xml.runningHead),
      actual: normalizeText(dbRecord.runningHead),
    });
  }

  // Verify status
  if (xml.status !== dbRecord.status) {
    errors.push({
      field: "status",
      expected: xml.status,
      actual: dbRecord.status,
    });
  }

  // Verify dates
  if (!compareDates(xml.inForceDate, dbRecord.inForceDate)) {
    errors.push({
      field: "inForceDate",
      expected: xml.inForceDate,
      actual: dbRecord.inForceDate,
    });
  }

  if (!compareDates(xml.consolidationDate, dbRecord.consolidationDate)) {
    errors.push({
      field: "consolidationDate",
      expected: xml.consolidationDate,
      actual: dbRecord.consolidationDate,
    });
  }

  if (!compareDates(xml.lastAmendedDate, dbRecord.lastAmendedDate)) {
    errors.push({
      field: "lastAmendedDate",
      expected: xml.lastAmendedDate,
      actual: dbRecord.lastAmendedDate,
    });
  }

  if (!compareDates(xml.enactedDate, dbRecord.enactedDate)) {
    errors.push({
      field: "enactedDate",
      expected: xml.enactedDate,
      actual: dbRecord.enactedDate,
    });
  }

  // Verify bill metadata (treat undefined and null as equivalent)
  if (!compareOptional(xml.billOrigin, dbRecord.billOrigin)) {
    errors.push({
      field: "billOrigin",
      expected: xml.billOrigin,
      actual: dbRecord.billOrigin,
    });
  }

  if (!compareOptional(xml.billType, dbRecord.billType)) {
    errors.push({
      field: "billType",
      expected: xml.billType,
      actual: dbRecord.billType,
    });
  }

  if (!compareOptional(xml.hasPreviousVersion, dbRecord.hasPreviousVersion)) {
    errors.push({
      field: "hasPreviousVersion",
      expected: xml.hasPreviousVersion,
      actual: dbRecord.hasPreviousVersion,
    });
  }

  // Verify chapter info (treat undefined and null as equivalent)
  if (!compareOptional(xml.consolidatedNumber, dbRecord.consolidatedNumber)) {
    errors.push({
      field: "consolidatedNumber",
      expected: xml.consolidatedNumber,
      actual: dbRecord.consolidatedNumber,
    });
  }

  // Verify LIMS metadata (deep equality comparison)
  if (!deepEqual(xml.limsMetadata, dbRecord.limsMetadata)) {
    errors.push({
      field: "limsMetadata",
      expected: JSON.stringify(xml.limsMetadata || null),
      actual: JSON.stringify(dbRecord.limsMetadata || null),
    });
  }

  // Verify bill history (deep equality comparison)
  if (!deepEqual(xml.billHistory, dbRecord.billHistory)) {
    errors.push({
      field: "billHistory",
      expected: JSON.stringify(xml.billHistory || null),
      actual: JSON.stringify(dbRecord.billHistory || null),
    });
  }

  // Verify recent amendments (deep equality comparison)
  if (!deepEqual(xml.recentAmendments, dbRecord.recentAmendments)) {
    errors.push({
      field: "recentAmendments",
      expected: JSON.stringify(xml.recentAmendments || null),
      actual: JSON.stringify(dbRecord.recentAmendments || null),
    });
  }
}

/**
 * Verify Regulation metadata fields match between XML and database
 */
function verifyRegulationMetadata(
  xml: ParsedRegulation,
  dbRecord: typeof regulations.$inferSelect,
  _language: Language,
  errors: VerificationError[]
): void {
  // Verify regulationId
  if (xml.regulationId !== dbRecord.regulationId) {
    errors.push({
      field: "regulationId",
      expected: xml.regulationId,
      actual: dbRecord.regulationId,
    });
  }

  // Verify instrumentNumber
  if (xml.instrumentNumber !== dbRecord.instrumentNumber) {
    errors.push({
      field: "instrumentNumber",
      expected: xml.instrumentNumber,
      actual: dbRecord.instrumentNumber,
    });
  }

  // Verify regulationType (treat undefined and null as equivalent)
  if (!compareOptional(xml.regulationType, dbRecord.regulationType)) {
    errors.push({
      field: "regulationType",
      expected: xml.regulationType,
      actual: dbRecord.regulationType,
    });
  }

  // Verify gazettePart (treat undefined and null as equivalent)
  if (!compareOptional(xml.gazettePart, dbRecord.gazettePart)) {
    errors.push({
      field: "gazettePart",
      expected: xml.gazettePart,
      actual: dbRecord.gazettePart,
    });
  }

  // Verify language
  if (xml.language !== dbRecord.language) {
    errors.push({
      field: "language",
      expected: xml.language,
      actual: dbRecord.language,
    });
  }

  // Verify title (per-language record has single title field)
  if (normalizeText(xml.title) !== normalizeText(dbRecord.title)) {
    errors.push({
      field: "title",
      expected: normalizeText(xml.title),
      actual: normalizeText(dbRecord.title),
    });
  }

  // Verify long title
  if (normalizeText(xml.longTitle) !== normalizeText(dbRecord.longTitle)) {
    errors.push({
      field: "longTitle",
      expected: normalizeText(xml.longTitle),
      actual: normalizeText(dbRecord.longTitle),
    });
  }

  // Verify enabling act title
  if (
    normalizeText(xml.enablingActTitle) !==
    normalizeText(dbRecord.enablingActTitle)
  ) {
    errors.push({
      field: "enablingActTitle",
      expected: normalizeText(xml.enablingActTitle),
      actual: normalizeText(dbRecord.enablingActTitle),
    });
  }

  // Verify enabling act info (treat undefined and null as equivalent)
  if (!compareOptional(xml.enablingActId, dbRecord.enablingActId)) {
    errors.push({
      field: "enablingActId",
      expected: xml.enablingActId,
      actual: dbRecord.enablingActId,
    });
  }

  // Verify status
  if (xml.status !== dbRecord.status) {
    errors.push({
      field: "status",
      expected: xml.status,
      actual: dbRecord.status,
    });
  }

  // Verify hasPreviousVersion (treat undefined and null as equivalent)
  if (!compareOptional(xml.hasPreviousVersion, dbRecord.hasPreviousVersion)) {
    errors.push({
      field: "hasPreviousVersion",
      expected: xml.hasPreviousVersion,
      actual: dbRecord.hasPreviousVersion,
    });
  }

  // Verify dates
  if (!compareDates(xml.registrationDate, dbRecord.registrationDate)) {
    errors.push({
      field: "registrationDate",
      expected: xml.registrationDate,
      actual: dbRecord.registrationDate,
    });
  }

  if (!compareDates(xml.consolidationDate, dbRecord.consolidationDate)) {
    errors.push({
      field: "consolidationDate",
      expected: xml.consolidationDate,
      actual: dbRecord.consolidationDate,
    });
  }

  if (!compareDates(xml.lastAmendedDate, dbRecord.lastAmendedDate)) {
    errors.push({
      field: "lastAmendedDate",
      expected: xml.lastAmendedDate,
      actual: dbRecord.lastAmendedDate,
    });
  }

  // Verify LIMS metadata (deep equality comparison)
  if (!deepEqual(xml.limsMetadata, dbRecord.limsMetadata)) {
    errors.push({
      field: "limsMetadata",
      expected: JSON.stringify(xml.limsMetadata || null),
      actual: JSON.stringify(dbRecord.limsMetadata || null),
    });
  }

  // Verify regulation maker/order (deep equality comparison)
  if (!deepEqual(xml.regulationMakerOrder, dbRecord.regulationMakerOrder)) {
    errors.push({
      field: "regulationMakerOrder",
      expected: JSON.stringify(xml.regulationMakerOrder || null),
      actual: JSON.stringify(dbRecord.regulationMakerOrder || null),
    });
  }

  // Verify recent amendments (deep equality comparison)
  if (!deepEqual(xml.recentAmendments, dbRecord.recentAmendments)) {
    errors.push({
      field: "recentAmendments",
      expected: JSON.stringify(xml.recentAmendments || null),
      actual: JSON.stringify(dbRecord.recentAmendments || null),
    });
  }
}

/**
 * Verify sections match between XML and database
 */
function verifySections(
  xmlSections: ParsedSection[],
  dbSections: (typeof sections.$inferSelect)[],
  errors: VerificationError[],
  warnings: VerificationWarning[]
): number {
  let verified = 0;

  // Create map of DB sections by canonical ID
  const dbSectionMap = new Map<string, typeof sections.$inferSelect>();
  for (const section of dbSections) {
    dbSectionMap.set(section.canonicalSectionId, section);
  }

  // Verify each XML section exists in DB
  for (const xmlSection of xmlSections) {
    const dbSection = dbSectionMap.get(xmlSection.canonicalSectionId);

    if (!dbSection) {
      errors.push({
        field: "section",
        expected: xmlSection.canonicalSectionId,
        actual: "NOT FOUND",
        context: `Section ${xmlSection.sectionLabel} not found in database`,
      });
      continue;
    }

    // Verify section fields
    if (xmlSection.sectionLabel !== dbSection.sectionLabel) {
      errors.push({
        field: `section[${xmlSection.canonicalSectionId}].sectionLabel`,
        expected: xmlSection.sectionLabel,
        actual: dbSection.sectionLabel,
      });
    }

    if (xmlSection.sectionOrder !== dbSection.sectionOrder) {
      errors.push({
        field: `section[${xmlSection.canonicalSectionId}].sectionOrder`,
        expected: xmlSection.sectionOrder,
        actual: dbSection.sectionOrder,
      });
    }

    if (xmlSection.language !== dbSection.language) {
      errors.push({
        field: `section[${xmlSection.canonicalSectionId}].language`,
        expected: xmlSection.language,
        actual: dbSection.language,
      });
    }

    // Verify section type
    if (xmlSection.sectionType !== dbSection.sectionType) {
      errors.push({
        field: `section[${xmlSection.canonicalSectionId}].sectionType`,
        expected: xmlSection.sectionType,
        actual: dbSection.sectionType,
      });
    }

    // Compare hierarchy paths (deep equality comparison)
    if (!deepEqual(xmlSection.hierarchyPath, dbSection.hierarchyPath)) {
      errors.push({
        field: `section[${xmlSection.canonicalSectionId}].hierarchyPath`,
        expected: JSON.stringify(xmlSection.hierarchyPath || []),
        actual: JSON.stringify(dbSection.hierarchyPath || []),
      });
    }

    // Compare marginal notes
    if (
      normalizeText(xmlSection.marginalNote) !==
      normalizeText(dbSection.marginalNote)
    ) {
      errors.push({
        field: `section[${xmlSection.canonicalSectionId}].marginalNote`,
        expected: normalizeText(xmlSection.marginalNote),
        actual: normalizeText(dbSection.marginalNote),
      });
    }

    // Compare content (normalize whitespace)
    if (
      normalizeText(xmlSection.content) !== normalizeText(dbSection.content)
    ) {
      errors.push({
        field: `section[${xmlSection.canonicalSectionId}].content`,
        expected: `${normalizeText(xmlSection.content).substring(0, 100)}...`,
        actual: `${normalizeText(dbSection.content).substring(0, 100)}...`,
        context: "Content mismatch (truncated)",
      });
    }

    // Verify status
    if (xmlSection.status !== dbSection.status) {
      errors.push({
        field: `section[${xmlSection.canonicalSectionId}].status`,
        expected: xmlSection.status,
        actual: dbSection.status,
      });
    }

    // Verify XML type and target (treat undefined and null as equivalent)
    if (!compareOptional(xmlSection.xmlType, dbSection.xmlType)) {
      errors.push({
        field: `section[${xmlSection.canonicalSectionId}].xmlType`,
        expected: xmlSection.xmlType,
        actual: dbSection.xmlType,
      });
    }

    if (!compareOptional(xmlSection.xmlTarget, dbSection.xmlTarget)) {
      errors.push({
        field: `section[${xmlSection.canonicalSectionId}].xmlTarget`,
        expected: xmlSection.xmlTarget,
        actual: dbSection.xmlTarget,
      });
    }

    // Verify dates
    if (
      !compareDates(xmlSection.inForceStartDate, dbSection.inForceStartDate)
    ) {
      errors.push({
        field: `section[${xmlSection.canonicalSectionId}].inForceStartDate`,
        expected: xmlSection.inForceStartDate,
        actual: dbSection.inForceStartDate,
      });
    }

    if (!compareDates(xmlSection.lastAmendedDate, dbSection.lastAmendedDate)) {
      errors.push({
        field: `section[${xmlSection.canonicalSectionId}].lastAmendedDate`,
        expected: xmlSection.lastAmendedDate,
        actual: dbSection.lastAmendedDate,
      });
    }

    if (!compareDates(xmlSection.enactedDate, dbSection.enactedDate)) {
      errors.push({
        field: `section[${xmlSection.canonicalSectionId}].enactedDate`,
        expected: xmlSection.enactedDate,
        actual: dbSection.enactedDate,
      });
    }

    // Verify LIMS metadata (deep equality comparison)
    if (!deepEqual(xmlSection.limsMetadata, dbSection.limsMetadata)) {
      errors.push({
        field: `section[${xmlSection.canonicalSectionId}].limsMetadata`,
        expected: JSON.stringify(xmlSection.limsMetadata || null),
        actual: JSON.stringify(dbSection.limsMetadata || null),
      });
    }

    // Verify historical notes (deep equality comparison)
    if (!deepEqual(xmlSection.historicalNotes, dbSection.historicalNotes)) {
      errors.push({
        field: `section[${xmlSection.canonicalSectionId}].historicalNotes`,
        expected: JSON.stringify(xmlSection.historicalNotes || null),
        actual: JSON.stringify(dbSection.historicalNotes || null),
      });
    }

    // Verify footnotes (deep equality comparison)
    if (!deepEqual(xmlSection.footnotes, dbSection.footnotes)) {
      errors.push({
        field: `section[${xmlSection.canonicalSectionId}].footnotes`,
        expected: JSON.stringify(xmlSection.footnotes || null),
        actual: JSON.stringify(dbSection.footnotes || null),
      });
    }

    verified++;
  }

  // Check for extra sections in DB that aren't in XML
  const xmlSectionIds = new Set(xmlSections.map((s) => s.canonicalSectionId));
  for (const dbSection of dbSections) {
    if (!xmlSectionIds.has(dbSection.canonicalSectionId)) {
      warnings.push({
        message: `Extra section in DB not in XML: ${dbSection.canonicalSectionId}`,
      });
    }
  }

  return verified;
}

/**
 * Verify defined terms match between XML and database
 * Note: The same term can be defined differently in different sections,
 * so we use term + language + sectionLabel as the key.
 */
function verifyDefinedTerms(
  xmlTerms: ParsedDefinedTerm[],
  dbTerms: (typeof definedTerms.$inferSelect)[],
  errors: VerificationError[],
  _warnings: VerificationWarning[]
): number {
  let verified = 0;

  // Create map of DB terms by normalized term + language + section label
  // Same term can appear in multiple sections with different definitions
  const makeTermKey = (
    term: string,
    lang: string,
    sectionLabel?: string | null
  ) => `${term}:${lang}:${sectionLabel || ""}`;

  const dbTermMap = new Map<string, typeof definedTerms.$inferSelect>();
  for (const term of dbTerms) {
    dbTermMap.set(
      makeTermKey(term.termNormalized, term.language, term.sectionLabel),
      term
    );
  }

  // Verify each XML term exists in DB
  for (const xmlTerm of xmlTerms) {
    const termKey = makeTermKey(
      xmlTerm.termNormalized,
      xmlTerm.language,
      xmlTerm.sectionLabel
    );
    const dbTerm = dbTermMap.get(termKey);

    if (!dbTerm) {
      errors.push({
        field: "definedTerm",
        expected: xmlTerm.term,
        actual: "NOT FOUND",
        context: `Defined term "${xmlTerm.term}" (${xmlTerm.language}) in section ${xmlTerm.sectionLabel} not found in database`,
      });
      continue;
    }

    // Verify term text
    if (xmlTerm.term !== dbTerm.term) {
      errors.push({
        field: `definedTerm[${termKey}].term`,
        expected: xmlTerm.term,
        actual: dbTerm.term,
      });
    }

    // Verify definition (now language-specific, stored in `definition` column)
    if (
      normalizeText(xmlTerm.definition) !== normalizeText(dbTerm.definition)
    ) {
      errors.push({
        field: `definedTerm[${termKey}].definition`,
        expected: `${normalizeText(xmlTerm.definition).substring(0, 100)}...`,
        actual: `${normalizeText(dbTerm.definition).substring(0, 100)}...`,
        context: "Definition mismatch (truncated)",
      });
    }

    // Verify pairedTerm (treat undefined and null as equivalent)
    const xmlPairedTerm = xmlTerm.pairedTerm ?? null;
    const dbPairedTerm = dbTerm.pairedTerm ?? null;
    if (xmlPairedTerm !== dbPairedTerm) {
      errors.push({
        field: `definedTerm[${termKey}].pairedTerm`,
        expected: xmlPairedTerm,
        actual: dbPairedTerm,
      });
    }

    // Verify source section
    if (xmlTerm.sectionLabel !== dbTerm.sectionLabel) {
      errors.push({
        field: `definedTerm[${termKey}].sectionLabel`,
        expected: xmlTerm.sectionLabel,
        actual: dbTerm.sectionLabel,
      });
    }

    verified++;
  }

  return verified;
}

/**
 * Verify cross references match between XML and database
 */
function verifyCrossReferences(
  xmlRefs: ParsedCrossReference[],
  dbRefs: (typeof crossReferences.$inferSelect)[],
  _errors: VerificationError[],
  warnings: VerificationWarning[]
): number {
  let verified = 0;

  // Create a key for cross references
  const makeKey = (ref: {
    sourceSectionLabel?: string | null;
    targetType: string;
    targetRef: string;
  }) => `${ref.sourceSectionLabel || ""}:${ref.targetType}:${ref.targetRef}`;

  // Create map of DB refs
  const dbRefMap = new Map<string, typeof crossReferences.$inferSelect>();
  for (const ref of dbRefs) {
    dbRefMap.set(makeKey(ref), ref);
  }

  // Verify each XML ref exists in DB
  for (const xmlRef of xmlRefs) {
    const key = makeKey(xmlRef);
    const dbRef = dbRefMap.get(key);

    if (!dbRef) {
      // This is a warning not an error, as we may have duplicate refs
      warnings.push({
        message: `Cross reference not found in DB: ${key}`,
        context: xmlRef.referenceText || undefined,
      });
      continue;
    }

    verified++;
  }

  // Count how many DB refs aren't in XML
  const xmlRefKeys = new Set(xmlRefs.map(makeKey));
  let extraInDb = 0;
  for (const dbRef of dbRefs) {
    if (!xmlRefKeys.has(makeKey(dbRef))) {
      extraInDb++;
    }
  }

  if (extraInDb > 0) {
    warnings.push({
      message: `${extraInDb} extra cross references in DB not in XML`,
    });
  }

  return verified;
}

/**
 * Print verification results
 */
function printResult(result: VerificationResult): void {
  const status = result.passed ? "✓ PASSED" : "✗ FAILED";
  console.log(
    `\n${status}: ${result.documentType} ${result.documentId} (${result.language})`
  );
  console.log(
    `  Stats: ${result.stats.sectionsVerified} sections, ${result.stats.definedTermsVerified} defined terms, ${result.stats.crossReferencesVerified} cross refs`
  );

  if (result.errors.length > 0) {
    console.log(`  Errors (${result.errors.length}):`);
    for (const error of result.errors.slice(0, 10)) {
      console.log(
        `    - ${error.field}: expected "${error.expected}", got "${error.actual}"`
      );
      if (error.context) {
        console.log(`      Context: ${error.context}`);
      }
    }
    if (result.errors.length > 10) {
      console.log(`    ... and ${result.errors.length - 10} more errors`);
    }
  }

  if (result.warnings.length > 0 && verbose) {
    console.log(`  Warnings (${result.warnings.length}):`);
    for (const warning of result.warnings.slice(0, 5)) {
      console.log(`    - ${warning.message}`);
    }
    if (result.warnings.length > 5) {
      console.log(`    ... and ${result.warnings.length - 5} more warnings`);
    }
  }
}

/**
 * Main verification function
 */
async function main() {
  log("Starting legislation verification");
  log(
    `Options: act=${cliActId || "all"}, regulation=${cliRegulationId || "all"}, type=${typeFilter || "all"}, lang=${langFilter || "all"}, sample=${sampleMode}`
  );

  const results: VerificationResult[] = [];

  // If specific act or regulation is specified
  if (cliActId) {
    const languages: Language[] = langFilter ? [langFilter] : ["en", "fr"];
    for (const lang of languages) {
      results.push(await verifyAct(cliActId, lang));
    }
  } else if (cliRegulationId) {
    const languages: Language[] = langFilter ? [langFilter] : ["en", "fr"];
    for (const lang of languages) {
      results.push(await verifyRegulation(cliRegulationId, lang));
    }
  } else if (sampleMode) {
    // Use sample set for comprehensive testing
    log("Using sample set for verification");

    // Verify acts
    if (!typeFilter || typeFilter === "act") {
      const languages: Language[] = langFilter ? [langFilter] : ["en", "fr"];
      for (const lang of languages) {
        for (const id of SAMPLE_ACTS) {
          results.push(await verifyAct(id, lang));
        }
      }
    }

    // Verify regulations (all types: CRC, SI, SOR)
    if (!typeFilter || typeFilter === "regulation") {
      const languages: Language[] = langFilter ? [langFilter] : ["en", "fr"];
      for (const lang of languages) {
        for (const id of getSampleRegulations(lang)) {
          results.push(await verifyRegulation(id, lang));
        }
      }
    }
  } else {
    // Use test fixtures (default mode)
    if (!typeFilter || typeFilter === "act") {
      const actLangs = langFilter
        ? { [langFilter]: TEST_FIXTURES.acts[langFilter] }
        : TEST_FIXTURES.acts;

      for (const [lang, ids] of Object.entries(actLangs)) {
        for (const id of ids) {
          results.push(await verifyAct(id, lang as Language));
        }
      }
    }

    if (!typeFilter || typeFilter === "regulation") {
      const regLangs = langFilter
        ? { [langFilter]: TEST_FIXTURES.regulations[langFilter] }
        : TEST_FIXTURES.regulations;

      for (const [lang, ids] of Object.entries(regLangs)) {
        for (const id of ids) {
          results.push(await verifyRegulation(id, lang as Language));
        }
      }
    }
  }

  // Print results
  log("\n=== Verification Results ===");

  let passedCount = 0;
  let failedCount = 0;

  for (const result of results) {
    printResult(result);
    if (result.passed) {
      passedCount++;
    } else {
      failedCount++;
    }
  }

  log("\n=== Summary ===");
  log(`Passed: ${passedCount}/${results.length}`);
  log(`Failed: ${failedCount}/${results.length}`);

  process.exit(failedCount > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
