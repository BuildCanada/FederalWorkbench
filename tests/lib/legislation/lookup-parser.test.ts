/**
 * Tests for the lookup.xml parser.
 *
 * The lookup.xml contains metadata about all legislation including:
 * - Reversed short titles (for alphabetical indexes)
 * - Consolidation flags
 * - Official numbers/citations
 * - Act-to-regulation relationships
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  getEnablingActFromRelationships,
  getRelatedRegulations,
  lookupRegulation,
  lookupStatute,
  normalizeAlphaNumber,
  parseLookupXml,
} from "@/lib/legislation/lookup-parser";

const TEST_DIR = join(process.cwd(), "tests/fixtures/lookup");

/**
 * Get a unique test file path for this test
 * Uses crypto.randomUUID() for guaranteed uniqueness across parallel workers
 */
function getUniqueTestPath(): string {
  return join(TEST_DIR, `test-lookup-${crypto.randomUUID()}.xml`);
}

/**
 * Create a test lookup.xml with minimal content
 */
function createTestLookupXml(content: {
  statutes?: string;
  regulations?: string;
}): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Database>
<Statutes>
${content.statutes || ""}
</Statutes>
<Regulations>
${content.regulations || ""}
</Regulations>
</Database>`;
}

/**
 * Write test XML and return the path for cleanup
 */
function writeTestXml(content: {
  statutes?: string;
  regulations?: string;
}): string {
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }
  const path = getUniqueTestPath();
  writeFileSync(path, createTestLookupXml(content));
  return path;
}

/**
 * Safely clean up test file if it exists
 */
function cleanupTestFile(path: string): void {
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

test.describe("normalizeAlphaNumber", () => {
  test("replaces / with -", () => {
    expect(normalizeAlphaNumber("SOR/2007-151")).toBe("SOR-2007-151");
    expect(normalizeAlphaNumber("SI/2000-100")).toBe("SI-2000-100");
  });

  test("preserves C.R.C. format", () => {
    expect(normalizeAlphaNumber("C.R.C., c. 10")).toBe("C.R.C., c. 10");
    expect(normalizeAlphaNumber("C.R.C.,_c._10")).toBe("C.R.C.,_c._10");
  });

  test("handles already normalized values", () => {
    expect(normalizeAlphaNumber("SOR-2007-151")).toBe("SOR-2007-151");
  });
});

test.describe("parseLookupXml", () => {
  test("parses statute entries correctly", () => {
    const testPath = writeTestXml({
      statutes: `
<Statute id="167e">
  <ChapterNumber>A-1</ChapterNumber>
  <OfficialNumber>A-1</OfficialNumber>
  <Language>en</Language>
  <ShortTitle>Access to Information Act</ShortTitle>
  <ReversedShortTitle>Access to Information Act</ReversedShortTitle>
  <LastConsolidationDate>20251121</LastConsolidationDate>
  <ConsolidateFlag>True</ConsolidateFlag>
  <Relationships>
    <Relationship rid="638933e" />
    <Relationship rid="638953e" />
  </Relationships>
</Statute>
<Statute id="167f">
  <ChapterNumber>A-1</ChapterNumber>
  <OfficialNumber>A-1</OfficialNumber>
  <Language>fr</Language>
  <ShortTitle>Loi sur l'accès à l'information</ShortTitle>
  <ReversedShortTitle>Accès à l'information, Loi sur l'</ReversedShortTitle>
  <LastConsolidationDate>20251121</LastConsolidationDate>
  <ConsolidateFlag>True</ConsolidateFlag>
</Statute>`,
    });

    try {
      const result = parseLookupXml(testPath);

      // Check English statute
      const enStatute = lookupStatute(result, "A-1", "en");
      expect(enStatute).toBeDefined();
      expect(enStatute?.id).toBe("167e");
      expect(enStatute?.shortTitle).toBe("Access to Information Act");
      expect(enStatute?.reversedShortTitle).toBe("Access to Information Act");
      expect(enStatute?.consolidateFlag).toBe(true);
      expect(enStatute?.relatedRegulationIds).toEqual(["638933e", "638953e"]);

      // Check French statute
      const frStatute = lookupStatute(result, "A-1", "fr");
      expect(frStatute).toBeDefined();
      expect(frStatute?.shortTitle).toBe("Loi sur l'accès à l'information");
      expect(frStatute?.reversedShortTitle).toBe(
        "Accès à l'information, Loi sur l'"
      );
    } finally {
      cleanupTestFile(testPath);
    }
  });

  test("parses regulation entries correctly", () => {
    const testPath = writeTestXml({
      regulations: `
<Regulation id="734629e" olid="723140f">
  <AlphaNumber>SOR/2007-151</AlphaNumber>
  <Language>en</Language>
  <ShortTitle>"MV Sonia" Remission Order, 2007</ShortTitle>
  <ReversedShortTitle>"MV Sonia" Remission Order, 2007</ReversedShortTitle>
  <LastConsolidationDate>20251121</LastConsolidationDate>
  <ConsolidateFlag>True</ConsolidateFlag>
</Regulation>
<Regulation id="723140f" olid="734629e">
  <AlphaNumber>DORS/2007-151</AlphaNumber>
  <Language>fr</Language>
  <ShortTitle>Décret de remise concernant le « MV Sonia » (2007)</ShortTitle>
  <ReversedShortTitle>« MV Sonia » (2007), Décret de remise concernant le</ReversedShortTitle>
  <LastConsolidationDate>20251121</LastConsolidationDate>
  <ConsolidateFlag>True</ConsolidateFlag>
</Regulation>`,
    });

    try {
      const result = parseLookupXml(testPath);

      // Check English regulation
      const enReg = lookupRegulation(result, "SOR/2007-151", "en");
      expect(enReg).toBeDefined();
      expect(enReg?.id).toBe("734629e");
      expect(enReg?.otherLanguageId).toBe("723140f");
      expect(enReg?.shortTitle).toBe('"MV Sonia" Remission Order, 2007');
      expect(enReg?.reversedShortTitle).toBe(
        '"MV Sonia" Remission Order, 2007'
      );
      expect(enReg?.consolidateFlag).toBe(true);

      // Check French regulation
      const frReg = lookupRegulation(result, "DORS/2007-151", "fr");
      expect(frReg).toBeDefined();
      expect(frReg?.otherLanguageId).toBe("734629e");
    } finally {
      cleanupTestFile(testPath);
    }
  });

  test("handles consolidateFlag as False", () => {
    const testPath = writeTestXml({
      statutes: `
<Statute id="100e">
  <ChapterNumber>Z-1</ChapterNumber>
  <OfficialNumber>Z-1</OfficialNumber>
  <Language>en</Language>
  <ShortTitle>Test Act</ShortTitle>
  <ReversedShortTitle>Test Act</ReversedShortTitle>
  <ConsolidateFlag>False</ConsolidateFlag>
</Statute>`,
    });

    try {
      const result = parseLookupXml(testPath);
      const statute = lookupStatute(result, "Z-1", "en");
      expect(statute?.consolidateFlag).toBe(false);
    } finally {
      cleanupTestFile(testPath);
    }
  });

  test("handles missing ConsolidateFlag as false", () => {
    const testPath = writeTestXml({
      statutes: `
<Statute id="100e">
  <ChapterNumber>Z-1</ChapterNumber>
  <OfficialNumber>Z-1</OfficialNumber>
  <Language>en</Language>
  <ShortTitle>Test Act</ShortTitle>
  <ReversedShortTitle>Test Act</ReversedShortTitle>
</Statute>`,
    });

    try {
      const result = parseLookupXml(testPath);
      const statute = lookupStatute(result, "Z-1", "en");
      expect(statute?.consolidateFlag).toBe(false);
    } finally {
      cleanupTestFile(testPath);
    }
  });
});

test.describe("lookupStatute", () => {
  test("returns undefined for non-existent statute", () => {
    const testPath = writeTestXml({ statutes: "" });

    try {
      const result = parseLookupXml(testPath);
      expect(lookupStatute(result, "X-99", "en")).toBeUndefined();
    } finally {
      cleanupTestFile(testPath);
    }
  });

  test("returns correct language version", () => {
    const testPath = writeTestXml({
      statutes: `
<Statute id="1e">
  <ChapterNumber>T-1</ChapterNumber>
  <Language>en</Language>
  <ShortTitle>English Title</ShortTitle>
  <ReversedShortTitle>English Title Reversed</ReversedShortTitle>
</Statute>
<Statute id="1f">
  <ChapterNumber>T-1</ChapterNumber>
  <Language>fr</Language>
  <ShortTitle>French Title</ShortTitle>
  <ReversedShortTitle>French Title Reversed</ReversedShortTitle>
</Statute>`,
    });

    try {
      const result = parseLookupXml(testPath);
      expect(lookupStatute(result, "T-1", "en")?.shortTitle).toBe(
        "English Title"
      );
      expect(lookupStatute(result, "T-1", "fr")?.shortTitle).toBe(
        "French Title"
      );
    } finally {
      cleanupTestFile(testPath);
    }
  });
});

test.describe("lookupRegulation", () => {
  test("returns undefined for non-existent regulation", () => {
    const testPath = writeTestXml({ regulations: "" });

    try {
      const result = parseLookupXml(testPath);
      expect(lookupRegulation(result, "SOR/9999-9999", "en")).toBeUndefined();
    } finally {
      cleanupTestFile(testPath);
    }
  });

  test("handles different alpha number formats", () => {
    const testPath = writeTestXml({
      regulations: `
<Regulation id="1e">
  <AlphaNumber>SOR/2000-1</AlphaNumber>
  <Language>en</Language>
  <ShortTitle>Test Reg 1</ShortTitle>
  <ReversedShortTitle>Test Reg 1</ReversedShortTitle>
</Regulation>
<Regulation id="2e">
  <AlphaNumber>SI/2000-100</AlphaNumber>
  <Language>en</Language>
  <ShortTitle>Test Reg 2</ShortTitle>
  <ReversedShortTitle>Test Reg 2</ReversedShortTitle>
</Regulation>`,
    });

    try {
      const result = parseLookupXml(testPath);
      expect(lookupRegulation(result, "SOR/2000-1", "en")?.shortTitle).toBe(
        "Test Reg 1"
      );
      expect(lookupRegulation(result, "SI/2000-100", "en")?.shortTitle).toBe(
        "Test Reg 2"
      );
    } finally {
      cleanupTestFile(testPath);
    }
  });
});

test.describe("getRelatedRegulations", () => {
  test("returns related regulation alpha numbers", () => {
    const testPath = writeTestXml({
      statutes: `
<Statute id="1e">
  <ChapterNumber>A-1</ChapterNumber>
  <Language>en</Language>
  <ShortTitle>Test Act</ShortTitle>
  <ReversedShortTitle>Test Act</ReversedShortTitle>
  <Relationships>
    <Relationship rid="100e" />
    <Relationship rid="101e" />
  </Relationships>
</Statute>`,
      regulations: `
<Regulation id="100e">
  <AlphaNumber>SOR/2000-1</AlphaNumber>
  <Language>en</Language>
  <ShortTitle>Related Reg 1</ShortTitle>
  <ReversedShortTitle>Related Reg 1</ReversedShortTitle>
</Regulation>
<Regulation id="101e">
  <AlphaNumber>SOR/2000-2</AlphaNumber>
  <Language>en</Language>
  <ShortTitle>Related Reg 2</ShortTitle>
  <ReversedShortTitle>Related Reg 2</ReversedShortTitle>
</Regulation>`,
    });

    try {
      const result = parseLookupXml(testPath);
      const relatedRegs = getRelatedRegulations(result, "A-1", "en");
      expect(relatedRegs).toContain("SOR/2000-1");
      expect(relatedRegs).toContain("SOR/2000-2");
    } finally {
      cleanupTestFile(testPath);
    }
  });

  test("returns empty array for statute with no relationships", () => {
    const testPath = writeTestXml({
      statutes: `
<Statute id="1e">
  <ChapterNumber>A-1</ChapterNumber>
  <Language>en</Language>
  <ShortTitle>Test Act</ShortTitle>
  <ReversedShortTitle>Test Act</ReversedShortTitle>
</Statute>`,
    });

    try {
      const result = parseLookupXml(testPath);
      expect(getRelatedRegulations(result, "A-1", "en")).toEqual([]);
    } finally {
      cleanupTestFile(testPath);
    }
  });
});

test.describe("getEnablingActFromRelationships", () => {
  test("finds enabling act for regulation", () => {
    const testPath = writeTestXml({
      statutes: `
<Statute id="1e">
  <ChapterNumber>A-1</ChapterNumber>
  <Language>en</Language>
  <ShortTitle>Test Act</ShortTitle>
  <ReversedShortTitle>Test Act</ReversedShortTitle>
  <Relationships>
    <Relationship rid="100e" />
  </Relationships>
</Statute>`,
      regulations: `
<Regulation id="100e">
  <AlphaNumber>SOR/2000-1</AlphaNumber>
  <Language>en</Language>
  <ShortTitle>Related Reg</ShortTitle>
  <ReversedShortTitle>Related Reg</ReversedShortTitle>
</Regulation>`,
    });

    try {
      const result = parseLookupXml(testPath);
      const enablingActId = getEnablingActFromRelationships(
        result,
        "100e",
        "en"
      );
      expect(enablingActId).toBe("A-1");
    } finally {
      cleanupTestFile(testPath);
    }
  });

  test("returns undefined for regulation not linked to any act", () => {
    const testPath = writeTestXml({
      statutes: `
<Statute id="1e">
  <ChapterNumber>A-1</ChapterNumber>
  <Language>en</Language>
  <ShortTitle>Test Act</ShortTitle>
  <ReversedShortTitle>Test Act</ReversedShortTitle>
</Statute>`,
      regulations: `
<Regulation id="100e">
  <AlphaNumber>SOR/2000-1</AlphaNumber>
  <Language>en</Language>
  <ShortTitle>Orphan Reg</ShortTitle>
  <ReversedShortTitle>Orphan Reg</ReversedShortTitle>
</Regulation>`,
    });

    try {
      const result = parseLookupXml(testPath);
      expect(
        getEnablingActFromRelationships(result, "100e", "en")
      ).toBeUndefined();
    } finally {
      cleanupTestFile(testPath);
    }
  });
});

test.describe("Integration with real lookup.xml", () => {
  const REAL_LOOKUP_PATH = "data/legislation/lookup/lookup.xml";

  test("parses real lookup.xml", () => {
    test.skip(!existsSync(REAL_LOOKUP_PATH), "lookup.xml not found");

    const result = parseLookupXml(REAL_LOOKUP_PATH);

    // Should have substantial data
    expect(result.statutes.size).toBeGreaterThan(0);
    expect(result.regulations.size).toBeGreaterThan(0);

    // Check a well-known statute
    const accessAct = lookupStatute(result, "A-1", "en");
    expect(accessAct).toBeDefined();
    expect(accessAct?.shortTitle).toContain("Access to Information");
    expect(accessAct?.consolidateFlag).toBe(true);

    // Check a well-known French statute
    const accessActFr = lookupStatute(result, "A-1", "fr");
    expect(accessActFr).toBeDefined();
    // Use a simpler substring check that doesn't depend on apostrophe encoding
    expect(accessActFr?.shortTitle).toContain("information");
  });
});
