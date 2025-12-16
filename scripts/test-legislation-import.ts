/**
 * Deterministic Integration Test for Legislation Import Pipeline
 *
 * This script:
 * 1. Clears any existing test data
 * 2. Imports specific EN/FR acts and regulations from hardcoded XML files
 * 3. Verifies EVERY field matches between XML and database (100% data capture)
 * 4. Reports pass/fail with detailed discrepancies
 *
 * Usage:
 *   npx tsx scripts/test-legislation-import.ts
 *
 * Exit codes:
 *   0 - All tests passed
 *   1 - One or more tests failed
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import { existsSync, readFileSync } from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
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
import type { Language, ParsedDocument } from "@/lib/legislation/types";

// Database connection
const connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error("POSTGRES_URL environment variable is required");
}

const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

const BASE_PATH = "./data/legislation";

// ============================================================================
// TEST FIXTURES - Hardcoded XML files to test
// ============================================================================

const TEST_ACTS = [
  {
    id: "A-0.6",
    pathEn: `${BASE_PATH}/eng/acts/A-0.6.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-0.6.xml`,
  },
  {
    id: "A-1",
    pathEn: `${BASE_PATH}/eng/acts/A-1.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-1.xml`,
  },
  {
    id: "A-1.3",
    pathEn: `${BASE_PATH}/eng/acts/A-1.3.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-1.3.xml`,
  },
  {
    id: "A-1.5",
    pathEn: `${BASE_PATH}/eng/acts/A-1.5.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-1.5.xml`,
  },
  {
    id: "A-10.1",
    pathEn: `${BASE_PATH}/eng/acts/A-10.1.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-10.1.xml`,
  },
  {
    id: "A-10.4",
    pathEn: `${BASE_PATH}/eng/acts/A-10.4.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-10.4.xml`,
  },
  {
    id: "A-10.5",
    pathEn: `${BASE_PATH}/eng/acts/A-10.5.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-10.5.xml`,
  },
  {
    id: "A-10.6",
    pathEn: `${BASE_PATH}/eng/acts/A-10.6.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-10.6.xml`,
  },
  {
    id: "A-10.7",
    pathEn: `${BASE_PATH}/eng/acts/A-10.7.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-10.7.xml`,
  },
  {
    id: "A-11.2",
    pathEn: `${BASE_PATH}/eng/acts/A-11.2.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-11.2.xml`,
  },
  {
    id: "A-11.3",
    pathEn: `${BASE_PATH}/eng/acts/A-11.3.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-11.3.xml`,
  },
  {
    id: "A-11.31",
    pathEn: `${BASE_PATH}/eng/acts/A-11.31.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-11.31.xml`,
  },
  {
    id: "A-11.4",
    pathEn: `${BASE_PATH}/eng/acts/A-11.4.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-11.4.xml`,
  },
  {
    id: "A-11.44",
    pathEn: `${BASE_PATH}/eng/acts/A-11.44.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-11.44.xml`,
  },
  {
    id: "A-11.5",
    pathEn: `${BASE_PATH}/eng/acts/A-11.5.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-11.5.xml`,
  },
  {
    id: "A-11.7",
    pathEn: `${BASE_PATH}/eng/acts/A-11.7.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-11.7.xml`,
  },
  {
    id: "A-11.9",
    pathEn: `${BASE_PATH}/eng/acts/A-11.9.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-11.9.xml`,
  },
  {
    id: "A-12",
    pathEn: `${BASE_PATH}/eng/acts/A-12.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-12.xml`,
  },
  {
    id: "A-12.8",
    pathEn: `${BASE_PATH}/eng/acts/A-12.8.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-12.8.xml`,
  },
  {
    id: "A-13",
    pathEn: `${BASE_PATH}/eng/acts/A-13.xml`,
    pathFr: `${BASE_PATH}/fra/lois/A-13.xml`,
  },
];

const TEST_REGULATIONS = [
  // CRC regulations (10)
  {
    idEn: "C.R.C.,_c._10",
    idFr: "C.R.C.,_ch._10",
    pathEn: `${BASE_PATH}/eng/regulations/C.R.C.,_c._10.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/C.R.C.,_ch._10.xml`,
  },
  {
    idEn: "C.R.C.,_c._100",
    idFr: "C.R.C.,_ch._100",
    pathEn: `${BASE_PATH}/eng/regulations/C.R.C.,_c._100.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/C.R.C.,_ch._100.xml`,
  },
  {
    idEn: "C.R.C.,_c._101",
    idFr: "C.R.C.,_ch._101",
    pathEn: `${BASE_PATH}/eng/regulations/C.R.C.,_c._101.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/C.R.C.,_ch._101.xml`,
  },
  {
    idEn: "C.R.C.,_c._102",
    idFr: "C.R.C.,_ch._102",
    pathEn: `${BASE_PATH}/eng/regulations/C.R.C.,_c._102.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/C.R.C.,_ch._102.xml`,
  },
  {
    idEn: "C.R.C.,_c._103",
    idFr: "C.R.C.,_ch._103",
    pathEn: `${BASE_PATH}/eng/regulations/C.R.C.,_c._103.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/C.R.C.,_ch._103.xml`,
  },
  {
    idEn: "C.R.C.,_c._104",
    idFr: "C.R.C.,_ch._104",
    pathEn: `${BASE_PATH}/eng/regulations/C.R.C.,_c._104.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/C.R.C.,_ch._104.xml`,
  },
  {
    idEn: "C.R.C.,_c._105",
    idFr: "C.R.C.,_ch._105",
    pathEn: `${BASE_PATH}/eng/regulations/C.R.C.,_c._105.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/C.R.C.,_ch._105.xml`,
  },
  {
    idEn: "C.R.C.,_c._106",
    idFr: "C.R.C.,_ch._106",
    pathEn: `${BASE_PATH}/eng/regulations/C.R.C.,_c._106.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/C.R.C.,_ch._106.xml`,
  },
  {
    idEn: "C.R.C.,_c._109",
    idFr: "C.R.C.,_ch._109",
    pathEn: `${BASE_PATH}/eng/regulations/C.R.C.,_c._109.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/C.R.C.,_ch._109.xml`,
  },
  {
    idEn: "C.R.C.,_c._1013",
    idFr: "C.R.C.,_ch._1013",
    pathEn: `${BASE_PATH}/eng/regulations/C.R.C.,_c._1013.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/C.R.C.,_ch._1013.xml`,
  },
  // SOR/DORS regulations (10)
  {
    idEn: "SOR-2000-1",
    idFr: "DORS-2000-1",
    pathEn: `${BASE_PATH}/eng/regulations/SOR-2000-1.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/DORS-2000-1.xml`,
  },
  {
    idEn: "SOR-2000-100",
    idFr: "DORS-2000-100",
    pathEn: `${BASE_PATH}/eng/regulations/SOR-2000-100.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/DORS-2000-100.xml`,
  },
  {
    idEn: "SOR-2000-107",
    idFr: "DORS-2000-107",
    pathEn: `${BASE_PATH}/eng/regulations/SOR-2000-107.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/DORS-2000-107.xml`,
  },
  {
    idEn: "SOR-2000-108",
    idFr: "DORS-2000-108",
    pathEn: `${BASE_PATH}/eng/regulations/SOR-2000-108.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/DORS-2000-108.xml`,
  },
  {
    idEn: "SOR-2000-111",
    idFr: "DORS-2000-111",
    pathEn: `${BASE_PATH}/eng/regulations/SOR-2000-111.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/DORS-2000-111.xml`,
  },
  {
    idEn: "SOR-2000-112",
    idFr: "DORS-2000-112",
    pathEn: `${BASE_PATH}/eng/regulations/SOR-2000-112.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/DORS-2000-112.xml`,
  },
  {
    idEn: "SOR-2000-113",
    idFr: "DORS-2000-113",
    pathEn: `${BASE_PATH}/eng/regulations/SOR-2000-113.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/DORS-2000-113.xml`,
  },
  {
    idEn: "SOR-2000-131",
    idFr: "DORS-2000-131",
    pathEn: `${BASE_PATH}/eng/regulations/SOR-2000-131.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/DORS-2000-131.xml`,
  },
  {
    idEn: "SOR-2000-132",
    idFr: "DORS-2000-132",
    pathEn: `${BASE_PATH}/eng/regulations/SOR-2000-132.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/DORS-2000-132.xml`,
  },
  {
    idEn: "SOR-2000-14",
    idFr: "DORS-2000-14",
    pathEn: `${BASE_PATH}/eng/regulations/SOR-2000-14.xml`,
    pathFr: `${BASE_PATH}/fra/reglements/DORS-2000-14.xml`,
  },
];

// ============================================================================
// TYPES
// ============================================================================

type TestResult = {
  name: string;
  passed: boolean;
  errors: string[];
  stats: {
    sectionsVerified: number;
    definedTermsVerified: number;
    crossReferencesVerified: number;
  };
};

// ============================================================================
// UTILITIES
// ============================================================================

function log(message: string) {
  console.log(`[test] ${message}`);
}

function normalizeText(text: string | null | undefined): string {
  if (!text) {
    return "";
  }
  return text.replace(/\s+/g, " ").trim();
}

function compareOptionalStrings(
  xml: string | undefined | null,
  dbValue: string | undefined | null,
  fieldName: string,
  errors: string[]
): void {
  const xmlVal = xml ?? null;
  const dbVal = dbValue ?? null;
  if (xmlVal !== dbVal) {
    errors.push(`${fieldName}: expected "${xmlVal}", got "${dbVal}"`);
  }
}

function compareJsonb<T>(
  xml: T | undefined,
  dbValue: unknown,
  fieldName: string,
  errors: string[]
): void {
  const xmlJson = JSON.stringify(xml ?? null);
  const dbJson = JSON.stringify(dbValue ?? null);
  if (xmlJson !== dbJson) {
    errors.push(`${fieldName}: JSONB mismatch`);
  }
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function clearTestData() {
  log("Clearing existing test data...");

  const actIds = TEST_ACTS.map((a) => a.id);

  // Get regulation IDs (need to parse to get normalized IDs)
  const regIds: string[] = [];
  for (const reg of TEST_REGULATIONS) {
    if (existsSync(reg.pathEn)) {
      const xml = readFileSync(reg.pathEn, "utf-8");
      const parsed = parseRegulationXml(xml, "en");
      if (parsed.regulation?.regulationId) {
        regIds.push(parsed.regulation.regulationId);
      }
    }
    if (existsSync(reg.pathFr)) {
      const xml = readFileSync(reg.pathFr, "utf-8");
      const parsed = parseRegulationXml(xml, "fr");
      if (
        parsed.regulation?.regulationId &&
        !regIds.includes(parsed.regulation.regulationId)
      ) {
        regIds.push(parsed.regulation.regulationId);
      }
    }
  }

  // Delete in order (sections first due to FK constraints)
  await db
    .delete(crossReferences)
    .where(inArray(crossReferences.sourceActId, actIds));
  await db.delete(definedTerms).where(inArray(definedTerms.actId, actIds));
  await db.delete(sections).where(inArray(sections.actId, actIds));
  await db.delete(acts).where(inArray(acts.actId, actIds));

  if (regIds.length > 0) {
    await db
      .delete(crossReferences)
      .where(inArray(crossReferences.sourceRegulationId, regIds));
    await db
      .delete(definedTerms)
      .where(inArray(definedTerms.regulationId, regIds));
    await db.delete(sections).where(inArray(sections.regulationId, regIds));
    await db
      .delete(regulations)
      .where(inArray(regulations.regulationId, regIds));
  }

  log("Test data cleared.");
}

/**
 * Import act with ALL fields (matching import-legislation.ts)
 * Each language version is a separate record - no bilingual merging
 */
async function importActFromXml(
  xmlPath: string,
  language: Language
): Promise<ParsedDocument> {
  const xmlContent = readFileSync(xmlPath, "utf-8");
  const parsed = parseActXml(xmlContent, language);

  if (!parsed.act) {
    throw new Error(`Failed to parse act from ${xmlPath}`);
  }

  const act = parsed.act;

  // Insert act - one record per language, no merge needed
  await db.insert(acts).values({
    actId: act.actId,
    language: act.language,
    title: act.title,
    longTitle: act.longTitle,
    runningHead: act.runningHead,
    status: act.status,
    inForceDate: act.inForceDate,
    consolidationDate: act.consolidationDate,
    lastAmendedDate: act.lastAmendedDate,
    enactedDate: act.enactedDate,
    billOrigin: act.billOrigin,
    billType: act.billType,
    hasPreviousVersion: act.hasPreviousVersion,
    consolidatedNumber: act.consolidatedNumber,
    annualStatuteYear: act.annualStatuteYear,
    annualStatuteChapter: act.annualStatuteChapter,
    limsMetadata: act.limsMetadata,
    billHistory: act.billHistory,
    recentAmendments: act.recentAmendments,
  });

  // Insert sections with ALL fields
  for (const section of parsed.sections) {
    await db.insert(sections).values({
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
      inForceStartDate: section.inForceStartDate,
      lastAmendedDate: section.lastAmendedDate,
      enactedDate: section.enactedDate,
      limsMetadata: section.limsMetadata,
      historicalNotes: section.historicalNotes,
      footnotes: section.footnotes,
      scheduleId: section.scheduleId,
      scheduleBilingual: section.scheduleBilingual,
      scheduleSpanLanguages: section.scheduleSpanLanguages,
    });
  }

  // Insert defined terms with ALL fields
  for (const term of parsed.definedTerms) {
    await db.insert(definedTerms).values({
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
    });
  }

  // Insert cross references
  for (const ref of parsed.crossReferences) {
    await db.insert(crossReferences).values({
      sourceActId: ref.sourceActId,
      sourceRegulationId: ref.sourceRegulationId,
      sourceSectionLabel: ref.sourceSectionLabel,
      targetType: ref.targetType,
      targetRef: ref.targetRef,
      referenceText: ref.referenceText,
    });
  }

  return parsed;
}

/**
 * Import regulation with ALL fields (matching import-legislation.ts)
 * Each language version is a separate record - no bilingual merging
 */
async function importRegulationFromXml(
  xmlPath: string,
  language: Language
): Promise<ParsedDocument> {
  const xmlContent = readFileSync(xmlPath, "utf-8");
  const parsed = parseRegulationXml(xmlContent, language);

  if (!parsed.regulation) {
    throw new Error(`Failed to parse regulation from ${xmlPath}`);
  }

  const reg = parsed.regulation;

  // Insert regulation - one record per language, no merge needed
  await db.insert(regulations).values({
    regulationId: reg.regulationId,
    language: reg.language,
    instrumentNumber: reg.instrumentNumber,
    regulationType: reg.regulationType,
    gazettePart: reg.gazettePart,
    title: reg.title,
    longTitle: reg.longTitle,
    enablingActId: reg.enablingActId,
    enablingActTitle: reg.enablingActTitle,
    status: reg.status,
    hasPreviousVersion: reg.hasPreviousVersion,
    registrationDate: reg.registrationDate,
    consolidationDate: reg.consolidationDate,
    lastAmendedDate: reg.lastAmendedDate,
    limsMetadata: reg.limsMetadata,
    regulationMakerOrder: reg.regulationMakerOrder,
    recentAmendments: reg.recentAmendments,
  });

  // Insert sections with ALL fields
  for (const section of parsed.sections) {
    await db.insert(sections).values({
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
      inForceStartDate: section.inForceStartDate,
      lastAmendedDate: section.lastAmendedDate,
      enactedDate: section.enactedDate,
      limsMetadata: section.limsMetadata,
      historicalNotes: section.historicalNotes,
      footnotes: section.footnotes,
      scheduleId: section.scheduleId,
      scheduleBilingual: section.scheduleBilingual,
      scheduleSpanLanguages: section.scheduleSpanLanguages,
    });
  }

  // Insert defined terms with ALL fields
  for (const term of parsed.definedTerms) {
    await db.insert(definedTerms).values({
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
    });
  }

  // Insert cross references
  for (const ref of parsed.crossReferences) {
    await db.insert(crossReferences).values({
      sourceActId: ref.sourceActId,
      sourceRegulationId: ref.sourceRegulationId,
      sourceSectionLabel: ref.sourceSectionLabel,
      targetType: ref.targetType,
      targetRef: ref.targetRef,
      referenceText: ref.referenceText,
    });
  }

  return parsed;
}

// ============================================================================
// VERIFICATION FUNCTIONS - Verify ALL fields
// ============================================================================

async function verifyAct(
  actId: string,
  language: Language,
  xmlPath: string
): Promise<TestResult> {
  const errors: string[] = [];
  let sectionsVerified = 0;
  let definedTermsVerified = 0;
  let crossReferencesVerified = 0;

  // Parse XML
  const xmlContent = readFileSync(xmlPath, "utf-8");
  const parsed = parseActXml(xmlContent, language);

  if (!parsed.act) {
    return {
      name: `Act ${actId} (${language})`,
      passed: false,
      errors: ["Failed to parse XML"],
      stats: {
        sectionsVerified,
        definedTermsVerified,
        crossReferencesVerified,
      },
    };
  }

  // Fetch from database - now query by actId AND language since each language is separate record
  const dbActs = await db
    .select()
    .from(acts)
    .where(and(eq(acts.actId, actId), eq(acts.language, language)))
    .limit(1);

  if (dbActs.length === 0) {
    return {
      name: `Act ${actId} (${language})`,
      passed: false,
      errors: [`Act not found in database for language ${language}`],
      stats: {
        sectionsVerified,
        definedTermsVerified,
        crossReferencesVerified,
      },
    };
  }
  const dbAct = dbActs[0];
  const xmlAct = parsed.act;

  // ==================== VERIFY ALL ACT METADATA ====================

  // Basic fields
  if (xmlAct.actId !== dbAct.actId) {
    errors.push(`actId: expected "${xmlAct.actId}", got "${dbAct.actId}"`);
  }
  if (xmlAct.language !== dbAct.language) {
    errors.push(
      `language: expected "${xmlAct.language}", got "${dbAct.language}"`
    );
  }
  if (xmlAct.status !== dbAct.status) {
    errors.push(`status: expected "${xmlAct.status}", got "${dbAct.status}"`);
  }

  // Title fields (now single field per record, not bilingual)
  if (normalizeText(xmlAct.title) !== normalizeText(dbAct.title)) {
    errors.push("title mismatch");
  }
  if (normalizeText(xmlAct.longTitle) !== normalizeText(dbAct.longTitle)) {
    errors.push("longTitle mismatch");
  }
  compareOptionalStrings(
    xmlAct.runningHead,
    dbAct.runningHead,
    "runningHead",
    errors
  );

  // Date fields
  compareOptionalStrings(
    xmlAct.inForceDate,
    dbAct.inForceDate,
    "inForceDate",
    errors
  );
  compareOptionalStrings(
    xmlAct.consolidationDate,
    dbAct.consolidationDate,
    "consolidationDate",
    errors
  );
  compareOptionalStrings(
    xmlAct.lastAmendedDate,
    dbAct.lastAmendedDate,
    "lastAmendedDate",
    errors
  );
  compareOptionalStrings(
    xmlAct.enactedDate,
    dbAct.enactedDate,
    "enactedDate",
    errors
  );

  // Bill metadata
  compareOptionalStrings(
    xmlAct.billOrigin,
    dbAct.billOrigin,
    "billOrigin",
    errors
  );
  compareOptionalStrings(xmlAct.billType, dbAct.billType, "billType", errors);
  compareOptionalStrings(
    xmlAct.hasPreviousVersion,
    dbAct.hasPreviousVersion,
    "hasPreviousVersion",
    errors
  );

  // Chapter info
  compareOptionalStrings(
    xmlAct.consolidatedNumber,
    dbAct.consolidatedNumber,
    "consolidatedNumber",
    errors
  );
  compareOptionalStrings(
    xmlAct.annualStatuteYear,
    dbAct.annualStatuteYear,
    "annualStatuteYear",
    errors
  );
  compareOptionalStrings(
    xmlAct.annualStatuteChapter,
    dbAct.annualStatuteChapter,
    "annualStatuteChapter",
    errors
  );

  // JSONB fields - now language-specific (no more overwrites!)
  compareJsonb(xmlAct.limsMetadata, dbAct.limsMetadata, "limsMetadata", errors);
  compareJsonb(xmlAct.billHistory, dbAct.billHistory, "billHistory", errors);
  compareJsonb(
    xmlAct.recentAmendments,
    dbAct.recentAmendments,
    "recentAmendments",
    errors
  );

  // ==================== VERIFY ALL SECTIONS ====================
  const dbSections = await db
    .select()
    .from(sections)
    .where(and(eq(sections.actId, actId), eq(sections.language, language)));

  const dbSectionMap = new Map<string, typeof sections.$inferSelect>();
  for (const s of dbSections) {
    dbSectionMap.set(s.canonicalSectionId, s);
  }

  if (parsed.sections.length !== dbSections.length) {
    errors.push(
      `Section count: expected ${parsed.sections.length}, got ${dbSections.length}`
    );
  }

  for (const xmlSection of parsed.sections) {
    const dbSection = dbSectionMap.get(xmlSection.canonicalSectionId);
    if (!dbSection) {
      errors.push(`Section ${xmlSection.canonicalSectionId} not found in DB`);
      continue;
    }

    // Verify ALL section fields
    if (xmlSection.sectionLabel !== dbSection.sectionLabel) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: sectionLabel mismatch`
      );
    }
    if (
      normalizeText(xmlSection.content) !== normalizeText(dbSection.content)
    ) {
      errors.push(`Section ${xmlSection.canonicalSectionId}: content mismatch`);
    }
    if (xmlSection.sectionType !== dbSection.sectionType) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: sectionType expected "${xmlSection.sectionType}", got "${dbSection.sectionType}"`
      );
    }
    if ((xmlSection.xmlType ?? null) !== (dbSection.xmlType ?? null)) {
      errors.push(`Section ${xmlSection.canonicalSectionId}: xmlType mismatch`);
    }
    if ((xmlSection.xmlTarget ?? null) !== (dbSection.xmlTarget ?? null)) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: xmlTarget mismatch`
      );
    }
    if ((xmlSection.enactedDate ?? null) !== (dbSection.enactedDate ?? null)) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: enactedDate mismatch`
      );
    }
    if ((xmlSection.scheduleId ?? null) !== (dbSection.scheduleId ?? null)) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: scheduleId mismatch`
      );
    }
    if (
      (xmlSection.scheduleBilingual ?? null) !==
      (dbSection.scheduleBilingual ?? null)
    ) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: scheduleBilingual mismatch`
      );
    }
    if (
      (xmlSection.scheduleSpanLanguages ?? null) !==
      (dbSection.scheduleSpanLanguages ?? null)
    ) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: scheduleSpanLanguages mismatch`
      );
    }

    // JSONB fields for sections
    if (
      JSON.stringify(xmlSection.limsMetadata ?? null) !==
      JSON.stringify(dbSection.limsMetadata ?? null)
    ) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: limsMetadata mismatch`
      );
    }
    if (
      JSON.stringify(xmlSection.historicalNotes ?? null) !==
      JSON.stringify(dbSection.historicalNotes ?? null)
    ) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: historicalNotes mismatch`
      );
    }
    if (
      JSON.stringify(xmlSection.footnotes ?? null) !==
      JSON.stringify(dbSection.footnotes ?? null)
    ) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: footnotes mismatch`
      );
    }

    sectionsVerified++;
  }

  // ==================== VERIFY ALL DEFINED TERMS ====================
  const dbTerms = await db
    .select()
    .from(definedTerms)
    .where(
      and(eq(definedTerms.actId, actId), eq(definedTerms.language, language))
    );

  const makeTermKey = (
    term: string,
    lang: string,
    sectionLabel?: string | null
  ) => `${term}:${lang}:${sectionLabel || ""}`;
  const dbTermMap = new Map<string, typeof definedTerms.$inferSelect>();
  for (const t of dbTerms) {
    dbTermMap.set(makeTermKey(t.termNormalized, t.language, t.sectionLabel), t);
  }

  for (const xmlTerm of parsed.definedTerms) {
    const key = makeTermKey(
      xmlTerm.termNormalized,
      xmlTerm.language,
      xmlTerm.sectionLabel
    );
    const dbTerm = dbTermMap.get(key);
    if (!dbTerm) {
      errors.push(
        `Defined term "${xmlTerm.term}" (${xmlTerm.language}, section ${xmlTerm.sectionLabel}) not found in DB`
      );
      continue;
    }

    // Verify ALL term fields
    if (xmlTerm.scopeType !== dbTerm.scopeType) {
      errors.push(
        `Term "${xmlTerm.term}": scopeType expected "${xmlTerm.scopeType}", got "${dbTerm.scopeType}"`
      );
    }
    if ((xmlTerm.pairedTerm ?? null) !== (dbTerm.pairedTerm ?? null)) {
      errors.push(`Term "${xmlTerm.term}": pairedTerm mismatch`);
    }
    if (
      JSON.stringify(xmlTerm.scopeSections ?? null) !==
      JSON.stringify(dbTerm.scopeSections ?? null)
    ) {
      errors.push(`Term "${xmlTerm.term}": scopeSections mismatch`);
    }
    if (
      JSON.stringify(xmlTerm.limsMetadata ?? null) !==
      JSON.stringify(dbTerm.limsMetadata ?? null)
    ) {
      errors.push(`Term "${xmlTerm.term}": limsMetadata mismatch`);
    }

    definedTermsVerified++;
  }

  // ==================== VERIFY CROSS REFERENCES ====================
  const dbRefs = await db
    .select()
    .from(crossReferences)
    .where(eq(crossReferences.sourceActId, actId));

  const makeRefKey = (ref: {
    sourceSectionLabel?: string | null;
    targetType: string;
    targetRef: string;
  }) => `${ref.sourceSectionLabel || ""}:${ref.targetType}:${ref.targetRef}`;
  const dbRefMap = new Map<string, typeof crossReferences.$inferSelect>();
  for (const r of dbRefs) {
    dbRefMap.set(makeRefKey(r), r);
  }

  for (const xmlRef of parsed.crossReferences) {
    const key = makeRefKey(xmlRef);
    if (dbRefMap.has(key)) {
      crossReferencesVerified++;
    }
  }

  return {
    name: `Act ${actId} (${language})`,
    passed: errors.length === 0,
    errors,
    stats: { sectionsVerified, definedTermsVerified, crossReferencesVerified },
  };
}

async function verifyRegulation(
  regId: string,
  language: Language,
  xmlPath: string
): Promise<TestResult> {
  const errors: string[] = [];
  let sectionsVerified = 0;
  let definedTermsVerified = 0;
  let crossReferencesVerified = 0;

  // Parse XML
  const xmlContent = readFileSync(xmlPath, "utf-8");
  const parsed = parseRegulationXml(xmlContent, language);

  if (!parsed.regulation) {
    return {
      name: `Regulation ${regId} (${language})`,
      passed: false,
      errors: ["Failed to parse XML"],
      stats: {
        sectionsVerified,
        definedTermsVerified,
        crossReferencesVerified,
      },
    };
  }

  const normalizedId = parsed.regulation.regulationId;

  // Fetch from database - now query by regulationId AND language since each language is separate record
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
    return {
      name: `Regulation ${regId} (${language})`,
      passed: false,
      errors: [
        `Regulation ${normalizedId} not found in database for language ${language}`,
      ],
      stats: {
        sectionsVerified,
        definedTermsVerified,
        crossReferencesVerified,
      },
    };
  }
  const dbReg = dbRegs[0];
  const xmlReg = parsed.regulation;

  // ==================== VERIFY ALL REGULATION METADATA ====================

  // Basic fields
  if (xmlReg.regulationId !== dbReg.regulationId) {
    errors.push(
      `regulationId: expected "${xmlReg.regulationId}", got "${dbReg.regulationId}"`
    );
  }
  if (xmlReg.language !== dbReg.language) {
    errors.push(
      `language: expected "${xmlReg.language}", got "${dbReg.language}"`
    );
  }
  if (xmlReg.instrumentNumber !== dbReg.instrumentNumber) {
    errors.push(
      `instrumentNumber: expected "${xmlReg.instrumentNumber}", got "${dbReg.instrumentNumber}"`
    );
  }
  compareOptionalStrings(
    xmlReg.regulationType,
    dbReg.regulationType,
    "regulationType",
    errors
  );
  compareOptionalStrings(
    xmlReg.gazettePart,
    dbReg.gazettePart,
    "gazettePart",
    errors
  );
  if (xmlReg.status !== dbReg.status) {
    errors.push(`status: expected "${xmlReg.status}", got "${dbReg.status}"`);
  }

  // Title fields (now single field per record, not bilingual)
  if (normalizeText(xmlReg.title) !== normalizeText(dbReg.title)) {
    errors.push("title mismatch");
  }
  if (normalizeText(xmlReg.longTitle) !== normalizeText(dbReg.longTitle)) {
    errors.push("longTitle mismatch");
  }
  compareOptionalStrings(
    xmlReg.enablingActTitle,
    dbReg.enablingActTitle,
    "enablingActTitle",
    errors
  );

  // Enabling act
  compareOptionalStrings(
    xmlReg.enablingActId,
    dbReg.enablingActId,
    "enablingActId",
    errors
  );

  // Other fields
  compareOptionalStrings(
    xmlReg.hasPreviousVersion,
    dbReg.hasPreviousVersion,
    "hasPreviousVersion",
    errors
  );
  compareOptionalStrings(
    xmlReg.registrationDate,
    dbReg.registrationDate,
    "registrationDate",
    errors
  );
  compareOptionalStrings(
    xmlReg.consolidationDate,
    dbReg.consolidationDate,
    "consolidationDate",
    errors
  );
  compareOptionalStrings(
    xmlReg.lastAmendedDate,
    dbReg.lastAmendedDate,
    "lastAmendedDate",
    errors
  );

  // JSONB fields - now language-specific (no more overwrites!)
  compareJsonb(xmlReg.limsMetadata, dbReg.limsMetadata, "limsMetadata", errors);
  compareJsonb(
    xmlReg.regulationMakerOrder,
    dbReg.regulationMakerOrder,
    "regulationMakerOrder",
    errors
  );
  compareJsonb(
    xmlReg.recentAmendments,
    dbReg.recentAmendments,
    "recentAmendments",
    errors
  );

  // ==================== VERIFY ALL SECTIONS ====================
  const dbSections = await db
    .select()
    .from(sections)
    .where(
      and(
        eq(sections.regulationId, normalizedId),
        eq(sections.language, language)
      )
    );

  const dbSectionMap = new Map<string, typeof sections.$inferSelect>();
  for (const s of dbSections) {
    dbSectionMap.set(s.canonicalSectionId, s);
  }

  if (parsed.sections.length !== dbSections.length) {
    errors.push(
      `Section count: expected ${parsed.sections.length}, got ${dbSections.length}`
    );
  }

  for (const xmlSection of parsed.sections) {
    const dbSection = dbSectionMap.get(xmlSection.canonicalSectionId);
    if (!dbSection) {
      errors.push(`Section ${xmlSection.canonicalSectionId} not found in DB`);
      continue;
    }

    // Verify ALL section fields
    if (xmlSection.sectionLabel !== dbSection.sectionLabel) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: sectionLabel mismatch`
      );
    }
    if (
      normalizeText(xmlSection.content) !== normalizeText(dbSection.content)
    ) {
      errors.push(`Section ${xmlSection.canonicalSectionId}: content mismatch`);
    }
    if (xmlSection.sectionType !== dbSection.sectionType) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: sectionType expected "${xmlSection.sectionType}", got "${dbSection.sectionType}"`
      );
    }
    if ((xmlSection.xmlType ?? null) !== (dbSection.xmlType ?? null)) {
      errors.push(`Section ${xmlSection.canonicalSectionId}: xmlType mismatch`);
    }
    if ((xmlSection.xmlTarget ?? null) !== (dbSection.xmlTarget ?? null)) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: xmlTarget mismatch`
      );
    }
    if ((xmlSection.enactedDate ?? null) !== (dbSection.enactedDate ?? null)) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: enactedDate mismatch`
      );
    }
    if ((xmlSection.scheduleId ?? null) !== (dbSection.scheduleId ?? null)) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: scheduleId mismatch`
      );
    }
    if (
      (xmlSection.scheduleBilingual ?? null) !==
      (dbSection.scheduleBilingual ?? null)
    ) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: scheduleBilingual mismatch`
      );
    }
    if (
      (xmlSection.scheduleSpanLanguages ?? null) !==
      (dbSection.scheduleSpanLanguages ?? null)
    ) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: scheduleSpanLanguages mismatch`
      );
    }

    // JSONB fields for sections
    if (
      JSON.stringify(xmlSection.limsMetadata ?? null) !==
      JSON.stringify(dbSection.limsMetadata ?? null)
    ) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: limsMetadata mismatch`
      );
    }
    if (
      JSON.stringify(xmlSection.historicalNotes ?? null) !==
      JSON.stringify(dbSection.historicalNotes ?? null)
    ) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: historicalNotes mismatch`
      );
    }
    if (
      JSON.stringify(xmlSection.footnotes ?? null) !==
      JSON.stringify(dbSection.footnotes ?? null)
    ) {
      errors.push(
        `Section ${xmlSection.canonicalSectionId}: footnotes mismatch`
      );
    }

    sectionsVerified++;
  }

  // ==================== VERIFY ALL DEFINED TERMS ====================
  const dbTerms = await db
    .select()
    .from(definedTerms)
    .where(
      and(
        eq(definedTerms.regulationId, normalizedId),
        eq(definedTerms.language, language)
      )
    );

  const makeTermKey = (
    term: string,
    lang: string,
    sectionLabel?: string | null
  ) => `${term}:${lang}:${sectionLabel || ""}`;
  const dbTermMap = new Map<string, typeof definedTerms.$inferSelect>();
  for (const t of dbTerms) {
    dbTermMap.set(makeTermKey(t.termNormalized, t.language, t.sectionLabel), t);
  }

  for (const xmlTerm of parsed.definedTerms) {
    const key = makeTermKey(
      xmlTerm.termNormalized,
      xmlTerm.language,
      xmlTerm.sectionLabel
    );
    const dbTerm = dbTermMap.get(key);
    if (!dbTerm) {
      errors.push(
        `Defined term "${xmlTerm.term}" (${xmlTerm.language}, section ${xmlTerm.sectionLabel}) not found in DB`
      );
      continue;
    }

    // Verify ALL term fields
    if (xmlTerm.scopeType !== dbTerm.scopeType) {
      errors.push(
        `Term "${xmlTerm.term}": scopeType expected "${xmlTerm.scopeType}", got "${dbTerm.scopeType}"`
      );
    }
    if ((xmlTerm.pairedTerm ?? null) !== (dbTerm.pairedTerm ?? null)) {
      errors.push(`Term "${xmlTerm.term}": pairedTerm mismatch`);
    }
    if (
      JSON.stringify(xmlTerm.scopeSections ?? null) !==
      JSON.stringify(dbTerm.scopeSections ?? null)
    ) {
      errors.push(`Term "${xmlTerm.term}": scopeSections mismatch`);
    }
    if (
      JSON.stringify(xmlTerm.limsMetadata ?? null) !==
      JSON.stringify(dbTerm.limsMetadata ?? null)
    ) {
      errors.push(`Term "${xmlTerm.term}": limsMetadata mismatch`);
    }

    definedTermsVerified++;
  }

  // ==================== VERIFY CROSS REFERENCES ====================
  const dbRefs = await db
    .select()
    .from(crossReferences)
    .where(eq(crossReferences.sourceRegulationId, normalizedId));

  const makeRefKey = (ref: {
    sourceSectionLabel?: string | null;
    targetType: string;
    targetRef: string;
  }) => `${ref.sourceSectionLabel || ""}:${ref.targetType}:${ref.targetRef}`;
  const dbRefMap = new Map<string, typeof crossReferences.$inferSelect>();
  for (const r of dbRefs) {
    dbRefMap.set(makeRefKey(r), r);
  }

  for (const xmlRef of parsed.crossReferences) {
    const key = makeRefKey(xmlRef);
    if (dbRefMap.has(key)) {
      crossReferencesVerified++;
    }
  }

  return {
    name: `Regulation ${regId} (${language})`,
    passed: errors.length === 0,
    errors,
    stats: { sectionsVerified, definedTermsVerified, crossReferencesVerified },
  };
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function main() {
  log("====================================");
  log("Legislation Import Integration Tests");
  log("(100% Data Capture Verification)");
  log("====================================\n");

  const results: TestResult[] = [];

  // Step 1: Clear test data
  await clearTestData();

  // Step 2: Import all test fixtures
  log("\nImporting test fixtures...");

  // Import acts (EN first, then FR to merge bilingual)
  for (const act of TEST_ACTS) {
    if (existsSync(act.pathEn)) {
      log(`  Importing ${act.id} (en)...`);
      await importActFromXml(act.pathEn, "en");
    }
    if (existsSync(act.pathFr)) {
      log(`  Importing ${act.id} (fr)...`);
      await importActFromXml(act.pathFr, "fr");
    }
  }

  // Import regulations (EN first, then FR)
  for (const reg of TEST_REGULATIONS) {
    if (existsSync(reg.pathEn)) {
      log(`  Importing ${reg.idEn} (en)...`);
      await importRegulationFromXml(reg.pathEn, "en");
    }
    if (existsSync(reg.pathFr)) {
      log(`  Importing ${reg.idFr} (fr)...`);
      await importRegulationFromXml(reg.pathFr, "fr");
    }
  }

  log("\nImport complete. Running verification...\n");

  // Step 3: Verify all imports
  for (const act of TEST_ACTS) {
    if (existsSync(act.pathEn)) {
      results.push(await verifyAct(act.id, "en", act.pathEn));
    }
    if (existsSync(act.pathFr)) {
      results.push(await verifyAct(act.id, "fr", act.pathFr));
    }
  }

  for (const reg of TEST_REGULATIONS) {
    if (existsSync(reg.pathEn)) {
      results.push(await verifyRegulation(reg.idEn, "en", reg.pathEn));
    }
    if (existsSync(reg.pathFr)) {
      results.push(await verifyRegulation(reg.idFr, "fr", reg.pathFr));
    }
  }

  // Step 4: Print results
  log("====================================");
  log("Test Results");
  log("====================================\n");

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    const status = result.passed ? "✓ PASS" : "✗ FAIL";
    console.log(`${status}: ${result.name}`);
    console.log(
      `       Sections: ${result.stats.sectionsVerified}, Terms: ${result.stats.definedTermsVerified}, Refs: ${result.stats.crossReferencesVerified}`
    );

    if (result.passed) {
      passed++;
    } else {
      for (const error of result.errors.slice(0, 10)) {
        console.log(`       - ${error}`);
      }
      if (result.errors.length > 10) {
        console.log(`       ... and ${result.errors.length - 10} more errors`);
      }
      failed++;
    }
    console.log();
  }

  log("====================================");
  log(
    `Summary: ${passed} passed, ${failed} failed out of ${results.length} tests`
  );
  log("====================================");

  await client.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
