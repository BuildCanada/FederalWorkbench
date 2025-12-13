/**
 * Tests for legislation typo corrections utility.
 *
 * These tests validate that:
 * 1. The correction functions work correctly
 * 2. Each typo defined actually exists in the source XML
 * 3. Each correction matches what's in the target language XML
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

import {
  correctActualTermForLinking,
  correctPairedTermForLinking,
  getDocumentsWithCorrections,
  getDocumentsWithTermCorrections,
  getTotalCorrectionCount,
  getTotalTermCorrectionCount,
  LEGISLATION_TYPOS,
  validateCorrections,
} from "@/scripts/utils/legislation-typos";

const DATA_DIR = join(process.cwd(), "data/legislation");

/**
 * Map a document ID to its XML file path.
 * EN regulations: SOR-XXXX → eng/regulations/SOR-XXXX.xml
 * FR regulations: DORS-XXXX → fra/reglements/DORS-XXXX.xml
 * EN acts: A-1 → eng/acts/A-1.xml
 * FR acts: A-1 → fra/lois/A-1.xml
 */
function getXmlPath(documentId: string, language: "en" | "fr"): string {
  const isRegulation =
    documentId.startsWith("SOR-") ||
    documentId.startsWith("DORS-") ||
    documentId.startsWith("SI-") ||
    documentId.startsWith("TR-") ||
    documentId.startsWith("C.R.C.");

  if (language === "en") {
    return join(
      DATA_DIR,
      "eng",
      isRegulation ? "regulations" : "acts",
      `${documentId}.xml`
    );
  }
  return join(
    DATA_DIR,
    "fra",
    isRegulation ? "reglements" : "lois",
    `${documentId}.xml`
  );
}

/**
 * Get the corresponding document ID in the other language.
 * SOR-XXXX ↔ DORS-XXXX
 * SI-XXXX ↔ TR-XXXX
 * C.R.C._c. X ↔ C.R.C._ch. X
 */
function translateDocumentId(
  documentId: string,
  fromLang: "en" | "fr"
): string {
  if (fromLang === "en") {
    if (documentId.startsWith("SOR-")) {
      return documentId.replace("SOR-", "DORS-");
    }
    if (documentId.startsWith("SI-")) {
      return documentId.replace("SI-", "TR-");
    }
    if (documentId.startsWith("C.R.C._c. ")) {
      return documentId.replace("C.R.C._c. ", "C.R.C._ch. ");
    }
  } else {
    if (documentId.startsWith("DORS-")) {
      return documentId.replace("DORS-", "SOR-");
    }
    if (documentId.startsWith("TR-")) {
      return documentId.replace("TR-", "SI-");
    }
    if (documentId.startsWith("C.R.C._ch. ")) {
      return documentId.replace("C.R.C._ch. ", "C.R.C._c. ");
    }
  }
  // Acts have same ID in both languages
  return documentId;
}

/**
 * Determine the source language based on document ID format.
 */
function getSourceLanguage(documentId: string): "en" | "fr" {
  if (
    documentId.startsWith("DORS-") ||
    documentId.startsWith("TR-") ||
    documentId.startsWith("C.R.C._ch. ")
  ) {
    return "fr";
  }
  return "en";
}

// =============================================================================
// Unit Tests for Correction Functions
// =============================================================================

test.describe("correctPairedTermForLinking", () => {
  test("returns original term when no corrections exist for document", () => {
    const result = correctPairedTermForLinking(
      "UNKNOWN-DOC",
      "some paired term"
    );
    expect(result).toBe("some paired term");
  });

  test("applies typo correction for C.R.C._c. 870", () => {
    const result = correctPairedTermForLinking(
      "C.R.C._c. 870",
      "accord de reconnaisance mutuelle"
    );
    expect(result).toBe("accord de reconnaissance mutuelle");
  });

  test("applies multiple corrections for same document", () => {
    // C.R.C._c. 870 has both "reconnaisance" and "projection de flamme"
    const result1 = correctPairedTermForLinking(
      "C.R.C._c. 870",
      "reconnaisance"
    );
    expect(result1).toBe("reconnaissance");

    const result2 = correctPairedTermForLinking(
      "C.R.C._c. 870",
      "projection de flamme"
    );
    expect(result2).toBe("projection de la flamme");
  });

  test("applies word order correction for SOR-2021-268", () => {
    const result = correctPairedTermForLinking(
      "SOR-2021-268",
      "COV à faible pression de vapeur"
    );
    expect(result).toBe("COV à pression de vapeur faible");
  });

  test("applies singular to plural correction", () => {
    const result = correctPairedTermForLinking(
      "DORS-2020-258",
      "smoke emission"
    );
    expect(result).toBe("smoke emissions");
  });

  test("preserves case when applying corrections", () => {
    const result = correctPairedTermForLinking(
      "DORS-2011-10",
      "Amphibious Vehicule"
    );
    expect(result).toBe("Amphibious Vehicle");
  });

  test("handles missing space correction", () => {
    const result = correctPairedTermForLinking(
      "SOR-86-304",
      "chaudièreà haute pression"
    );
    expect(result).toBe("chaudière à haute pression");
  });
});

test.describe("correctActualTermForLinking", () => {
  test("returns original term when no corrections exist for document", () => {
    const result = correctActualTermForLinking("UNKNOWN-DOC", "some term");
    expect(result).toBe("some term");
  });

  test("applies typo correction for C.R.C._c. 870 actual term", () => {
    const result = correctActualTermForLinking(
      "C.R.C._c. 870",
      "mutiple-serving prepackaged product"
    );
    expect(result).toBe("multiple-serving prepackaged product");
  });

  test("preserves case when applying corrections", () => {
    const result = correctActualTermForLinking(
      "C.R.C._c. 870",
      "Mutiple-serving prepackaged product"
    );
    expect(result).toBe("Multiple-serving prepackaged product");
  });
});

test.describe("validateCorrections", () => {
  test("returns no warnings for current corrections", () => {
    const warnings = validateCorrections();
    expect(warnings).toEqual([]);
  });
});

test.describe("getDocumentsWithCorrections", () => {
  test("returns list of document IDs", () => {
    const docs = getDocumentsWithCorrections();
    expect(docs.length).toBeGreaterThan(0);
    expect(docs).toContain("C.R.C._c. 870");
    expect(docs).toContain("SOR-2021-268");
  });
});

test.describe("getTotalCorrectionCount", () => {
  test("returns positive count", () => {
    const count = getTotalCorrectionCount();
    expect(count).toBeGreaterThan(20);
  });
});

test.describe("getDocumentsWithTermCorrections", () => {
  test("returns list of document IDs with actual term corrections", () => {
    const docs = getDocumentsWithTermCorrections();
    expect(docs.length).toBeGreaterThan(0);
    expect(docs).toContain("C.R.C._c. 870");
  });
});

test.describe("getTotalTermCorrectionCount", () => {
  test("returns positive count", () => {
    const count = getTotalTermCorrectionCount();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// Integration Tests Against Canonical XML Files
// =============================================================================

test.describe("Typo corrections validated against XML files", () => {
  // Group corrections by whether they're EN→FR or FR→EN
  const enToFrCorrections: Array<{
    docId: string;
    typo: string;
    correction: string;
  }> = [];
  const frToEnCorrections: Array<{
    docId: string;
    typo: string;
    correction: string;
  }> = [];

  for (const [docId, corrections] of Object.entries(LEGISLATION_TYPOS)) {
    const sourceLang = getSourceLanguage(docId);
    for (const { typo, correction } of corrections) {
      if (sourceLang === "en") {
        enToFrCorrections.push({ docId, typo, correction });
      } else {
        frToEnCorrections.push({ docId, typo, correction });
      }
    }
  }

  test.describe("EN→FR corrections (typo in EN paired term, correction matches FR term)", () => {
    for (const { docId, typo, correction } of enToFrCorrections) {
      test(`${docId}: "${typo}" → "${correction}"`, () => {
        const enPath = getXmlPath(docId, "en");
        const frDocId = translateDocumentId(docId, "en");
        const frPath = getXmlPath(frDocId, "fr");

        // Check source XML exists
        if (!existsSync(enPath)) {
          test.skip();
          return;
        }

        const enXml = readFileSync(enPath, "utf-8");

        // Verify the typo exists in the EN XML's paired terms
        const typoInSource = enXml.includes(typo);
        expect(
          typoInSource,
          `Typo "${typo}" should exist in ${docId}`
        ).toBeTruthy();

        // If FR file exists, verify the correction appears in FR terms
        // Note: Corrections may be substrings within longer terms
        if (existsSync(frPath)) {
          const frXml = readFileSync(frPath, "utf-8");

          // Check if correction appears anywhere in the FR XML
          // (it may be a substring of a longer defined term)
          const correctionInTarget = frXml.includes(correction);
          expect(
            correctionInTarget,
            `Correction "${correction}" should appear somewhere in ${frDocId}`
          ).toBeTruthy();
        }
      });
    }
  });

  test.describe("FR→EN corrections (typo in FR paired term, correction matches EN term)", () => {
    for (const { docId, typo, correction } of frToEnCorrections) {
      test(`${docId}: "${typo}" → "${correction}"`, () => {
        const frPath = getXmlPath(docId, "fr");
        const enDocId = translateDocumentId(docId, "fr");
        const enPath = getXmlPath(enDocId, "en");

        // Check source XML exists
        if (!existsSync(frPath)) {
          test.skip();
          return;
        }

        const frXml = readFileSync(frPath, "utf-8");

        // Verify the typo exists in the FR XML's paired terms
        const typoInSource = frXml.includes(typo);
        expect(
          typoInSource,
          `Typo "${typo}" should exist in ${docId}`
        ).toBeTruthy();

        // If EN file exists, verify the correction appears in EN terms
        // Note: Corrections may be substrings within longer terms
        if (existsSync(enPath)) {
          const enXml = readFileSync(enPath, "utf-8");

          // Check if correction appears anywhere in the EN XML
          // (it may be a substring of a longer defined term)
          const correctionInTarget = enXml.includes(correction);
          expect(
            correctionInTarget,
            `Correction "${correction}" should appear somewhere in ${enDocId}`
          ).toBeTruthy();
        }
      });
    }
  });
});

// =============================================================================
// Smoke Tests - Quick validation that key corrections work
// =============================================================================

test.describe("Smoke tests for key corrections", () => {
  test("reconnaisance typo exists in C.R.C._c. 870 EN XML", () => {
    const path = getXmlPath("C.R.C._c. 870", "en");
    if (!existsSync(path)) {
      test.skip();
      return;
    }
    const xml = readFileSync(path, "utf-8");
    expect(xml).toContain("reconnaisance");
  });

  test("reconnaissance exists in C.R.C._ch. 870 FR XML", () => {
    const path = getXmlPath("C.R.C._ch. 870", "fr");
    if (!existsSync(path)) {
      test.skip();
      return;
    }
    const xml = readFileSync(path, "utf-8");
    expect(xml).toContain("reconnaissance");
  });

  test("mutiple typo (actual term) exists in C.R.C._c. 870 EN XML", () => {
    const path = getXmlPath("C.R.C._c. 870", "en");
    if (!existsSync(path)) {
      test.skip();
      return;
    }
    const xml = readFileSync(path, "utf-8");
    // The typo is in the actual term, not the paired term
    expect(xml).toContain("mutiple-serving");
  });

  test("multiple-serving exists in C.R.C._ch. 870 FR paired term", () => {
    const path = getXmlPath("C.R.C._ch. 870", "fr");
    if (!existsSync(path)) {
      test.skip();
      return;
    }
    const xml = readFileSync(path, "utf-8");
    // The FR paired term has the correct spelling
    expect(xml).toContain("multiple-serving");
  });

  test("longeur typo exists in SOR-2023-257 EN XML", () => {
    const path = getXmlPath("SOR-2023-257", "en");
    if (!existsSync(path)) {
      test.skip();
      return;
    }
    const xml = readFileSync(path, "utf-8");
    expect(xml).toContain("longeur");
  });

  test("longueur exists in DORS-2023-257 FR XML", () => {
    const path = getXmlPath("DORS-2023-257", "fr");
    if (!existsSync(path)) {
      test.skip();
      return;
    }
    const xml = readFileSync(path, "utf-8");
    expect(xml).toContain("longueur");
  });

  test("practioner typo exists in DORS-2014-304 FR XML", () => {
    const path = getXmlPath("DORS-2014-304", "fr");
    if (!existsSync(path)) {
      test.skip();
      return;
    }
    const xml = readFileSync(path, "utf-8");
    expect(xml).toContain("practioner");
  });

  test("practitioner exists in SOR-2014-304 EN XML", () => {
    const path = getXmlPath("SOR-2014-304", "en");
    if (!existsSync(path)) {
      test.skip();
      return;
    }
    const xml = readFileSync(path, "utf-8");
    expect(xml).toContain("practitioner");
  });
});

// =============================================================================
// Regression Tests - Ensure corrections don't break over time
// =============================================================================

test.describe("Regression tests for correction count", () => {
  test("maintains expected number of corrections", () => {
    const count = getTotalCorrectionCount();
    // Should have at least 25 corrections
    expect(count).toBeGreaterThanOrEqual(25);
  });

  test("maintains expected number of documents with corrections", () => {
    const docs = getDocumentsWithCorrections();
    // Should have at least 18 documents
    expect(docs.length).toBeGreaterThanOrEqual(18);
  });

  test("key documents have corrections defined", () => {
    const docs = getDocumentsWithCorrections();
    const expectedDocs = [
      "C.R.C._c. 870",
      "SOR-2023-257",
      "DORS-2014-304",
      "SOR-2021-268",
      "SOR-91-37",
    ];
    for (const doc of expectedDocs) {
      expect(docs).toContain(doc);
    }
  });
});
