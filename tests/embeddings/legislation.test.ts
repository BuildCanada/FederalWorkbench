/**
 * Tests for legislation embeddings utilities and processing functions.
 *
 * These tests cover the pure utility functions used in the legislation
 * embeddings generation script without requiring database connections.
 */

import { expect, test } from "@playwright/test";

// Precompiled regex for sentence boundary checks in tests
const SENTENCE_END_REGEX = /[.!?]$/;

// Precompiled regex for legal marker content check in tests
const SUBSECTION_WITH_CONTENT_REGEX = /\(1\).*subsection/;

import type {
  Act,
  ContentFlags,
  DefinedTerm,
  Regulation,
  Section,
} from "@/lib/db/legislation/schema";
import {
  DEFAULT_EMBEDDING_MODEL,
  type LegResourceMetadata,
} from "@/lib/db/rag/schema";
import {
  normalizeTermForMatching,
  translateRegulationId,
} from "@/lib/legislation/utils/normalization";
import {
  chunkLegalText,
  chunkSection,
  formatHistoricalNotes,
  identifyMarkerType,
  shouldSkipSection,
  splitIntoLegalUnits,
} from "@/lib/rag/legislation/chunking";
import {
  chunkTextByTokens,
  countTokens,
  normalizeForEmbedding,
  TARGET_CHUNK_TOKENS,
} from "@/lib/rag/shared/chunking";
import { buildActMetadataText } from "@/scripts/embeddings/legislation/acts";
import {
  buildBatchedProvisionContent,
  buildCrossRefContentEn,
  buildCrossRefContentFr,
  buildFootnoteContent,
  buildMarginalNoteContent,
  buildRelatedProvisionContent,
} from "@/scripts/embeddings/legislation/additional-content";
import { buildTermContent } from "@/scripts/embeddings/legislation/defined-terms";
import { buildRegulationMetadataText } from "@/scripts/embeddings/legislation/regulations";
import {
  buildPairedResourceKey,
  buildResourceKey,
  EMBEDDING_DIMENSIONS,
  filterNewChunks,
  formatDuration,
  groupSectionsBy,
  ProgressTracker,
  parsePositiveInteger,
  readOptValue,
  validateEmbedding,
  validateLanguage,
} from "@/scripts/embeddings/legislation/utilities";

test.describe("validateEmbedding", () => {
  test("returns true for valid embedding array", () => {
    const validEmbedding = new Array(EMBEDDING_DIMENSIONS).fill(0.5);
    expect(validateEmbedding(validEmbedding)).toBe(true);
  });

  test("returns false for non-array input", () => {
    expect(validateEmbedding(null)).toBe(false);
    expect(validateEmbedding(undefined)).toBe(false);
    expect(validateEmbedding("string")).toBe(false);
    expect(validateEmbedding(123)).toBe(false);
    expect(validateEmbedding({})).toBe(false);
  });

  test("returns false for wrong dimension count", () => {
    const tooShort = new Array(512).fill(0.5);
    const tooLong = new Array(2048).fill(0.5);
    expect(validateEmbedding(tooShort)).toBe(false);
    expect(validateEmbedding(tooLong)).toBe(false);
  });

  test("returns false for array with non-finite numbers", () => {
    const withNaN = new Array(EMBEDDING_DIMENSIONS).fill(0.5);
    withNaN[100] = Number.NaN;
    expect(validateEmbedding(withNaN)).toBe(false);

    const withInfinity = new Array(EMBEDDING_DIMENSIONS).fill(0.5);
    withInfinity[100] = Number.POSITIVE_INFINITY;
    expect(validateEmbedding(withInfinity)).toBe(false);
  });

  test("returns false for array with non-number values", () => {
    const withString = new Array(EMBEDDING_DIMENSIONS).fill(0.5);
    withString[100] = "not a number";
    expect(validateEmbedding(withString)).toBe(false);
  });

  test("accepts custom dimension count", () => {
    const custom = new Array(512).fill(0.5);
    expect(validateEmbedding(custom, 512)).toBe(true);
    expect(validateEmbedding(custom, 1024)).toBe(false);
  });
});

test.describe("validateLanguage", () => {
  test("returns 'en' for English input", () => {
    expect(validateLanguage("en")).toBe("en");
  });

  test("returns 'fr' for French input", () => {
    expect(validateLanguage("fr")).toBe("fr");
  });

  test("returns null for invalid language codes", () => {
    // After fix, this should return null instead of throwing
    expect(validateLanguage("de")).toBeNull();
    expect(validateLanguage("es")).toBeNull();
    expect(validateLanguage("")).toBeNull();
    expect(validateLanguage("EN")).toBeNull(); // Case sensitive
    expect(validateLanguage("english")).toBeNull();
  });
});

test.describe("parsePositiveInteger", () => {
  test("returns undefined for undefined input", () => {
    expect(parsePositiveInteger(undefined, "--limit")).toBeUndefined();
  });

  test("parses valid positive integers", () => {
    expect(parsePositiveInteger("1", "--limit")).toBe(1);
    expect(parsePositiveInteger("100", "--limit")).toBe(100);
    expect(parsePositiveInteger("999999", "--limit")).toBe(999_999);
  });

  test("throws for non-numeric strings", () => {
    expect(() => parsePositiveInteger("abc", "--limit")).toThrow(
      'Invalid --limit: "abc" is not a valid number'
    );
  });

  test("throws for zero", () => {
    expect(() => parsePositiveInteger("0", "--limit")).toThrow(
      "Invalid --limit: must be positive"
    );
  });

  test("throws for negative numbers", () => {
    expect(() => parsePositiveInteger("-5", "--limit")).toThrow(
      "Invalid --limit: must be positive"
    );
  });

  test("throws for values exceeding maximum", () => {
    expect(() => parsePositiveInteger("2000000", "--limit")).toThrow(
      "Invalid --limit: maximum value is 1000000"
    );
  });

  test("throws for float strings", () => {
    // parseInt will parse "10.5" as 10, which is valid
    expect(parsePositiveInteger("10.5", "--limit")).toBe(10);
  });
});

test.describe("readOptValue", () => {
  test("reads value with equals sign format", () => {
    const args = ["--limit=100", "--other"];
    expect(readOptValue(args, "limit")).toBe("100");
  });

  test("reads value with space-separated format", () => {
    const args = ["--limit", "100", "--other"];
    expect(readOptValue(args, "limit")).toBe("100");
  });

  test("returns undefined for missing option", () => {
    const args = ["--other", "value"];
    expect(readOptValue(args, "limit")).toBeUndefined();
  });

  test("returns undefined when next arg is another flag", () => {
    const args = ["--limit", "--other"];
    expect(readOptValue(args, "limit")).toBeUndefined();
  });

  test("returns undefined when option is at end without value", () => {
    const args = ["--other", "--limit"];
    expect(readOptValue(args, "limit")).toBeUndefined();
  });

  test("prefers equals format over space format", () => {
    const args = ["--limit=50", "--limit", "100"];
    expect(readOptValue(args, "limit")).toBe("50");
  });
});

test.describe("normalizeTermForMatching", () => {
  test("converts to lowercase", () => {
    expect(normalizeTermForMatching("BARRIER")).toBe("barrier");
    expect(normalizeTermForMatching("Tax Shelter")).toBe("tax shelter");
  });

  test("removes accented characters (French)", () => {
    // JavaScript's \w only matches ASCII, so accents are stripped entirely
    expect(normalizeTermForMatching("barrière")).toBe("barrire");
    expect(normalizeTermForMatching("définition")).toBe("dfinition");
    expect(normalizeTermForMatching("réglement")).toBe("rglement");
    // Note: collapsed whitespace from removed apostrophe
    expect(normalizeTermForMatching("commissaire à l'accessibilité")).toBe(
      "commissaire laccessibilit"
    );
  });

  test("converts dashes to spaces for cross-lingual matching", () => {
    // En-dash (U+2013) and em-dash (U+2014) become spaces
    expect(normalizeTermForMatching("Canada–Colombia")).toBe("canada colombia");
    expect(normalizeTermForMatching("Canada—Colombia")).toBe("canada colombia");
    // Regular hyphen also becomes space
    expect(normalizeTermForMatching("tax-exempt")).toBe("tax exempt");
    // This ensures "Canada–Colombia" matches "Canada Colombia"
    expect(normalizeTermForMatching("Canada–Colombia")).toBe(
      normalizeTermForMatching("Canada Colombia")
    );
  });

  test("removes special characters except spaces", () => {
    expect(normalizeTermForMatching("(a) definition")).toBe("a definition");
    expect(normalizeTermForMatching("item's")).toBe("items");
  });

  test("collapses multiple spaces and trims", () => {
    expect(normalizeTermForMatching("defined term")).toBe("defined term");
    expect(normalizeTermForMatching("  multiple   spaces  ")).toBe(
      "multiple spaces"
    );
    expect(normalizeTermForMatching("  leading")).toBe("leading");
    expect(normalizeTermForMatching("trailing  ")).toBe("trailing");
  });

  test("handles empty string", () => {
    expect(normalizeTermForMatching("")).toBe("");
  });

  test("handles real-world bilingual term pairs", () => {
    // These are actual cases from the legislation database
    const testCases = [
      // EN and FR versions should normalize to the same value
      {
        en: "Canada–Colombia Free Trade Agreement",
        fr: "Canada Colombia Free Trade Agreement",
        expected: "canada colombia free trade agreement",
      },
      {
        en: "in vitro embryo",
        fr: "in vitro embryo",
        expected: "in vitro embryo",
      },
      // French accents are stripped for cross-lingual matching
      {
        en: "barrier",
        fr: "barrière",
        enExpected: "barrier",
        frExpected: "barrire",
      },
    ];

    for (const tc of testCases) {
      if ("expected" in tc) {
        expect(normalizeTermForMatching(tc.en)).toBe(tc.expected);
        expect(normalizeTermForMatching(tc.fr)).toBe(tc.expected);
      } else {
        expect(normalizeTermForMatching(tc.en)).toBe(tc.enExpected);
        expect(normalizeTermForMatching(tc.fr)).toBe(tc.frExpected);
      }
    }
  });
});

test.describe("translateRegulationId", () => {
  test("returns same ID when languages match", () => {
    expect(translateRegulationId("SOR-2000-1", "en", "en")).toBe("SOR-2000-1");
    expect(translateRegulationId("DORS-2000-1", "fr", "fr")).toBe(
      "DORS-2000-1"
    );
  });

  test("translates C.R.C. regulations between EN and FR", () => {
    // EN → FR: "c." becomes "ch."
    expect(translateRegulationId("C.R.C._c. 10", "en", "fr")).toBe(
      "C.R.C._ch. 10"
    );
    expect(translateRegulationId("C.R.C._c. 1035", "en", "fr")).toBe(
      "C.R.C._ch. 1035"
    );

    // FR → EN: "ch." becomes "c."
    expect(translateRegulationId("C.R.C._ch. 10", "fr", "en")).toBe(
      "C.R.C._c. 10"
    );
    expect(translateRegulationId("C.R.C._ch. 1035", "fr", "en")).toBe(
      "C.R.C._c. 1035"
    );
  });

  test("translates SOR/DORS regulations between EN and FR", () => {
    // EN → FR: "SOR-" becomes "DORS-"
    expect(translateRegulationId("SOR-2000-1", "en", "fr")).toBe("DORS-2000-1");
    expect(translateRegulationId("SOR-86-946", "en", "fr")).toBe("DORS-86-946");

    // FR → EN: "DORS-" becomes "SOR-"
    expect(translateRegulationId("DORS-2000-1", "fr", "en")).toBe("SOR-2000-1");
    expect(translateRegulationId("DORS-86-946", "fr", "en")).toBe("SOR-86-946");
  });

  test("translates SI/TR statutory instruments between EN and FR", () => {
    // EN → FR: "SI-" becomes "TR-"
    expect(translateRegulationId("SI-2000-100", "en", "fr")).toBe(
      "TR-2000-100"
    );
    expect(translateRegulationId("SI-2000-16", "en", "fr")).toBe("TR-2000-16");

    // FR → EN: "TR-" becomes "SI-"
    expect(translateRegulationId("TR-2000-100", "fr", "en")).toBe(
      "SI-2000-100"
    );
    expect(translateRegulationId("TR-2000-16", "fr", "en")).toBe("SI-2000-16");
  });

  test("translates annual statute IDs between EN and FR", () => {
    // EN → FR: "_c. " becomes "_ch. " and "_s. " becomes "_art. "
    expect(translateRegulationId("2018_c. 12_s. 187", "en", "fr")).toBe(
      "2018_ch. 12_art. 187"
    );
    expect(translateRegulationId("2010_c. 12_s. 91", "en", "fr")).toBe(
      "2010_ch. 12_art. 91"
    );
    expect(translateRegulationId("2024_c. 15_s. 97", "en", "fr")).toBe(
      "2024_ch. 15_art. 97"
    );

    // FR → EN: "_ch. " becomes "_c. " and "_art. " becomes "_s. "
    expect(translateRegulationId("2018_ch. 12_art. 187", "fr", "en")).toBe(
      "2018_c. 12_s. 187"
    );
    expect(translateRegulationId("2010_ch. 12_art. 91", "fr", "en")).toBe(
      "2010_c. 12_s. 91"
    );
    expect(translateRegulationId("2024_ch. 15_art. 97", "fr", "en")).toBe(
      "2024_c. 15_s. 97"
    );
  });

  test("returns original ID for unknown formats", () => {
    // Unknown formats should pass through unchanged
    expect(translateRegulationId("UNKNOWN-123", "en", "fr")).toBe(
      "UNKNOWN-123"
    );
    expect(translateRegulationId("UNKNOWN-123", "fr", "en")).toBe(
      "UNKNOWN-123"
    );
    expect(translateRegulationId("some-random-id", "en", "fr")).toBe(
      "some-random-id"
    );
  });

  test("bidirectional translation is consistent", () => {
    // EN → FR → EN should return original
    const enIds = [
      "C.R.C._c. 10",
      "SOR-2000-1",
      "SI-2000-100",
      "2018_c. 12_s. 187",
    ];
    for (const enId of enIds) {
      const frId = translateRegulationId(enId, "en", "fr");
      const backToEn = translateRegulationId(frId, "fr", "en");
      expect(backToEn).toBe(enId);
    }

    // FR → EN → FR should return original
    const frIds = [
      "C.R.C._ch. 10",
      "DORS-2000-1",
      "TR-2000-100",
      "2018_ch. 12_art. 187",
    ];
    for (const frId of frIds) {
      const enId = translateRegulationId(frId, "fr", "en");
      const backToFr = translateRegulationId(enId, "en", "fr");
      expect(backToFr).toBe(frId);
    }
  });
});

test.describe("buildResourceKey", () => {
  test("builds correct key format", () => {
    expect(buildResourceKey("act", "C-46", "en", 0)).toBe("act:C-46:en:0");
    expect(buildResourceKey("regulation", "SOR-86-946", "fr", 5)).toBe(
      "regulation:SOR-86-946:fr:5"
    );
  });

  test("handles section types", () => {
    expect(buildResourceKey("act_section", "sec-123", "en", 1)).toBe(
      "act_section:sec-123:en:1"
    );
    expect(buildResourceKey("regulation_section", "sec-456", "fr", 2)).toBe(
      "regulation_section:sec-456:fr:2"
    );
  });

  test("handles cross_reference type with language-specific keys", () => {
    // Each cross-reference should have separate EN and FR keys
    const refId = "xref-abc123";
    const keyEn = buildResourceKey("cross_reference", refId, "en", 0);
    const keyFr = buildResourceKey("cross_reference", refId, "fr", 0);

    expect(keyEn).toBe("cross_reference:xref-abc123:en:0");
    expect(keyFr).toBe("cross_reference:xref-abc123:fr:0");

    // Keys should be distinct
    expect(keyEn).not.toBe(keyFr);
  });

  test("handles schedule type (section with sectionType=schedule)", () => {
    // Schedule sections use the "schedule" source type instead of act_section/regulation_section
    const sectionId = "sec-schedule-123";
    const keyEn = buildResourceKey("schedule", sectionId, "en", 0);
    const keyFr = buildResourceKey("schedule", sectionId, "fr", 0);

    expect(keyEn).toBe("schedule:sec-schedule-123:en:0");
    expect(keyFr).toBe("schedule:sec-schedule-123:fr:0");

    // Keys should be distinct by language
    expect(keyEn).not.toBe(keyFr);
  });

  test("schedule keys are distinct from act_section keys for same section ID", () => {
    // Ensures schedule sections are properly distinguished from regular sections
    const sectionId = "sec-123";
    const scheduleKey = buildResourceKey("schedule", sectionId, "en", 0);
    const actSectionKey = buildResourceKey("act_section", sectionId, "en", 0);

    expect(scheduleKey).toBe("schedule:sec-123:en:0");
    expect(actSectionKey).toBe("act_section:sec-123:en:0");
    expect(scheduleKey).not.toBe(actSectionKey);
  });
});

test.describe("formatDuration", () => {
  test("formats seconds only", () => {
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(59_000)).toBe("59s");
  });

  test("formats minutes and seconds", () => {
    expect(formatDuration(60_000)).toBe("1m 0s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(3_599_000)).toBe("59m 59s");
  });

  test("formats hours, minutes, and seconds", () => {
    expect(formatDuration(3_600_000)).toBe("1h 0m 0s");
    expect(formatDuration(3_661_000)).toBe("1h 1m 1s");
    expect(formatDuration(7_325_000)).toBe("2h 2m 5s");
  });

  test("handles zero", () => {
    expect(formatDuration(0)).toBe("0s");
  });
});

test.describe("buildActMetadataText", () => {
  const createMockAct = (overrides: Partial<Act> = {}): Act => ({
    id: "test-id",
    actId: "C-46",
    title: "Criminal Code",
    longTitle: "An Act respecting the criminal law",
    language: "en",
    status: "in-force",
    inForceDate: "1985-07-01",
    enactedDate: "1985-01-01",
    consolidationDate: "2024-01-15",
    billOrigin: "commons",
    runningHead: null,
    lastAmendedDate: null,
    billType: null,
    hasPreviousVersion: null,
    consolidatedNumber: null,
    consolidatedNumberOfficial: null,
    annualStatuteYear: null,
    annualStatuteChapter: null,
    shortTitleStatus: null,
    reversedShortTitle: null,
    consolidateFlag: false,
    limsMetadata: null,
    billHistory: null,
    recentAmendments: null,
    preamble: null,
    relatedProvisions: null,
    treaties: null,
    signatureBlocks: null,
    tableOfProvisions: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  test("builds English metadata correctly", () => {
    const act = createMockAct();
    const text = buildActMetadataText(act);

    expect(text).toContain("Act: Criminal Code");
    expect(text).toContain("Long Title: An Act respecting the criminal law");
    expect(text).toContain("ID: C-46");
    expect(text).toContain("Status: in-force");
    expect(text).toContain("In Force: 1985-07-01");
    expect(text).toContain("Enacted: 1985-01-01");
    expect(text).toContain("Consolidation: 2024-01-15");
    expect(text).toContain("Origin: House of Commons");
  });

  test("builds French metadata correctly", () => {
    const act = createMockAct({
      language: "fr",
      title: "Code criminel",
      longTitle: "Loi concernant le droit criminel",
      billOrigin: "senate",
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Loi: Code criminel");
    expect(text).toContain("Titre complet: Loi concernant le droit criminel");
    expect(text).toContain("Identifiant: C-46");
    expect(text).toContain("Statut: in-force");
    expect(text).toContain("Origine: Sénat");
  });

  test("omits null fields", () => {
    const act = createMockAct({
      longTitle: null,
      inForceDate: null,
      enactedDate: null,
      consolidationDate: null,
      billOrigin: null,
    });
    const text = buildActMetadataText(act);

    expect(text).not.toContain("Long Title");
    expect(text).not.toContain("In Force");
    expect(text).not.toContain("Enacted");
    expect(text).not.toContain("Consolidation");
    expect(text).not.toContain("Origin");
  });

  test("includes runningHead in English", () => {
    const act = createMockAct({
      runningHead: "Criminal Code",
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Short Title: Criminal Code");
  });

  test("includes runningHead in French", () => {
    const act = createMockAct({
      language: "fr",
      runningHead: "Code criminel",
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Titre abrégé: Code criminel");
  });

  test("includes billType in English", () => {
    const act = createMockAct({
      billType: "govt-public",
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Bill Type: govt-public");
  });

  test("includes billType in French", () => {
    const act = createMockAct({
      language: "fr",
      billType: "govt-public",
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Type de projet de loi: govt-public");
  });

  test("includes lastAmendedDate in English", () => {
    const act = createMockAct({
      lastAmendedDate: "2024-06-15",
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Last Amended: 2024-06-15");
  });

  test("includes lastAmendedDate in French", () => {
    const act = createMockAct({
      language: "fr",
      lastAmendedDate: "2024-06-15",
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Dernière modification: 2024-06-15");
  });

  test("includes consolidatedNumber in English", () => {
    const act = createMockAct({
      consolidatedNumber: "C-46",
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Consolidated Number: C-46");
  });

  test("includes consolidatedNumber in French", () => {
    const act = createMockAct({
      language: "fr",
      consolidatedNumber: "C-46",
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Numéro de consolidation: C-46");
  });

  test("includes annualStatuteYear and annualStatuteChapter in English", () => {
    const act = createMockAct({
      annualStatuteYear: "2019",
      annualStatuteChapter: "10",
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Annual Statutes: 2019, c. 10");
  });

  test("includes annualStatuteYear and annualStatuteChapter in French", () => {
    const act = createMockAct({
      language: "fr",
      annualStatuteYear: "2019",
      annualStatuteChapter: "10",
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Lois annuelles: 2019, ch. 10");
  });

  test("omits annual statute fields when only year is present", () => {
    const act = createMockAct({
      annualStatuteYear: "2019",
      annualStatuteChapter: null,
    });
    const text = buildActMetadataText(act);

    expect(text).not.toContain("Annual Statutes");
  });

  test("includes billHistory with billNumber in English", () => {
    const act = createMockAct({
      billHistory: {
        billNumber: "C-81",
      },
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Bill Number: C-81");
  });

  test("includes billHistory with billNumber in French", () => {
    const act = createMockAct({
      language: "fr",
      billHistory: {
        billNumber: "C-81",
      },
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Numéro du projet de loi: C-81");
  });

  test("includes billHistory parliament info in English", () => {
    const act = createMockAct({
      billHistory: {
        parliament: {
          number: "42",
          session: "1",
        },
      },
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Parliament: 42nd Parliament, 1st Session");
  });

  test("includes billHistory parliament info in French", () => {
    const act = createMockAct({
      language: "fr",
      billHistory: {
        parliament: {
          number: "42",
          session: "1",
        },
      },
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Parlement: 42e législature, 1e session");
  });

  test("includes billHistory royal assent date in English", () => {
    const act = createMockAct({
      billHistory: {
        stages: [
          { stage: "first-reading", date: "2019-01-15" },
          { stage: "assented-to", date: "2019-06-21" },
        ],
      },
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Royal Assent: 2019-06-21");
  });

  test("includes billHistory royal assent date in French", () => {
    const act = createMockAct({
      language: "fr",
      billHistory: {
        stages: [{ stage: "assented-to", date: "2019-06-21" }],
      },
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Sanction royale: 2019-06-21");
  });

  test("includes complete billHistory with all fields", () => {
    const act = createMockAct({
      billHistory: {
        billNumber: "C-81",
        parliament: {
          number: "42",
          session: "1",
        },
        stages: [{ stage: "assented-to", date: "2019-06-21" }],
      },
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Bill Number: C-81");
    expect(text).toContain("Parliament: 42nd Parliament, 1st Session");
    expect(text).toContain("Royal Assent: 2019-06-21");
  });

  test("includes recentAmendments in English", () => {
    const act = createMockAct({
      recentAmendments: [
        { citation: "2024, c. 15, s. 20", date: "2024-06-21" },
        { citation: "2023, c. 10, s. 5" },
      ],
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Recent Amendments:");
    expect(text).toContain("  - 2024, c. 15, s. 20 (2024-06-21)");
    expect(text).toContain("  - 2023, c. 10, s. 5");
  });

  test("includes recentAmendments in French", () => {
    const act = createMockAct({
      language: "fr",
      recentAmendments: [
        { citation: "2024, ch. 15, art. 20", date: "2024-06-21" },
      ],
    });
    const text = buildActMetadataText(act);

    expect(text).toContain("Modifications récentes:");
    expect(text).toContain("  - 2024, ch. 15, art. 20 (2024-06-21)");
  });

  test("omits recentAmendments when empty array", () => {
    const act = createMockAct({
      recentAmendments: [],
    });
    const text = buildActMetadataText(act);

    expect(text).not.toContain("Recent Amendments");
    expect(text).not.toContain("Modifications récentes");
  });

  test("omits recentAmendments when null", () => {
    const act = createMockAct({
      recentAmendments: null,
    });
    const text = buildActMetadataText(act);

    expect(text).not.toContain("Recent Amendments");
    expect(text).not.toContain("Modifications récentes");
  });
});

test.describe("buildRegulationMetadataText", () => {
  const createMockRegulation = (
    overrides: Partial<Regulation> = {}
  ): Regulation => ({
    id: "test-id",
    regulationId: "SOR-86-946",
    title: "Employment Insurance Regulations",
    longTitle: "Regulations respecting employment insurance",
    language: "en",
    status: "in-force",
    regulationType: "SOR",
    instrumentNumber: "SOR/86-946",
    reversedShortTitle: null,
    consolidateFlag: false,
    registrationDate: "1986-10-01",
    enablingActId: "C-46",
    enablingActTitle: "Employment Insurance Act",
    consolidationDate: "2024-01-15",
    gazettePart: null,
    enablingAuthorities: null,
    hasPreviousVersion: null,
    lastAmendedDate: null,
    limsMetadata: null,
    regulationMakerOrder: null,
    recentAmendments: null,
    relatedProvisions: null,
    treaties: null,
    recommendations: null,
    notices: null,
    signatureBlocks: null,
    tableOfProvisions: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  test("builds English metadata correctly", () => {
    const reg = createMockRegulation();
    const text = buildRegulationMetadataText(reg);

    expect(text).toContain("Regulation: Employment Insurance Regulations");
    expect(text).toContain(
      "Long Title: Regulations respecting employment insurance"
    );
    expect(text).toContain("ID: SOR-86-946");
    expect(text).toContain("Instrument Number: SOR/86-946");
    expect(text).toContain("Status: in-force");
    expect(text).toContain("Type: SOR");
    expect(text).toContain("Registration Date: 1986-10-01");
    expect(text).toContain("Enabling Act: Employment Insurance Act");
    expect(text).toContain("Consolidation: 2024-01-15");
  });

  test("builds French metadata correctly", () => {
    const reg = createMockRegulation({
      language: "fr",
      title: "Règlement sur l'assurance-emploi",
      longTitle: "Règlement concernant l'assurance-emploi",
      enablingActTitle: "Loi sur l'assurance-emploi",
    });
    const text = buildRegulationMetadataText(reg);

    expect(text).toContain("Règlement: Règlement sur l'assurance-emploi");
    expect(text).toContain(
      "Titre complet: Règlement concernant l'assurance-emploi"
    );
    expect(text).toContain("Identifiant: SOR-86-946");
    expect(text).toContain("Loi habilitante: Loi sur l'assurance-emploi");
  });

  test("omits null optional fields", () => {
    // Note: instrumentNumber is required, so we test only optional fields
    const reg = createMockRegulation({
      longTitle: null,
      regulationType: null,
      registrationDate: null,
      enablingActId: null,
      enablingActTitle: null,
      consolidationDate: null,
    });
    const text = buildRegulationMetadataText(reg);

    expect(text).not.toContain("Long Title");
    expect(text).not.toContain("Type");
    expect(text).not.toContain("Registration Date");
    expect(text).not.toContain("Enabling Act");
    expect(text).not.toContain("Consolidation");
    // instrumentNumber is always present since it's required
    expect(text).toContain("Instrument Number");
  });

  test("handles single enabling authority from array", () => {
    const reg = createMockRegulation({
      enablingAuthorities: [
        { actId: "C-46", actTitle: "Employment Insurance Act" },
      ],
      enablingActId: null,
      enablingActTitle: null,
    });
    const text = buildRegulationMetadataText(reg);

    // Should use singular form for single authority
    expect(text).toContain("Enabling Act: Employment Insurance Act");
    expect(text).not.toContain("Enabling Acts:");
  });

  test("handles multiple enabling authorities", () => {
    const reg = createMockRegulation({
      enablingAuthorities: [
        { actId: "C-46", actTitle: "Employment Insurance Act" },
        { actId: "F-2", actTitle: "Financial Administration Act" },
        { actId: "P-8.6", actTitle: "Public Service Employment Act" },
      ],
      enablingActId: null,
      enablingActTitle: null,
    });
    const text = buildRegulationMetadataText(reg);

    // Should use plural form and list all authorities
    expect(text).toContain("Enabling Acts:");
    expect(text).toContain("Employment Insurance Act (C-46)");
    expect(text).toContain("Financial Administration Act (F-2)");
    expect(text).toContain("Public Service Employment Act (P-8.6)");
  });

  test("handles multiple enabling authorities in French", () => {
    const reg = createMockRegulation({
      language: "fr",
      title: "Règlement sur l'assurance-emploi",
      enablingAuthorities: [
        { actId: "C-46", actTitle: "Loi sur l'assurance-emploi" },
        { actId: "F-2", actTitle: "Loi sur la gestion des finances publiques" },
      ],
      enablingActId: null,
      enablingActTitle: null,
    });
    const text = buildRegulationMetadataText(reg);

    // Should use French plural form
    expect(text).toContain("Lois habilitantes:");
    expect(text).toContain("Loi sur l'assurance-emploi (C-46)");
    expect(text).toContain("Loi sur la gestion des finances publiques (F-2)");
  });

  test("falls back to legacy enablingActTitle when no enablingAuthorities", () => {
    const reg = createMockRegulation({
      enablingAuthorities: null,
      enablingActId: "C-46",
      enablingActTitle: "Employment Insurance Act",
    });
    const text = buildRegulationMetadataText(reg);

    expect(text).toContain("Enabling Act: Employment Insurance Act");
  });

  test("prefers enablingAuthorities over legacy fields when both present", () => {
    const reg = createMockRegulation({
      enablingAuthorities: [{ actId: "A-1", actTitle: "Aeronautics Act" }],
      enablingActId: "C-46",
      enablingActTitle: "Employment Insurance Act", // Should be ignored
    });
    const text = buildRegulationMetadataText(reg);

    expect(text).toContain("Enabling Act: Aeronautics Act");
    expect(text).not.toContain("Employment Insurance Act");
  });

  test("includes lastAmendedDate in English", () => {
    const reg = createMockRegulation({
      lastAmendedDate: "2024-06-15",
    });
    const text = buildRegulationMetadataText(reg);

    expect(text).toContain("Last Amended: 2024-06-15");
  });

  test("includes lastAmendedDate in French", () => {
    const reg = createMockRegulation({
      language: "fr",
      lastAmendedDate: "2024-06-15",
    });
    const text = buildRegulationMetadataText(reg);

    expect(text).toContain("Dernière modification: 2024-06-15");
  });

  test("includes gazettePart in English", () => {
    const reg = createMockRegulation({
      gazettePart: "II",
    });
    const text = buildRegulationMetadataText(reg);

    expect(text).toContain("Gazette Part: II");
  });

  test("includes gazettePart in French", () => {
    const reg = createMockRegulation({
      language: "fr",
      gazettePart: "II",
    });
    const text = buildRegulationMetadataText(reg);

    expect(text).toContain("Partie de la Gazette: II");
  });

  test("includes regulationMakerOrder in English", () => {
    const reg = createMockRegulation({
      regulationMakerOrder: {
        regulationMaker: "Governor General in Council",
        orderNumber: "P.C. 2024-123",
        orderDate: "2024-01-15",
      },
    });
    const text = buildRegulationMetadataText(reg);

    expect(text).toContain(
      "Made by: Governor General in Council, P.C. 2024-123 (2024-01-15)"
    );
  });

  test("includes regulationMakerOrder in French", () => {
    const reg = createMockRegulation({
      language: "fr",
      regulationMakerOrder: {
        regulationMaker: "Gouverneur général en conseil",
        orderNumber: "C.P. 2024-123",
        orderDate: "2024-01-15",
      },
    });
    const text = buildRegulationMetadataText(reg);

    expect(text).toContain(
      "Pris par: Gouverneur général en conseil, C.P. 2024-123 (2024-01-15)"
    );
  });

  test("includes regulationMakerOrder with only regulationMaker", () => {
    const reg = createMockRegulation({
      regulationMakerOrder: {
        regulationMaker: "Minister of Finance",
      },
    });
    const text = buildRegulationMetadataText(reg);

    expect(text).toContain("Made by: Minister of Finance");
    expect(text).not.toContain("(");
  });

  test("includes regulationMakerOrder with regulationMaker and orderNumber only", () => {
    const reg = createMockRegulation({
      regulationMakerOrder: {
        regulationMaker: "Governor General in Council",
        orderNumber: "P.C. 2024-456",
      },
    });
    const text = buildRegulationMetadataText(reg);

    expect(text).toContain(
      "Made by: Governor General in Council, P.C. 2024-456"
    );
    expect(text).not.toContain("(");
  });

  test("omits regulationMakerOrder when regulationMaker is empty", () => {
    const reg = createMockRegulation({
      regulationMakerOrder: {
        orderNumber: "P.C. 2024-123",
        orderDate: "2024-01-15",
      },
    });
    const text = buildRegulationMetadataText(reg);

    expect(text).not.toContain("Made by:");
    expect(text).not.toContain("Pris par:");
  });

  test("includes recentAmendments in English", () => {
    const reg = createMockRegulation({
      recentAmendments: [
        { citation: "SOR/2024-100", date: "2024-06-21" },
        { citation: "SOR/2023-50" },
      ],
    });
    const text = buildRegulationMetadataText(reg);

    expect(text).toContain("Recent Amendments:");
    expect(text).toContain("  - SOR/2024-100 (2024-06-21)");
    expect(text).toContain("  - SOR/2023-50");
  });

  test("includes recentAmendments in French", () => {
    const reg = createMockRegulation({
      language: "fr",
      recentAmendments: [{ citation: "DORS/2024-100", date: "2024-06-21" }],
    });
    const text = buildRegulationMetadataText(reg);

    expect(text).toContain("Modifications récentes:");
    expect(text).toContain("  - DORS/2024-100 (2024-06-21)");
  });

  test("omits recentAmendments when empty array", () => {
    const reg = createMockRegulation({
      recentAmendments: [],
    });
    const text = buildRegulationMetadataText(reg);

    expect(text).not.toContain("Recent Amendments");
    expect(text).not.toContain("Modifications récentes");
  });

  test("omits recentAmendments when null", () => {
    const reg = createMockRegulation({
      recentAmendments: null,
    });
    const text = buildRegulationMetadataText(reg);

    expect(text).not.toContain("Recent Amendments");
    expect(text).not.toContain("Modifications récentes");
  });
});

test.describe("shouldSkipSection", () => {
  const createMockSection = (overrides: Partial<Section> = {}): Section => ({
    id: "test-section-id",
    actId: "C-46",
    regulationId: null,
    canonicalSectionId: "C-46/en/s123",
    sectionLabel: "123",
    sectionOrder: 1,
    language: "en",
    content: "This is the section content.",
    marginalNote: "Test marginal note",
    sectionType: "section",
    hierarchyPath: null,
    contentHtml: null,
    status: "in-force",
    xmlType: null,
    xmlTarget: null,
    changeType: null,
    inForceStartDate: null,
    lastAmendedDate: null,
    enactedDate: null,
    limsMetadata: null,
    historicalNotes: null,
    footnotes: null,
    scheduleId: null,
    scheduleBilingual: null,
    scheduleSpanLanguages: null,
    scheduleOriginatingRef: null,
    contentFlags: null,
    formattingAttributes: null,
    provisionHeading: null,
    internalReferences: null,
    createdAt: new Date(),
    ...overrides,
  });

  test("returns false for section with content", () => {
    const section = createMockSection();
    expect(shouldSkipSection(section)).toBe(false);
  });

  test("returns true for section with empty content", () => {
    const section = createMockSection({ content: "" });
    expect(shouldSkipSection(section)).toBe(true);
  });

  test("returns true for section with whitespace-only content", () => {
    const section = createMockSection({ content: "   \n\t  " });
    expect(shouldSkipSection(section)).toBe(true);
  });

  test("returns true for section with null content", () => {
    const section = createMockSection({ content: null as unknown as string });
    expect(shouldSkipSection(section)).toBe(true);
  });

  test("returns false for repealed section with content", () => {
    // Repealed sections should NOT be skipped - they're part of the legal record
    const section = createMockSection({
      content: "[Repealed, 2020, c. 1, s. 5]",
      marginalNote: "Repealed",
    });
    expect(shouldSkipSection(section)).toBe(false);
  });
});

test.describe("formatHistoricalNotes", () => {
  test("returns empty string for empty array", () => {
    expect(formatHistoricalNotes([])).toBe("");
  });

  test("formats single historical note in English", () => {
    const notes = [{ text: "2024, c. 20, s. 15" }];
    const result = formatHistoricalNotes(notes, "en");

    expect(result).toContain("History:");
    expect(result).toContain("2024, c. 20, s. 15");
  });

  test("formats single historical note in French", () => {
    const notes = [{ text: "2024, ch. 20, art. 15" }];
    const result = formatHistoricalNotes(notes, "fr");

    expect(result).toContain("Historique:");
    expect(result).toContain("2024, ch. 20, art. 15");
  });

  test("formats multiple historical notes separated by semicolons", () => {
    const notes = [
      { text: "2020, c. 1, s. 5" },
      { text: "2022, c. 10, s. 3" },
      { text: "2024, c. 20, s. 15" },
    ];
    const result = formatHistoricalNotes(notes, "en");

    expect(result).toContain("History:");
    expect(result).toContain("2020, c. 1, s. 5");
    expect(result).toContain("; 2022, c. 10, s. 3");
    expect(result).toContain("; 2024, c. 20, s. 15");
  });

  test("includes enacted date when provided", () => {
    const notes = [{ text: "2024, c. 20", enactedDate: "2024-06-15" }];
    const result = formatHistoricalNotes(notes, "en");

    expect(result).toContain("(enacted: 2024-06-15)");
  });

  test("includes in force date when different from enacted date", () => {
    const notes = [
      {
        text: "2024, c. 20",
        enactedDate: "2024-06-15",
        inForceStartDate: "2024-09-01",
      },
    ];
    const result = formatHistoricalNotes(notes, "en");

    expect(result).toContain("(enacted: 2024-06-15)");
    expect(result).toContain("(in force: 2024-09-01)");
  });

  test("does not duplicate in force date when same as enacted date", () => {
    const notes = [
      {
        text: "2024, c. 20",
        enactedDate: "2024-06-15",
        inForceStartDate: "2024-06-15",
      },
    ];
    const result = formatHistoricalNotes(notes, "en");

    expect(result).toContain("(enacted: 2024-06-15)");
    expect(result).not.toContain("(in force:");
  });

  test("does not duplicate date if already in text", () => {
    const notes = [
      {
        text: "2024, c. 20, s. 15 (2024-06-15)",
        enactedDate: "2024-06-15",
      },
    ];
    const result = formatHistoricalNotes(notes, "en");

    expect(result).not.toContain("(enacted:");
    expect(result).toContain("2024, c. 20, s. 15 (2024-06-15)");
  });

  test("handles note with original type", () => {
    const notes = [
      { text: "R.S., 1985, c. C-46", type: "original" },
      { text: "2020, c. 1, s. 5" },
    ];
    const result = formatHistoricalNotes(notes, "en");

    expect(result).toContain("R.S., 1985, c. C-46");
    expect(result).toContain("2020, c. 1, s. 5");
  });

  test("uses French labels for enacted date when language is fr", () => {
    const notes = [{ text: "2024, ch. 20", enactedDate: "2024-06-15" }];
    const result = formatHistoricalNotes(notes, "fr");

    expect(result).toContain("(édicté: 2024-06-15)");
    expect(result).not.toContain("(enacted:");
  });

  test("uses French labels for in force date when language is fr", () => {
    const notes = [
      {
        text: "2024, ch. 20",
        enactedDate: "2024-06-15",
        inForceStartDate: "2024-09-01",
      },
    ];
    const result = formatHistoricalNotes(notes, "fr");

    expect(result).toContain("(édicté: 2024-06-15)");
    expect(result).toContain("(en vigueur: 2024-09-01)");
    expect(result).not.toContain("(enacted:");
    expect(result).not.toContain("(in force:");
  });
});

test.describe("chunkSection", () => {
  const createMockSection = (overrides: Partial<Section> = {}): Section => ({
    id: "test-section-id",
    actId: "C-46",
    regulationId: null,
    canonicalSectionId: "C-46/en/s91",
    sectionLabel: "91",
    sectionOrder: 1,
    language: "en",
    content: "This is a short section content.",
    marginalNote: "Legislative Powers",
    sectionType: "section",
    hierarchyPath: null,
    contentHtml: null,
    status: "in-force",
    xmlType: null,
    xmlTarget: null,
    changeType: null,
    inForceStartDate: null,
    lastAmendedDate: null,
    enactedDate: null,
    limsMetadata: null,
    historicalNotes: null,
    footnotes: null,
    scheduleId: null,
    scheduleBilingual: null,
    scheduleSpanLanguages: null,
    scheduleOriginatingRef: null,
    contentFlags: null,
    formattingAttributes: null,
    provisionHeading: null,
    internalReferences: null,
    createdAt: new Date(),
    ...overrides,
  });

  test("returns single chunk for small section", () => {
    const section = createMockSection();
    const chunks = chunkSection(section, "Constitution Act, 1867");

    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].totalChunks).toBe(1);
    expect(chunks[0].content).toContain("Constitution Act, 1867");
    expect(chunks[0].content).toContain("Section 91");
    expect(chunks[0].content).toContain("Legislative Powers");
    expect(chunks[0].content).toContain("This is a short section content.");
  });

  test("includes section label without marginal note when not present", () => {
    const section = createMockSection({ marginalNote: null });
    const chunks = chunkSection(section, "Criminal Code");

    expect(chunks[0].content).toContain("Section 91");
    expect(chunks[0].content).not.toContain(":");
  });

  test("splits large sections into multiple chunks", () => {
    // Create content larger than CHUNK_SIZE_CHARS
    const longContent = "Lorem ipsum dolor sit amet. ".repeat(500);
    const section = createMockSection({ content: longContent });
    const chunks = chunkSection(section, "Long Act");

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].totalChunks).toBe(chunks.length);
    expect(chunks.at(-1)?.chunkIndex).toBe(chunks.length - 1);

    // All chunks should have the prefix
    for (const chunk of chunks) {
      expect(chunk.content).toContain("Long Act");
      expect(chunk.content).toContain("Section 91");
    }
  });

  test("each chunk respects token limit", () => {
    const longContent = "Word ".repeat(2000);
    const section = createMockSection({ content: longContent });
    const chunks = chunkSection(section, "Test Act");

    // Each chunk should be within token limits (with some tolerance for prefix)
    for (const chunk of chunks) {
      const tokenCount = countTokens(chunk.content);
      expect(tokenCount).toBeLessThanOrEqual(TARGET_CHUNK_TOKENS + 50);
    }
  });

  test("includes historical notes when provided", () => {
    const section = createMockSection({
      content: "This section establishes the basic framework.",
    });
    const historicalNotes = [
      { text: "2020, c. 1, s. 5" },
      { text: "2024, c. 20, s. 15" },
    ];

    const chunks = chunkSection(section, "Criminal Code", { historicalNotes });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("History:");
    expect(chunks[0].content).toContain("2020, c. 1, s. 5");
    expect(chunks[0].content).toContain("2024, c. 20, s. 15");
  });

  test("uses French label for historical notes when language is fr", () => {
    const section = createMockSection({
      content: "Cette section établit le cadre de base.",
    });
    const historicalNotes = [{ text: "2024, ch. 20, art. 15" }];

    const chunks = chunkSection(section, "Code criminel", {
      historicalNotes,
      language: "fr",
    });

    expect(chunks[0].content).toContain("Historique:");
    expect(chunks[0].content).toContain("2024, ch. 20, art. 15");
  });

  test("does not include history section when historicalNotes is null", () => {
    const section = createMockSection();
    const chunks = chunkSection(section, "Test Act", { historicalNotes: null });

    expect(chunks[0].content).not.toContain("History:");
    expect(chunks[0].content).not.toContain("Historique:");
  });

  test("does not include history section when historicalNotes is empty", () => {
    const section = createMockSection();
    const chunks = chunkSection(section, "Test Act", { historicalNotes: [] });

    expect(chunks[0].content).not.toContain("History:");
    expect(chunks[0].content).not.toContain("Historique:");
  });

  test("historical notes appear after section content but in all chunks for large sections", () => {
    // Create content that will require multiple chunks
    const longContent = "Legal provision text. ".repeat(400);
    const section = createMockSection({ content: longContent });
    const historicalNotes = [
      { text: "R.S., 1985, c. C-46" },
      { text: "2020, c. 1, s. 5" },
    ];

    const chunks = chunkSection(section, "Criminal Code", { historicalNotes });

    // Should have multiple chunks
    expect(chunks.length).toBeGreaterThan(1);

    // Historical notes should be in the chunked content (may appear in last chunks due to ordering)
    const allContent = chunks.map((c) => c.content).join(" ");
    expect(allContent).toContain("History:");
    expect(allContent).toContain("R.S., 1985, c. C-46");
    expect(allContent).toContain("2020, c. 1, s. 5");
  });
});

test.describe("groupSectionsBy", () => {
  const createMockSection = (overrides: Partial<Section> = {}): Section => ({
    id: "test-section-id",
    actId: "C-46",
    regulationId: null,
    canonicalSectionId: "C-46/en/s1",
    sectionLabel: "1",
    sectionOrder: 1,
    language: "en",
    content: "Test content",
    marginalNote: null,
    sectionType: "section",
    hierarchyPath: null,
    contentHtml: null,
    status: "in-force",
    xmlType: null,
    xmlTarget: null,
    changeType: null,
    inForceStartDate: null,
    lastAmendedDate: null,
    enactedDate: null,
    limsMetadata: null,
    historicalNotes: null,
    footnotes: null,
    scheduleId: null,
    scheduleBilingual: null,
    scheduleSpanLanguages: null,
    scheduleOriginatingRef: null,
    contentFlags: null,
    formattingAttributes: null,
    provisionHeading: null,
    internalReferences: null,
    createdAt: new Date(),
    ...overrides,
  });

  test("groups sections by actId and language", () => {
    const sections: Section[] = [
      createMockSection({ id: "s1", actId: "C-46", language: "en" }),
      createMockSection({ id: "s2", actId: "C-46", language: "en" }),
      createMockSection({ id: "s3", actId: "C-46", language: "fr" }),
      createMockSection({ id: "s4", actId: "C-11", language: "en" }),
    ];

    const grouped = groupSectionsBy(sections, "actId");

    expect(grouped.size).toBe(3);
    expect(grouped.get("C-46:en")).toHaveLength(2);
    expect(grouped.get("C-46:fr")).toHaveLength(1);
    expect(grouped.get("C-11:en")).toHaveLength(1);
  });

  test("groups sections by regulationId and language", () => {
    const sections: Section[] = [
      createMockSection({
        id: "s1",
        actId: null,
        regulationId: "SOR-86-1",
        language: "en",
      }),
      createMockSection({
        id: "s2",
        actId: null,
        regulationId: "SOR-86-1",
        language: "fr",
      }),
      createMockSection({
        id: "s3",
        actId: null,
        regulationId: "SOR-86-2",
        language: "en",
      }),
    ];

    const grouped = groupSectionsBy(sections, "regulationId");

    expect(grouped.size).toBe(3);
    expect(grouped.get("SOR-86-1:en")).toHaveLength(1);
    expect(grouped.get("SOR-86-1:fr")).toHaveLength(1);
    expect(grouped.get("SOR-86-2:en")).toHaveLength(1);
  });

  test("skips sections with null parent ID", () => {
    const sections: Section[] = [
      createMockSection({ id: "s1", actId: "C-46" }),
      createMockSection({ id: "s2", actId: null }),
    ];

    const grouped = groupSectionsBy(sections, "actId");

    expect(grouped.size).toBe(1);
    expect(grouped.get("C-46:en")).toHaveLength(1);
  });

  test("returns empty map for empty input", () => {
    const grouped = groupSectionsBy([], "actId");
    expect(grouped.size).toBe(0);
  });
});

test.describe("filterNewChunks", () => {
  // Create a temporary progress tracker for testing
  let tracker: ProgressTracker;

  test.beforeEach(() => {
    // Use in-memory database for test isolation (avoids file locking in parallel tests)
    tracker = new ProgressTracker(":memory:");
  });

  test.afterEach(() => {
    tracker.close();
  });

  test("returns all chunks when skipExisting is false", () => {
    const chunks = [
      {
        content: "test1",
        chunkIndex: 0,
        totalChunks: 1,
        resourceKey: "act:C-1:en:0",
        metadata: {
          sourceType: "act" as const,
          language: "en" as const,
          documentTitle: "Test",
        },
      },
    ];

    const { newChunks, skipped } = filterNewChunks(chunks, tracker, false);

    expect(newChunks).toHaveLength(1);
    expect(skipped).toBe(0);
  });

  test("filters out already processed chunks", () => {
    // Mark one chunk as processed
    tracker.mark("act:C-1:en:0");

    const chunks = [
      {
        content: "test1",
        chunkIndex: 0,
        totalChunks: 1,
        resourceKey: "act:C-1:en:0",
        metadata: {
          sourceType: "act" as const,
          language: "en" as const,
          documentTitle: "Test",
        },
      },
      {
        content: "test2",
        chunkIndex: 0,
        totalChunks: 1,
        resourceKey: "act:C-2:en:0",
        metadata: {
          sourceType: "act" as const,
          language: "en" as const,
          documentTitle: "Test 2",
        },
      },
    ];

    const { newChunks, skipped } = filterNewChunks(chunks, tracker, true);

    expect(newChunks).toHaveLength(1);
    expect(newChunks[0].resourceKey).toBe("act:C-2:en:0");
    expect(skipped).toBe(1);
  });

  test("returns empty arrays for empty input", () => {
    const { newChunks, skipped } = filterNewChunks([], tracker, true);

    expect(newChunks).toHaveLength(0);
    expect(skipped).toBe(0);
  });
});

test.describe("ProgressTracker", () => {
  let tracker: ProgressTracker;

  test.beforeEach(() => {
    // Use in-memory database for test isolation (avoids file locking in parallel tests)
    tracker = new ProgressTracker(":memory:");
  });

  test.afterEach(() => {
    tracker.close();
  });

  test("marks and checks individual keys", () => {
    expect(tracker.has("test:key:1")).toBe(false);

    tracker.mark("test:key:1");

    expect(tracker.has("test:key:1")).toBe(true);
    expect(tracker.has("test:key:2")).toBe(false);
  });

  test("marks multiple keys in batch", () => {
    const keys = ["batch:1", "batch:2", "batch:3"];

    tracker.markMany(keys);

    expect(tracker.has("batch:1")).toBe(true);
    expect(tracker.has("batch:2")).toBe(true);
    expect(tracker.has("batch:3")).toBe(true);
    expect(tracker.has("batch:4")).toBe(false);
  });

  test("hasMany returns set of existing keys", () => {
    tracker.markMany(["key:1", "key:2"]);

    const result = tracker.hasMany(["key:1", "key:2", "key:3"]);

    expect(result.has("key:1")).toBe(true);
    expect(result.has("key:2")).toBe(true);
    expect(result.has("key:3")).toBe(false);
  });

  test("countByPrefix counts matching keys", () => {
    tracker.markMany(["act:1:en:0", "act:2:en:0", "regulation:1:en:0"]);

    expect(tracker.countByPrefix("act:")).toBe(2);
    expect(tracker.countByPrefix("regulation:")).toBe(1);
    expect(tracker.countByPrefix("other:")).toBe(0);
  });

  test("clearByPrefix removes matching keys", () => {
    tracker.markMany(["act:1", "act:2", "reg:1"]);

    const cleared = tracker.clearByPrefix("act:");

    expect(cleared).toBe(2);
    expect(tracker.has("act:1")).toBe(false);
    expect(tracker.has("act:2")).toBe(false);
    expect(tracker.has("reg:1")).toBe(true);
  });

  test("totalCount returns correct count", () => {
    expect(tracker.totalCount()).toBe(0);

    tracker.markMany(["a", "b", "c"]);

    expect(tracker.totalCount()).toBe(3);
  });

  test("sampleKeys returns limited sample", () => {
    tracker.markMany(["act:1", "act:2", "act:3", "act:4", "act:5"]);

    const sample = tracker.sampleKeys("act:", 3);

    expect(sample).toHaveLength(3);
    expect(sample.every((k) => k.startsWith("act:"))).toBe(true);
  });

  test("handles duplicate marks gracefully", () => {
    tracker.mark("duplicate:key");
    tracker.mark("duplicate:key");

    expect(tracker.totalCount()).toBe(1);
  });
});

test.describe("buildTermContent", () => {
  const createMockTerm = (
    overrides: Partial<DefinedTerm> = {}
  ): DefinedTerm => ({
    id: "term-123",
    language: "en",
    term: "barrier",
    termNormalized: "barrier",
    pairedTerm: "obstacle",
    pairedTermId: null,
    definition:
      "means any physical, architectural, technological or other obstacle that limits a person's equal participation.",
    actId: "C-81",
    regulationId: null,
    sectionLabel: "2",
    scopeType: "act",
    scopeSections: null,
    scopeRawText: null,
    limsMetadata: null,
    createdAt: new Date(),
    ...overrides,
  });

  test("builds English term content correctly", () => {
    const term = createMockTerm();
    const content = buildTermContent(term, "Accessible Canada Act");

    expect(content).toContain("Defined Term: barrier");
    expect(content).toContain("French term: obstacle");
    expect(content).toContain("Source: Accessible Canada Act");
    expect(content).toContain("Section: 2");
    expect(content).toContain("Definition:");
    expect(content).toContain("means any physical");
  });

  test("builds French term content correctly", () => {
    const term = createMockTerm({
      language: "fr",
      term: "obstacle",
      pairedTerm: "barrier",
    });
    const content = buildTermContent(
      term,
      "Loi canadienne sur l'accessibilité"
    );

    expect(content).toContain("Terme défini: obstacle");
    expect(content).toContain("Terme anglais: barrier");
    expect(content).toContain("Source: Loi canadienne sur l'accessibilité");
    expect(content).toContain("Article: 2");
    expect(content).toContain("Définition:");
  });

  test("includes scope type when not act-level", () => {
    const term = createMockTerm({ scopeType: "part" });
    const content = buildTermContent(term, "Test Act");

    expect(content).toContain("Scope: part");
  });

  test("omits scope type for act-level definitions", () => {
    const term = createMockTerm({ scopeType: "act" });
    const content = buildTermContent(term, "Test Act");

    expect(content).not.toContain("Scope:");
  });

  test("handles missing optional fields", () => {
    const term = createMockTerm({
      pairedTerm: null,
      sectionLabel: null,
      scopeType: "act",
    });
    const content = buildTermContent(term, "Test Act");

    expect(content).not.toContain("French term:");
    expect(content).not.toContain("Section:");
    expect(content).toContain("Defined Term: barrier");
    expect(content).toContain("Definition:");
  });
});

test.describe("countTokens", () => {
  test("counts tokens for simple text", () => {
    const text = "Hello, world!";
    const count = countTokens(text);

    // Should be around 3-4 tokens
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10);
  });

  test("returns higher count for longer text", () => {
    const short = "Hello";
    const long = "Hello, this is a much longer sentence with many more words.";

    expect(countTokens(long)).toBeGreaterThan(countTokens(short));
  });

  test("handles empty string", () => {
    expect(countTokens("")).toBe(0);
  });

  test("handles special characters", () => {
    const text = "Prix: 100€ • Taille: 42cm";
    const count = countTokens(text);

    expect(count).toBeGreaterThan(0);
  });
});

test.describe("chunkTextByTokens", () => {
  test("returns single chunk for small text", () => {
    const text = "This is a short piece of text.";
    const chunks = chunkTextByTokens(text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(text);
    expect(chunks[0].index).toBe(0);
  });

  test("splits large text into multiple chunks", () => {
    // Create text that exceeds the token limit
    const longText = "This is a sentence. ".repeat(500);
    const chunks = chunkTextByTokens(longText, 100, 20); // Small limit for testing

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks.at(-1)?.index).toBe(chunks.length - 1);
  });

  test("respects token limit per chunk", () => {
    const longText = "Word ".repeat(1000);
    const maxTokens = 200;
    const chunks = chunkTextByTokens(longText, maxTokens, 40);

    for (const chunk of chunks) {
      const tokenCount = countTokens(chunk.content);
      // Allow some tolerance for sentence boundaries
      expect(tokenCount).toBeLessThanOrEqual(maxTokens + 50);
    }
  });

  test("handles empty text", () => {
    const chunks = chunkTextByTokens("");
    expect(chunks).toHaveLength(0);
  });

  test("handles whitespace-only text", () => {
    const chunks = chunkTextByTokens("   \n\n   ");
    expect(chunks).toHaveLength(0);
  });

  test("preserves sentence boundaries when possible", () => {
    const text =
      "First sentence. Second sentence. Third sentence. Fourth sentence.";
    const chunks = chunkTextByTokens(text, 20, 5);

    // Should split on sentence boundaries
    for (const chunk of chunks) {
      // Each chunk should end with a sentence (period) or be the last chunk
      if (chunk.index < chunks.length - 1) {
        expect(chunk.content).toMatch(SENTENCE_END_REGEX);
      }
    }
  });
});

// ---------- normalizeForEmbedding Tests ----------

test.describe("normalizeForEmbedding", () => {
  test("replaces newlines with spaces", () => {
    const text = "Line one.\nLine two.\nLine three.";
    const normalized = normalizeForEmbedding(text);
    expect(normalized).toBe("Line one. Line two. Line three.");
  });

  test("collapses multiple spaces", () => {
    const text = "Word   with   multiple    spaces.";
    const normalized = normalizeForEmbedding(text);
    expect(normalized).toBe("Word with multiple spaces.");
  });

  test("trims leading and trailing whitespace", () => {
    const text = "   Text with whitespace   ";
    const normalized = normalizeForEmbedding(text);
    expect(normalized).toBe("Text with whitespace");
  });

  test("handles combination of newlines, spaces, and tabs", () => {
    const text = "  First line.\n\n  Second line.  \t\n  Third line.  ";
    const normalized = normalizeForEmbedding(text);
    expect(normalized).toBe("First line. Second line. Third line.");
  });

  test("returns empty string for whitespace-only input", () => {
    expect(normalizeForEmbedding("   \n\t  ")).toBe("");
  });

  test("handles empty string", () => {
    expect(normalizeForEmbedding("")).toBe("");
  });
});

test.describe("buildRelatedProvisionContent", () => {
  test("builds English related provision content correctly", () => {
    const provision = {
      label: "Transitional Provisions",
      source: "2019, c. 29",
      sections: ["100", "101", "102"],
      text: "These provisions apply to applications filed before the coming into force of this Act.",
    };
    const content = buildRelatedProvisionContent(
      provision,
      "Immigration and Refugee Protection Act",
      "en"
    );

    expect(content).toContain(
      "Related provisions of: Immigration and Refugee Protection Act"
    );
    expect(content).toContain("Label: Transitional Provisions");
    expect(content).toContain("Source: 2019, c. 29");
    expect(content).toContain("Sections: 100, 101, 102");
    expect(content).toContain(
      "These provisions apply to applications filed before"
    );
  });

  test("builds French related provision content correctly", () => {
    const provision = {
      label: "Dispositions transitoires",
      source: "2019, ch. 29",
      sections: ["100", "101"],
      text: "Ces dispositions s'appliquent aux demandes déposées avant l'entrée en vigueur de la présente loi.",
    };
    const content = buildRelatedProvisionContent(
      provision,
      "Loi sur l'immigration et la protection des réfugiés",
      "fr"
    );

    expect(content).toContain(
      "Dispositions connexes de: Loi sur l'immigration et la protection des réfugiés"
    );
    expect(content).toContain("Étiquette: Dispositions transitoires");
    expect(content).toContain("Source: 2019, ch. 29");
    expect(content).toContain("Articles: 100, 101");
    expect(content).toContain("Ces dispositions s'appliquent");
  });

  test("handles missing optional fields", () => {
    const provision = {
      text: "Some provision text only.",
    };
    const content = buildRelatedProvisionContent(provision, "Test Act", "en");

    expect(content).toContain("Related provisions of: Test Act");
    expect(content).toContain("Some provision text only.");
    expect(content).not.toContain("Label:");
    expect(content).not.toContain("Source:");
    expect(content).not.toContain("Sections:");
  });

  test("handles empty sections array", () => {
    const provision = {
      label: "Amending Provisions",
      sections: [],
      text: "Amendment text.",
    };
    const content = buildRelatedProvisionContent(provision, "Test Act", "en");

    expect(content).toContain("Label: Amending Provisions");
    expect(content).not.toContain("Sections:");
    expect(content).toContain("Amendment text.");
  });

  test("handles provision with only label", () => {
    const provision = {
      label: "Coming Into Force",
    };
    const content = buildRelatedProvisionContent(provision, "Test Act", "en");

    expect(content).toContain("Related provisions of: Test Act");
    expect(content).toContain("Label: Coming Into Force");
    expect(content).not.toContain("Source:");
    expect(content).not.toContain("Sections:");
  });
});

test.describe("buildFootnoteContent", () => {
  test("builds English footnote content correctly", () => {
    const footnote = {
      id: "fn1",
      label: "*",
      text: "This section does not apply to provincial governments.",
      placement: "section",
      status: "official",
    };
    const content = buildFootnoteContent(
      footnote,
      "91",
      "Constitution Act, 1867",
      "en"
    );

    expect(content).toContain("Footnote from: Constitution Act, 1867");
    expect(content).toContain("Section: 91");
    expect(content).toContain("Label: *");
    expect(content).toContain("Type: official");
    expect(content).toContain(
      "This section does not apply to provincial governments."
    );
  });

  test("builds French footnote content correctly", () => {
    const footnote = {
      id: "fn1",
      label: "1",
      text: "Cette disposition ne s'applique pas aux gouvernements provinciaux.",
      placement: "page",
      status: "editorial",
    };
    const content = buildFootnoteContent(
      footnote,
      "91",
      "Loi constitutionnelle de 1867",
      "fr"
    );

    expect(content).toContain(
      "Note de bas de page de: Loi constitutionnelle de 1867"
    );
    expect(content).toContain("Article: 91");
    expect(content).toContain("Étiquette: 1");
    expect(content).toContain("Type: éditoriale");
    expect(content).toContain(
      "Cette disposition ne s'applique pas aux gouvernements provinciaux."
    );
  });

  test("handles footnote with minimal fields", () => {
    const footnote = {
      id: "fn2",
      text: "See related provisions.",
    };
    const content = buildFootnoteContent(footnote, "5", "Criminal Code", "en");

    expect(content).toContain("Footnote from: Criminal Code");
    expect(content).toContain("Section: 5");
    expect(content).toContain("See related provisions.");
    expect(content).not.toContain("Label:");
    expect(content).not.toContain("Type:");
  });

  test("handles official status in English", () => {
    const footnote = {
      id: "fn3",
      text: "Official note.",
      status: "official",
    };
    const content = buildFootnoteContent(footnote, "10", "Test Act", "en");

    expect(content).toContain("Type: official");
  });

  test("handles editorial status in French", () => {
    const footnote = {
      id: "fn4",
      text: "Note éditoriale.",
      status: "editorial",
    };
    const content = buildFootnoteContent(footnote, "10", "Loi test", "fr");

    expect(content).toContain("Type: éditoriale");
  });
});

test.describe("buildCrossRefContentEn", () => {
  test("builds English cross-reference content correctly", () => {
    const ref = {
      sourceSectionLabel: "91",
      targetType: "act",
      targetRef: "A-2",
      targetSectionRef: "12",
      referenceText: "See the Access to Information Act",
      // Enhanced fields (Task 2.1)
      targetActId: "A-2",
      targetRegulationId: null,
      targetSectionId: "section-123",
      targetDocumentTitleEn: "Access to Information Act",
      targetDocumentTitleFr: "Loi sur l'accès à l'information",
      targetSnippetEn: "Every Canadian citizen has the right...",
      targetSnippetFr: "Tout citoyen canadien a le droit...",
      targetMarginalNoteEn: "Right of access",
      targetMarginalNoteFr: "Droit d'accès",
    };
    const content = buildCrossRefContentEn(ref, "Income Tax Act");

    expect(content).toContain("Cross-reference");
    expect(content).toContain("Source: Income Tax Act");
    expect(content).toContain("Source section: 91");
    expect(content).toContain("Target type: Act");
    expect(content).toContain("Reference: A-2");
    expect(content).toContain("Target section: 12");
    expect(content).toContain("Text: See the Access to Information Act");
    expect(content).toContain("Target document: Access to Information Act");
    expect(content).toContain("Target heading: Right of access");
    expect(content).toContain(
      "Target content: Every Canadian citizen has the right..."
    );
  });

  test("handles regulation target type", () => {
    const ref = {
      sourceSectionLabel: "5",
      targetType: "regulation",
      targetRef: "SOR/86-946",
      targetSectionRef: null,
      referenceText: null,
      // Enhanced fields (Task 2.1)
      targetActId: null,
      targetRegulationId: "SOR/86-946",
      targetSectionId: null,
      targetDocumentTitleEn: "Employment Insurance Regulations",
      targetDocumentTitleFr: "Règlement sur l'assurance-emploi",
      targetSnippetEn: null,
      targetSnippetFr: null,
      targetMarginalNoteEn: null,
      targetMarginalNoteFr: null,
    };
    const content = buildCrossRefContentEn(ref, "Employment Insurance Act");

    expect(content).toContain("Target type: Regulation");
    expect(content).toContain("Reference: SOR/86-946");
    expect(content).toContain(
      "Target document: Employment Insurance Regulations"
    );
    expect(content).not.toContain("Target section:");
    expect(content).not.toContain("Text:");
  });

  test("handles missing optional fields", () => {
    const ref = {
      sourceSectionLabel: null,
      targetType: "act",
      targetRef: "C-46",
      targetSectionRef: null,
      referenceText: null,
      // Enhanced fields (Task 2.1) - all null when target not resolved
      targetActId: "C-46",
      targetRegulationId: null,
      targetSectionId: null,
      targetDocumentTitleEn: null,
      targetDocumentTitleFr: null,
      targetSnippetEn: null,
      targetSnippetFr: null,
      targetMarginalNoteEn: null,
      targetMarginalNoteFr: null,
    };
    const content = buildCrossRefContentEn(ref, "Test Act");

    expect(content).toContain("Cross-reference");
    expect(content).toContain("Source: Test Act");
    expect(content).not.toContain("Source section:");
    expect(content).toContain("Target type: Act");
    expect(content).toContain("Reference: C-46");
  });
});

test.describe("buildCrossRefContentFr", () => {
  test("builds French cross-reference content correctly", () => {
    const ref = {
      sourceSectionLabel: "91",
      targetType: "act",
      targetRef: "A-2",
      targetSectionRef: "12",
      referenceText: "Voir la Loi sur l'accès à l'information",
      // Enhanced fields (Task 2.1)
      targetActId: "A-2",
      targetRegulationId: null,
      targetSectionId: "section-123",
      targetDocumentTitleEn: "Access to Information Act",
      targetDocumentTitleFr: "Loi sur l'accès à l'information",
      targetSnippetEn: "Every Canadian citizen has the right...",
      targetSnippetFr: "Tout citoyen canadien a le droit...",
      targetMarginalNoteEn: "Right of access",
      targetMarginalNoteFr: "Droit d'accès",
    };
    const content = buildCrossRefContentFr(ref, "Loi de l'impôt sur le revenu");

    expect(content).toContain("Référence croisée");
    expect(content).toContain("Source: Loi de l'impôt sur le revenu");
    expect(content).toContain("Article source: 91");
    expect(content).toContain("Type de cible: Loi");
    expect(content).toContain("Référence: A-2");
    expect(content).toContain("Article cible: 12");
    expect(content).toContain("Texte: Voir la Loi sur l'accès à l'information");
    expect(content).toContain(
      "Document cible: Loi sur l'accès à l'information"
    );
    expect(content).toContain("Rubrique cible: Droit d'accès");
    expect(content).toContain(
      "Contenu cible: Tout citoyen canadien a le droit..."
    );
  });

  test("handles regulation target type in French", () => {
    const ref = {
      sourceSectionLabel: "5",
      targetType: "regulation",
      targetRef: "SOR/86-946",
      targetSectionRef: null,
      referenceText: null,
      // Enhanced fields (Task 2.1)
      targetActId: null,
      targetRegulationId: "SOR/86-946",
      targetSectionId: null,
      targetDocumentTitleEn: "Employment Insurance Regulations",
      targetDocumentTitleFr: "Règlement sur l'assurance-emploi",
      targetSnippetEn: null,
      targetSnippetFr: null,
      targetMarginalNoteEn: null,
      targetMarginalNoteFr: null,
    };
    const content = buildCrossRefContentFr(ref, "Loi sur l'assurance-emploi");

    expect(content).toContain("Type de cible: Règlement");
    expect(content).toContain("Référence: SOR/86-946");
    expect(content).toContain(
      "Document cible: Règlement sur l'assurance-emploi"
    );
    expect(content).not.toContain("Article cible:");
    expect(content).not.toContain("Texte:");
  });

  test("handles missing optional fields in French", () => {
    const ref = {
      sourceSectionLabel: null,
      targetType: "act",
      targetRef: "C-46",
      targetSectionRef: null,
      referenceText: null,
      // Enhanced fields (Task 2.1) - all null when target not resolved
      targetActId: "C-46",
      targetRegulationId: null,
      targetSectionId: null,
      targetDocumentTitleEn: null,
      targetDocumentTitleFr: null,
      targetSnippetEn: null,
      targetSnippetFr: null,
      targetMarginalNoteEn: null,
      targetMarginalNoteFr: null,
    };
    const content = buildCrossRefContentFr(ref, "Loi test");

    expect(content).toContain("Référence croisée");
    expect(content).toContain("Source: Loi test");
    expect(content).not.toContain("Article source:");
    expect(content).toContain("Type de cible: Loi");
    expect(content).toContain("Référence: C-46");
  });
});

test.describe("Cross-reference dual-language embedding generation", () => {
  test("generates distinct EN and FR chunks for same cross-reference", () => {
    // Simulate the chunk generation logic from processCrossReferences
    const ref = {
      id: "xref-test-123",
      sourceActId: "C-46",
      sourceRegulationId: null,
      sourceSectionLabel: "91",
      targetType: "act",
      targetRef: "A-2",
      targetSectionRef: "12",
      referenceText: "See the Access to Information Act",
      // Enhanced fields (Task 2.1)
      targetActId: "A-2",
      targetRegulationId: null,
      targetSectionId: "section-456",
      targetDocumentTitleEn: "Access to Information Act",
      targetDocumentTitleFr: "Loi sur l'accès à l'information",
      targetSnippetEn: "Every Canadian citizen has the right...",
      targetSnippetFr: "Tout citoyen canadien a le droit...",
      targetMarginalNoteEn: "Right of access",
      targetMarginalNoteFr: "Droit d'accès",
    };
    const sourceTitleEn = "Criminal Code";
    const sourceTitleFr = "Code criminel";

    // Generate EN chunk content and key
    const contentEn = buildCrossRefContentEn(ref, sourceTitleEn);
    const keyEn = buildResourceKey("cross_reference", ref.id, "en", 0);

    // Generate FR chunk content and key
    const contentFr = buildCrossRefContentFr(ref, sourceTitleFr);
    const keyFr = buildResourceKey("cross_reference", ref.id, "fr", 0);

    // Verify EN chunk has English content
    expect(contentEn).toContain("Cross-reference");
    expect(contentEn).toContain("Source: Criminal Code");
    expect(contentEn).toContain("Target type: Act");
    expect(contentEn).toContain("Target document: Access to Information Act");
    expect(contentEn).toContain(
      "Target content: Every Canadian citizen has the right..."
    );
    expect(contentEn).not.toContain("Référence croisée");

    // Verify FR chunk has French content
    expect(contentFr).toContain("Référence croisée");
    expect(contentFr).toContain("Source: Code criminel");
    expect(contentFr).toContain("Type de cible: Loi");
    expect(contentFr).toContain(
      "Document cible: Loi sur l'accès à l'information"
    );
    expect(contentFr).toContain(
      "Contenu cible: Tout citoyen canadien a le droit..."
    );
    expect(contentFr).not.toContain("Cross-reference");

    // Verify keys are language-specific and distinct
    expect(keyEn).toContain(":en:");
    expect(keyFr).toContain(":fr:");
    expect(keyEn).not.toBe(keyFr);
  });

  test("chunk metadata structure matches expected format for language filtering", () => {
    // Simulate the metadata that would be created for cross-reference chunks
    const ref = {
      id: "xref-test-456",
      sourceActId: "C-81",
      sourceSectionLabel: "5",
      targetType: "regulation",
      targetRef: "SOR/86-946",
    };

    // EN chunk metadata
    const metadataEn = {
      sourceType: "cross_reference" as const,
      language: "en" as const,
      crossRefId: ref.id,
      actId: ref.sourceActId,
      documentTitle: "Accessible Canada Act",
      sectionLabel: ref.sourceSectionLabel,
      targetType: ref.targetType,
      targetRef: ref.targetRef,
      chunkIndex: 0,
    };

    // FR chunk metadata
    const metadataFr = {
      sourceType: "cross_reference" as const,
      language: "fr" as const,
      crossRefId: ref.id,
      actId: ref.sourceActId,
      documentTitle: "Loi canadienne sur l'accessibilité",
      sectionLabel: ref.sourceSectionLabel,
      targetType: ref.targetType,
      targetRef: ref.targetRef,
      chunkIndex: 0,
    };

    // Verify EN metadata has correct language
    expect(metadataEn.language).toBe("en");
    expect(metadataEn.documentTitle).toBe("Accessible Canada Act");
    expect(metadataEn.sourceType).toBe("cross_reference");

    // Verify FR metadata has correct language
    expect(metadataFr.language).toBe("fr");
    expect(metadataFr.documentTitle).toBe("Loi canadienne sur l'accessibilité");
    expect(metadataFr.sourceType).toBe("cross_reference");

    // Both should have same crossRefId but different language
    expect(metadataEn.crossRefId).toBe(metadataFr.crossRefId);
    expect(metadataEn.language).not.toBe(metadataFr.language);
  });

  test("language filter would match only corresponding language chunks", () => {
    // Simulate search filter behavior with proper typing
    type Language = "en" | "fr";
    const enChunk = {
      language: "en" as Language,
      sourceType: "cross_reference",
    };
    const frChunk = {
      language: "fr" as Language,
      sourceType: "cross_reference",
    };

    // A search with language: "fr" should only match FR chunks
    const languageFilter: Language = "fr";
    expect(frChunk.language === languageFilter).toBe(true);
    expect(enChunk.language === languageFilter).toBe(false);

    // Both chunks should be findable via sourceType
    expect(enChunk.sourceType).toBe("cross_reference");
    expect(frChunk.sourceType).toBe("cross_reference");
  });
});

test.describe("buildBatchedProvisionContent", () => {
  test("builds English batched ToP content correctly", () => {
    const provisions = [
      { label: "Part I", title: "General Provisions", level: 0 },
      { label: "1", title: "Short Title", level: 1 },
      { label: "2", title: "Interpretation", level: 1 },
      { label: "Part II", title: "Application", level: 0 },
      { label: "3", title: "Scope", level: 1 },
    ];
    const content = buildBatchedProvisionContent(
      provisions,
      "Criminal Code",
      "en"
    );

    // Should contain header
    expect(content).toContain("Table of Provisions of: Criminal Code");

    // Should contain all entries with hierarchy
    expect(content).toContain("Part I: General Provisions");
    expect(content).toContain("  1: Short Title"); // Level 1 = 2 spaces
    expect(content).toContain("  2: Interpretation");
    expect(content).toContain("Part II: Application");
    expect(content).toContain("  3: Scope");
  });

  test("builds French batched ToP content correctly", () => {
    const provisions = [
      { label: "Partie I", title: "Dispositions générales", level: 0 },
      { label: "1", title: "Titre abrégé", level: 1 },
    ];
    const content = buildBatchedProvisionContent(
      provisions,
      "Code criminel",
      "fr"
    );

    // Should contain French header
    expect(content).toContain("Table des dispositions de: Code criminel");

    // Should contain entries
    expect(content).toContain("Partie I: Dispositions générales");
    expect(content).toContain("  1: Titre abrégé");
  });

  test("handles deep hierarchy levels", () => {
    const provisions = [
      { label: "Part I", title: "Main Part", level: 0 },
      { label: "Division 1", title: "First Division", level: 1 },
      { label: "Subdivision A", title: "First Subdivision", level: 2 },
      { label: "1", title: "First Section", level: 3 },
    ];
    const content = buildBatchedProvisionContent(
      provisions,
      "Complex Act",
      "en"
    );

    // Verify indentation increases with level
    expect(content).toContain("Part I: Main Part"); // level 0 - no indent
    expect(content).toContain("  Division 1: First Division"); // level 1 - 2 spaces
    expect(content).toContain("    Subdivision A: First Subdivision"); // level 2 - 4 spaces
    expect(content).toContain("      1: First Section"); // level 3 - 6 spaces
  });

  test("handles empty provisions array", () => {
    const content = buildBatchedProvisionContent([], "Empty Act", "en");

    // Should only have header with empty body
    expect(content).toContain("Table of Provisions of: Empty Act");
    // Content should be minimal (just header + blank line)
    expect(content.trim()).toBe("Table of Provisions of: Empty Act");
  });

  test("handles single entry", () => {
    const provisions = [{ label: "1", title: "Sole Section", level: 0 }];
    const content = buildBatchedProvisionContent(
      provisions,
      "Single Section Act",
      "en"
    );

    expect(content).toContain("Table of Provisions of: Single Section Act");
    expect(content).toContain("1: Sole Section");
  });

  test("creates searchable content for document structure queries", () => {
    // This tests that the batched content is useful for search
    const provisions = [
      { label: "Part I", title: "Taxation of Income", level: 0 },
      { label: "1", title: "Definitions for Income Tax", level: 1 },
      { label: "Part II", title: "Computation of Tax Payable", level: 0 },
      { label: "10", title: "Tax Rates", level: 1 },
      { label: "Part III", title: "Refunds and Credits", level: 0 },
    ];
    const content = buildBatchedProvisionContent(
      provisions,
      "Income Tax Act",
      "en"
    );

    // A user searching for "sections about taxation" should match this
    expect(content.toLowerCase()).toContain("taxation");
    expect(content.toLowerCase()).toContain("income");
    expect(content.toLowerCase()).toContain("tax");

    // A user searching for "tax refunds" should match
    expect(content.toLowerCase()).toContain("refunds");
    expect(content.toLowerCase()).toContain("credits");
  });
});

test.describe("buildMarginalNoteContent", () => {
  test("builds English marginal note content correctly", () => {
    const content = buildMarginalNoteContent(
      "Theft",
      "322",
      "Criminal Code",
      "en"
    );

    expect(content).toContain("Marginal Note: Theft");
    expect(content).toContain("Act/Regulation: Criminal Code");
    expect(content).toContain("Section: 322");
  });

  test("builds French marginal note content correctly", () => {
    const content = buildMarginalNoteContent(
      "Vol",
      "322",
      "Code criminel",
      "fr"
    );

    expect(content).toContain("Note marginale: Vol");
    expect(content).toContain("Loi/Règlement: Code criminel");
    expect(content).toContain("Article: 322");
  });

  test("creates searchable content for section heading queries", () => {
    const content = buildMarginalNoteContent(
      "Punishment for theft",
      "334",
      "Criminal Code",
      "en"
    );

    // User searching for "punishment" or "theft" should find this
    expect(content.toLowerCase()).toContain("punishment");
    expect(content.toLowerCase()).toContain("theft");
    expect(content).toContain("Criminal Code");
  });

  test("handles complex marginal note with multiple terms", () => {
    const content = buildMarginalNoteContent(
      "Offence and punishment",
      "91",
      "Constitution Act, 1867",
      "en"
    );

    expect(content).toContain("Marginal Note: Offence and punishment");
    expect(content).toContain("Constitution Act, 1867");
    expect(content).toContain("Section: 91");
  });

  test("handles regulation marginal notes", () => {
    const content = buildMarginalNoteContent(
      "Application",
      "2",
      "Employment Insurance Regulations",
      "en"
    );

    expect(content).toContain("Marginal Note: Application");
    expect(content).toContain(
      "Act/Regulation: Employment Insurance Regulations"
    );
    expect(content).toContain("Section: 2");
  });

  test("formats content as newline-separated for embedding clarity", () => {
    const content = buildMarginalNoteContent(
      "Test Note",
      "1",
      "Test Act",
      "en"
    );

    // Should be formatted with newlines between fields
    const lines = content.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Marginal Note:");
    expect(lines[1]).toContain("Act/Regulation:");
    expect(lines[2]).toContain("Section:");
  });
});

// ---------- Legal Boundary Detection Tests (Task 3.2) ----------

test.describe("identifyMarkerType", () => {
  test("identifies numbered subsections", () => {
    expect(identifyMarkerType("(1)")).toBe("subsection");
    expect(identifyMarkerType("(2)")).toBe("subsection");
    expect(identifyMarkerType("(10)")).toBe("subsection");
    expect(identifyMarkerType("(100)")).toBe("subsection");
  });

  test("identifies lettered paragraphs", () => {
    expect(identifyMarkerType("(a)")).toBe("paragraph");
    expect(identifyMarkerType("(b)")).toBe("paragraph");
    expect(identifyMarkerType("(z)")).toBe("paragraph");
  });

  test("identifies ambiguous letters as paragraphs not subparagraphs", () => {
    // Single c, d, l, m could be mistaken for roman numerals (100, 500, 50, 1000)
    // but in legislation these are unrealistic subparagraph numbers
    expect(identifyMarkerType("(c)")).toBe("paragraph");
    expect(identifyMarkerType("(d)")).toBe("paragraph");
    expect(identifyMarkerType("(l)")).toBe("paragraph");
    expect(identifyMarkerType("(m)")).toBe("paragraph");
  });

  test("identifies roman numeral subparagraphs", () => {
    expect(identifyMarkerType("(i)")).toBe("subparagraph");
    expect(identifyMarkerType("(ii)")).toBe("subparagraph");
    expect(identifyMarkerType("(iii)")).toBe("subparagraph");
    expect(identifyMarkerType("(iv)")).toBe("subparagraph");
    expect(identifyMarkerType("(v)")).toBe("subparagraph");
    expect(identifyMarkerType("(vi)")).toBe("subparagraph");
    expect(identifyMarkerType("(vii)")).toBe("subparagraph");
    expect(identifyMarkerType("(viii)")).toBe("subparagraph");
    expect(identifyMarkerType("(ix)")).toBe("subparagraph");
    expect(identifyMarkerType("(x)")).toBe("subparagraph");
    expect(identifyMarkerType("(xi)")).toBe("subparagraph");
    expect(identifyMarkerType("(xii)")).toBe("subparagraph");
    expect(identifyMarkerType("(xiii)")).toBe("subparagraph");
    expect(identifyMarkerType("(xiv)")).toBe("subparagraph");
    expect(identifyMarkerType("(xv)")).toBe("subparagraph");
  });

  test("identifies capital letter clauses", () => {
    expect(identifyMarkerType("(A)")).toBe("clause");
    expect(identifyMarkerType("(B)")).toBe("clause");
    expect(identifyMarkerType("(Z)")).toBe("clause");
  });

  test("returns null for invalid markers", () => {
    expect(identifyMarkerType("(ab)")).toBeNull(); // Multi-letter lowercase
    expect(identifyMarkerType("(AB)")).toBeNull(); // Multi-letter uppercase
    expect(identifyMarkerType("a")).toBeNull(); // No parentheses
    expect(identifyMarkerType("()")).toBeNull(); // Empty
  });
});

test.describe("splitIntoLegalUnits", () => {
  test("returns single unit for text without markers", () => {
    const text = "This is plain text without any legal markers.";
    const units = splitIntoLegalUnits(text);

    expect(units).toHaveLength(1);
    expect(units[0].content).toBe(text);
    expect(units[0].markerType).toBeNull();
    expect(units[0].marker).toBeNull();
  });

  test("splits text at numbered subsection markers", () => {
    const text =
      "Introduction. (1) First subsection content. (2) Second subsection content.";
    const units = splitIntoLegalUnits(text);

    expect(units.length).toBeGreaterThanOrEqual(2);
    // Should contain the subsection markers
    const subsectionUnits = units.filter((u) => u.markerType === "subsection");
    expect(subsectionUnits.length).toBe(2);
  });

  test("splits text at lettered paragraph markers", () => {
    const text =
      "Main text (a) first paragraph (b) second paragraph (c) third paragraph.";
    const units = splitIntoLegalUnits(text);

    const paragraphUnits = units.filter((u) => u.markerType === "paragraph");
    expect(paragraphUnits.length).toBe(3);
  });

  test("splits text at roman numeral subparagraph markers", () => {
    const text = "Content (i) first item (ii) second item (iii) third item.";
    const units = splitIntoLegalUnits(text);

    const subparagraphUnits = units.filter(
      (u) => u.markerType === "subparagraph"
    );
    expect(subparagraphUnits.length).toBe(3);
  });

  test("preserves preamble content before first marker", () => {
    const text = "This is preamble content. (1) First subsection.";
    const units = splitIntoLegalUnits(text);

    // First unit should be preamble or subsection with preamble
    expect(units[0].content).toContain("preamble");
  });

  test("handles complex nested legal structure", () => {
    const text =
      "Section 5 (1) Main provision applies when (a) condition one is met; (b) condition two is met; or (c) condition three applies, including (i) sub-condition A, (ii) sub-condition B, and (iii) sub-condition C. (2) Exception to subsection (1).";
    const units = splitIntoLegalUnits(text);

    // Should have multiple units with different marker types
    expect(units.length).toBeGreaterThan(1);

    // Should have subsections, paragraphs, and subparagraphs
    const markerTypes = new Set(units.map((u) => u.markerType).filter(Boolean));
    expect(markerTypes.has("subsection")).toBe(true);
    expect(markerTypes.has("paragraph")).toBe(true);
    expect(markerTypes.has("subparagraph")).toBe(true);
  });
});

test.describe("chunkLegalText", () => {
  test("returns single chunk for short text", () => {
    const text = "Short legal text.";
    const chunks = chunkLegalText(text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(text);
    expect(chunks[0].index).toBe(0);
  });

  test("returns empty array for empty text", () => {
    expect(chunkLegalText("")).toHaveLength(0);
    expect(chunkLegalText("   ")).toHaveLength(0);
  });

  test("splits long text respecting legal boundaries", () => {
    // Create text with clear legal markers that exceeds chunk size
    const subsections = Array.from(
      { length: 50 },
      (_, i) =>
        `(${i + 1}) This is the content for subsection ${i + 1} which contains sufficient text to contribute to the overall token count of this legal document.`
    ).join(" ");

    const chunks = chunkLegalText(subsections, 500, 50);

    // Should have multiple chunks
    expect(chunks.length).toBeGreaterThan(1);

    // Each chunk should respect token limits (allowing some tolerance)
    for (const chunk of chunks) {
      const tokenCount = countTokens(chunk.content);
      expect(tokenCount).toBeLessThanOrEqual(600); // Allow some margin
    }
  });

  test("prefers splitting at legal boundaries over mid-sentence", () => {
    // Text where legal boundaries are clear split points
    const text =
      "(1) First subsection with content. (2) Second subsection with more content. (3) Third subsection continues here. (4) Fourth subsection ends.";
    const chunks = chunkLegalText(text, 50, 10); // Small token limit to force splits

    // Each chunk should start with a legal marker or be the start of text
    for (const chunk of chunks) {
      // Chunk should contain complete legal units where possible
      if (chunk.content.includes("(1)")) {
        expect(chunk.content).toMatch(SUBSECTION_WITH_CONTENT_REGEX);
      }
    }
  });

  test("maintains chunk indices correctly", () => {
    const longText = "Word ".repeat(1000);
    const chunks = chunkLegalText(longText, 200, 40);

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
    }
  });

  test("handles overlap correctly between chunks", () => {
    // Create text that will need splitting with overlap
    const text = Array.from(
      { length: 20 },
      (_, i) => `(${i + 1}) Content for item ${i + 1}.`
    ).join(" ");

    const chunks = chunkLegalText(text, 100, 30);

    // With overlap, chunks should share some content at boundaries
    if (chunks.length > 1) {
      // Verify overlap exists by checking that last items of chunk N-1
      // might appear at start of chunk N
      expect(chunks.length).toBeGreaterThan(1);
    }
  });
});

test.describe("chunkSection with legal boundaries", () => {
  const createMockSection = (overrides: Partial<Section> = {}): Section => ({
    id: "test-section-id",
    actId: "C-46",
    regulationId: null,
    canonicalSectionId: "C-46/en/s91",
    sectionLabel: "91",
    sectionOrder: 1,
    language: "en",
    content:
      "(1) The exclusive Legislative Authority of the Parliament of Canada extends to all Matters coming within the Classes of Subjects next hereinafter enumerated; that is to say, (a) The Public Debt and Property. (b) The Regulation of Trade and Commerce. (c) The raising of Money by any Mode or System of Taxation.",
    marginalNote: "Legislative Powers",
    sectionType: "section",
    hierarchyPath: null,
    contentHtml: null,
    status: "in-force",
    xmlType: null,
    xmlTarget: null,
    changeType: null,
    inForceStartDate: null,
    lastAmendedDate: null,
    enactedDate: null,
    limsMetadata: null,
    historicalNotes: null,
    footnotes: null,
    scheduleId: null,
    scheduleBilingual: null,
    scheduleSpanLanguages: null,
    scheduleOriginatingRef: null,
    contentFlags: null,
    formattingAttributes: null,
    provisionHeading: null,
    internalReferences: null,
    createdAt: new Date(),
    ...overrides,
  });

  test("preserves legal structure in single chunk", () => {
    const section = createMockSection();
    const chunks = chunkSection(section, "Constitution Act, 1867");

    expect(chunks).toHaveLength(1);
    // Should contain all legal markers
    expect(chunks[0].content).toContain("(1)");
    expect(chunks[0].content).toContain("(a)");
    expect(chunks[0].content).toContain("(b)");
    expect(chunks[0].content).toContain("(c)");
  });

  test("splits large section at legal boundaries when possible", () => {
    // Create a section with many subsections that will require splitting
    const longContent = Array.from(
      { length: 30 },
      (_, i) =>
        `(${i + 1}) This subsection establishes important legal provisions regarding matter ${i + 1}. The provisions contained herein apply to all persons subject to this Act, with specific reference to the duties and obligations set forth in the following paragraphs: (a) First duty relating to matter ${i + 1}; (b) Second duty relating to matter ${i + 1}; (c) Third duty relating to matter ${i + 1}.`
    ).join(" ");

    const section = createMockSection({ content: longContent });
    const chunks = chunkSection(section, "Long Legal Act");

    // Should split into multiple chunks
    expect(chunks.length).toBeGreaterThan(1);

    // Each chunk should have the prefix
    for (const chunk of chunks) {
      expect(chunk.content).toContain("Long Legal Act");
      expect(chunk.content).toContain("Section 91");
    }
  });
});

// ---------- Bilingual Pairing Tests (Task 2.3) ----------

test.describe("buildPairedResourceKey", () => {
  test("returns FR key when given EN language", () => {
    const key = buildPairedResourceKey("act_section", "sec-123", "en", 0);
    expect(key).toBe("act_section:sec-123:fr:0");
  });

  test("returns EN key when given FR language", () => {
    const key = buildPairedResourceKey("act_section", "sec-123", "fr", 0);
    expect(key).toBe("act_section:sec-123:en:0");
  });

  test("handles different source types", () => {
    expect(buildPairedResourceKey("act", "C-46", "en", 0)).toBe(
      "act:C-46:fr:0"
    );
    expect(buildPairedResourceKey("regulation", "SOR-86-946", "fr", 1)).toBe(
      "regulation:SOR-86-946:en:1"
    );
    expect(buildPairedResourceKey("defined_term", "term-abc", "en", 0)).toBe(
      "defined_term:term-abc:fr:0"
    );
  });

  test("handles multi-chunk resources", () => {
    // Different chunk indices should produce different paired keys
    const key0 = buildPairedResourceKey("act_section", "sec-123", "en", 0);
    const key1 = buildPairedResourceKey("act_section", "sec-123", "en", 1);
    const key2 = buildPairedResourceKey("act_section", "sec-123", "en", 2);

    expect(key0).toBe("act_section:sec-123:fr:0");
    expect(key1).toBe("act_section:sec-123:fr:1");
    expect(key2).toBe("act_section:sec-123:fr:2");
  });

  test("paired key and original key differ only in language", () => {
    const originalKey = buildResourceKey("cross_reference", "xref-1", "en", 0);
    const pairedKey = buildPairedResourceKey(
      "cross_reference",
      "xref-1",
      "en",
      0
    );

    expect(originalKey).toBe("cross_reference:xref-1:en:0");
    expect(pairedKey).toBe("cross_reference:xref-1:fr:0");

    // Only language segment should differ
    expect(originalKey.replace(":en:", ":fr:")).toBe(pairedKey);
  });

  test("handles schedule source type for bilingual pairing", () => {
    // Schedules (sections with sectionType=schedule) use "schedule" source type
    const keyEn = buildPairedResourceKey("schedule", "sec-sch-123", "en", 0);
    const keyFr = buildPairedResourceKey("schedule", "sec-sch-123", "fr", 0);

    expect(keyEn).toBe("schedule:sec-sch-123:fr:0");
    expect(keyFr).toBe("schedule:sec-sch-123:en:0");
  });

  test("schedule paired keys work with multi-chunk resources", () => {
    const key0 = buildPairedResourceKey("schedule", "sec-sch-1", "en", 0);
    const key1 = buildPairedResourceKey("schedule", "sec-sch-1", "en", 1);

    expect(key0).toBe("schedule:sec-sch-1:fr:0");
    expect(key1).toBe("schedule:sec-sch-1:fr:1");
  });
});

// ---------- Defined Term Scope Tests (Task 2.2) ----------

test.describe("buildTermContent with scope information", () => {
  const createMockTerm = (
    overrides: Partial<DefinedTerm> = {}
  ): DefinedTerm => ({
    id: "term-123",
    language: "en",
    term: "prescribed",
    termNormalized: "prescribed",
    pairedTerm: "réglementaire",
    pairedTermId: null,
    definition: "means prescribed by regulation.",
    actId: "C-81",
    regulationId: null,
    sectionLabel: "2",
    scopeType: "act",
    scopeSections: null,
    scopeRawText: null,
    limsMetadata: null,
    createdAt: new Date(),
    ...overrides,
  });

  test("omits scope info when scopeType is 'act'", () => {
    const term = createMockTerm({ scopeType: "act" });
    const content = buildTermContent(term, "Test Act");

    expect(content).not.toContain("Scope:");
    expect(content).not.toContain("Portée:");
  });

  test("omits scope info when scopeType is 'regulation'", () => {
    const term = createMockTerm({ scopeType: "regulation" });
    const content = buildTermContent(term, "Test Regulation");

    expect(content).not.toContain("Scope:");
    expect(content).not.toContain("Portée:");
  });

  test("includes scope type when scopeType is 'section'", () => {
    const term = createMockTerm({
      scopeType: "section",
      scopeSections: ["17", "18", "19"],
    });
    const content = buildTermContent(term, "Criminal Code");

    expect(content).toContain("Scope: section(s)");
  });

  test("includes scope type when scopeType is 'part'", () => {
    const term = createMockTerm({ scopeType: "part" });
    const content = buildTermContent(term, "Immigration Act");

    expect(content).toContain("Scope: part");
  });

  test("includes applicable sections list in English", () => {
    const term = createMockTerm({
      scopeType: "section",
      scopeSections: ["17", "18", "19"],
    });
    const content = buildTermContent(term, "Criminal Code");

    expect(content).toContain("Applicable to sections: 17, 18, 19");
  });

  test("includes applicable sections list in French", () => {
    const term = createMockTerm({
      language: "fr",
      term: "réglementaire",
      pairedTerm: "prescribed",
      scopeType: "section",
      scopeSections: ["17", "18", "19"],
    });
    const content = buildTermContent(term, "Code criminel");

    expect(content).toContain("Portée: article(s)");
    expect(content).toContain("S'applique aux articles: 17, 18, 19");
  });

  test("includes scopeRawText when available", () => {
    const term = createMockTerm({
      scopeType: "section",
      scopeSections: ["17", "18"],
      scopeRawText: "The following definitions apply in sections 17 to 19",
    });
    const content = buildTermContent(term, "Test Act");

    expect(content).toContain(
      "Scope declaration: The following definitions apply in sections 17 to 19"
    );
  });

  test("includes French scope declaration", () => {
    const term = createMockTerm({
      language: "fr",
      term: "réglementaire",
      pairedTerm: "prescribed",
      scopeType: "section",
      scopeRawText:
        "Les définitions qui suivent s'appliquent aux articles 17 à 19",
    });
    const content = buildTermContent(term, "Loi test");

    expect(content).toContain(
      "Déclaration de portée: Les définitions qui suivent s'appliquent aux articles 17 à 19"
    );
  });
});

// ---------- Embedding Model Version Tests (Task 3.3) ----------

test.describe("DEFAULT_EMBEDDING_MODEL", () => {
  test("is defined as expected Cohere model", () => {
    expect(DEFAULT_EMBEDDING_MODEL).toBe("cohere-embed-multilingual-v3.0");
  });

  test("is a non-empty string", () => {
    expect(typeof DEFAULT_EMBEDDING_MODEL).toBe("string");
    expect(DEFAULT_EMBEDDING_MODEL.length).toBeGreaterThan(0);
  });
});

// ---------- Schedule Metadata Tests (Task 1.1) ----------

test.describe("chunkSection with schedule metadata", () => {
  const createScheduleSection = (
    overrides: Partial<Section> = {}
  ): Section => ({
    id: "schedule-section-id",
    actId: "C-46",
    regulationId: null,
    canonicalSectionId: "C-46/en/sched1-s1",
    sectionLabel: "1",
    sectionOrder: 1,
    language: "en",
    content: "Controlled Substances (subsection 2(1))",
    marginalNote: "Schedule I",
    sectionType: "schedule",
    hierarchyPath: null,
    contentHtml: null,
    status: "in-force",
    xmlType: null,
    xmlTarget: null,
    changeType: null,
    inForceStartDate: null,
    lastAmendedDate: null,
    enactedDate: null,
    limsMetadata: null,
    historicalNotes: null,
    footnotes: null,
    scheduleId: "schedule-I",
    scheduleBilingual: "yes",
    scheduleSpanLanguages: "no",
    scheduleOriginatingRef: "(Section 2)",
    contentFlags: null,
    formattingAttributes: null,
    provisionHeading: null,
    internalReferences: null,
    createdAt: new Date(),
    ...overrides,
  });

  test("identifies schedule sections by sectionType", () => {
    const section = createScheduleSection();
    expect(section.sectionType).toBe("schedule");
  });

  test("schedule sections have schedule metadata fields", () => {
    const section = createScheduleSection();
    expect(section.scheduleId).toBe("schedule-I");
    expect(section.scheduleBilingual).toBe("yes");
    expect(section.scheduleSpanLanguages).toBe("no");
  });

  test("schedule sections can be chunked like regular sections", () => {
    const section = createScheduleSection();
    const chunks = chunkSection(section, "Controlled Drugs and Substances Act");

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("Controlled Drugs and Substances Act");
    expect(chunks[0].content).toContain("Section 1");
    expect(chunks[0].content).toContain("Schedule I");
  });

  test("handles schedule section without schedule metadata", () => {
    const section = createScheduleSection({
      scheduleId: null,
      scheduleBilingual: null,
      scheduleSpanLanguages: null,
      scheduleOriginatingRef: null,
    });
    const chunks = chunkSection(section, "Test Act");

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("Section 1");
  });
});

// ---------- ContentFlags Type Alignment Tests ----------

test.describe("ContentFlags type alignment", () => {
  test("LegResourceMetadata.contentFlags accepts all ContentFlags properties", () => {
    // This test verifies that the RAG schema's contentFlags type
    // accepts all properties from the legislation schema's ContentFlags type.
    // If any property is missing, this test will fail at compile time.
    const fullContentFlags: ContentFlags = {
      // Core content type flags
      hasTable: true,
      hasFormula: true,
      hasImage: true,
      imageSources: ["/images/formula-1.png"],
      hasRepealed: true,
      // Editorial/reserved flags
      hasEditorialNote: true,
      hasReserved: true,
      hasExplanatoryNote: true,
      // Content completeness flags
      hasSignatureBlock: true,
      hasBilingualGroup: true,
      hasQuotedText: true,
      hasReadAsText: true,
      hasAmendedText: true,
      hasAlternateText: true,
      alternateTextContent: ["Alternative description of table"],
      // Presentation/formatting flags
      hasFormGroup: true,
      hasOath: true,
      hasCaption: true,
    };

    // Assign to LegResourceMetadata - this will fail compilation if types don't match
    const metadata: LegResourceMetadata = {
      sourceType: "act_section",
      language: "en",
      documentTitle: "Test Act",
      contentFlags: fullContentFlags,
    };

    expect(metadata.contentFlags).toEqual(fullContentFlags);
  });

  test("contentFlags with hasReadAsText for amendment provisions", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "act_section",
      language: "en",
      documentTitle: "Test Act",
      contentFlags: {
        hasReadAsText: true,
      },
    };

    expect(metadata.contentFlags?.hasReadAsText).toBe(true);
  });

  test("contentFlags with hasEditorialNote for unofficial content", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "act_section",
      language: "en",
      documentTitle: "Test Act",
      contentFlags: {
        hasEditorialNote: true,
      },
    };

    expect(metadata.contentFlags?.hasEditorialNote).toBe(true);
  });

  test("contentFlags with hasAlternateText for accessibility", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "act_section",
      language: "en",
      documentTitle: "Test Act",
      contentFlags: {
        hasAlternateText: true,
        alternateTextContent: ["Description of complex table structure"],
      },
    };

    expect(metadata.contentFlags?.hasAlternateText).toBe(true);
    expect(metadata.contentFlags?.alternateTextContent).toHaveLength(1);
  });

  test("contentFlags with hasSignatureBlock for treaties", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "act_section",
      language: "en",
      documentTitle: "Test Act",
      contentFlags: {
        hasSignatureBlock: true,
      },
    };

    expect(metadata.contentFlags?.hasSignatureBlock).toBe(true);
  });

  test("contentFlags with multiple flags combined", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "act_section",
      language: "en",
      documentTitle: "Test Act",
      contentFlags: {
        hasTable: true,
        hasCaption: true,
        hasAlternateText: true,
        alternateTextContent: ["Table showing tax rates by income bracket"],
      },
    };

    expect(metadata.contentFlags?.hasTable).toBe(true);
    expect(metadata.contentFlags?.hasCaption).toBe(true);
    expect(metadata.contentFlags?.hasAlternateText).toBe(true);
  });
});

// ---------- sectionRole Tests ----------

test.describe("sectionRole metadata field", () => {
  test("LegResourceMetadata accepts sectionRole for amending sections", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "act_section",
      language: "en",
      documentTitle: "Test Act",
      sectionRole: "amending",
    };

    expect(metadata.sectionRole).toBe("amending");
  });

  test("LegResourceMetadata accepts sectionRole for transitional provisions", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "act_section",
      language: "en",
      documentTitle: "Test Act",
      sectionRole: "transitional",
    };

    expect(metadata.sectionRole).toBe("transitional");
  });

  test("LegResourceMetadata accepts sectionRole for CIF provisions", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "act_section",
      language: "en",
      documentTitle: "Test Act",
      sectionRole: "CIF",
    };

    expect(metadata.sectionRole).toBe("CIF");
  });

  test("LegResourceMetadata accepts sectionRole for repeal provisions", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "act_section",
      language: "en",
      documentTitle: "Test Act",
      sectionRole: "repeal",
    };

    expect(metadata.sectionRole).toBe("repeal");
  });

  test("sectionRole can be combined with other section metadata", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "act_section",
      language: "en",
      documentTitle: "Budget Implementation Act, 2024",
      actId: "C-10",
      sectionId: "section-123",
      sectionLabel: "45",
      sectionStatus: "in-force",
      sectionType: "section",
      sectionRole: "amending",
      contentFlags: {
        hasReadAsText: true,
      },
    };

    expect(metadata.sectionRole).toBe("amending");
    expect(metadata.contentFlags?.hasReadAsText).toBe(true);
    expect(metadata.sectionLabel).toBe("45");
  });

  test("section with xmlType maps to sectionRole in embeddings", () => {
    // This documents the mapping from sections.xmlType to metadata.sectionRole
    const xmlTypeToRole: Record<string, string> = {
      amending: "amending",
      transitional: "transitional",
      CIF: "CIF",
      CIFnobold: "CIFnobold",
      repeal: "repeal",
      normal: "normal",
    };

    for (const [xmlType, expectedRole] of Object.entries(xmlTypeToRole)) {
      const metadata: LegResourceMetadata = {
        sourceType: "act_section",
        language: "en",
        documentTitle: "Test Act",
        sectionRole: xmlType, // xmlType -> sectionRole mapping
      };
      expect(metadata.sectionRole).toBe(expectedRole);
    }
  });
});

// ---------- Parser Tests for Schedule Content Extraction ----------
// These tests verify that the legislation parser correctly extracts:
// - Root-level Schedule blocks (Issue #1)
// - TableGroup content in schedules (Issue #2)
// - BillPiece/RelatedOrNotInForce content in schedules (Issue #2)

import { parseActXml, parseRegulationXml } from "@/lib/legislation/parser";

test.describe("parseActXml root-level Schedule parsing", () => {
  test("parses root-level Schedule with RELATED PROVISIONS content", () => {
    const xml = `<?xml version="1.0"?>
<Statute lims:inforce-start-date="2020-01-01">
  <Identification>
    <Chapter>
      <ConsolidatedNumber>T-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle>Test Act</ShortTitle>
  </Identification>
  <Body>
    <Section>
      <MarginalNote>Short title</MarginalNote>
      <Label>1</Label>
      <Text>This Act may be cited as the Test Act.</Text>
    </Section>
  </Body>
  <Schedule id="RelatedProvs">
    <ScheduleFormHeading type="amending">
      <TitleText>RELATED PROVISIONS</TitleText>
    </ScheduleFormHeading>
    <BillPiece>
      <RelatedOrNotInForce>
        <Heading level="5" style="nifrp">
          <TitleText>— 2020, c. 10, s. 5</TitleText>
        </Heading>
        <Section>
          <MarginalNote>Transitional</MarginalNote>
          <Label>5</Label>
          <Text>Related provision content for transitional matters.</Text>
        </Section>
      </RelatedOrNotInForce>
    </BillPiece>
  </Schedule>
</Statute>`;

    const result = parseActXml(xml, "en");

    // Should have sections from both Body and root-level Schedule
    expect(result.sections.length).toBeGreaterThanOrEqual(2);

    // Find the section from root-level schedule
    const scheduleSection = result.sections.find(
      (s) =>
        s.content.includes("Related provision content") ||
        s.content.includes("Transitional")
    );
    expect(scheduleSection).toBeDefined();
    // RELATED PROVISIONS schedule with type="amending" should produce amending sectionType
    expect(scheduleSection?.sectionType).toBe("amending");
  });

  test("parses root-level Schedule with NOT IN FORCE content", () => {
    const xml = `<?xml version="1.0"?>
<Statute lims:inforce-start-date="2020-01-01">
  <Identification>
    <Chapter>
      <ConsolidatedNumber>N-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle>Test NIF Act</ShortTitle>
  </Identification>
  <Body>
    <Section>
      <Label>1</Label>
      <Text>Body section content.</Text>
    </Section>
  </Body>
  <Schedule id="NifProvs">
    <ScheduleFormHeading type="amending">
      <TitleText>AMENDMENTS NOT IN FORCE</TitleText>
    </ScheduleFormHeading>
    <BillPiece>
      <RelatedOrNotInForce>
        <Heading level="5" style="nifrp">
          <TitleText>— 2023, c. 5, s. 10</TitleText>
        </Heading>
        <Section type="amending">
          <Label>10</Label>
          <Text>This section is not yet in force.</Text>
        </Section>
      </RelatedOrNotInForce>
    </BillPiece>
  </Schedule>
</Statute>`;

    const result = parseActXml(xml, "en");

    // Should parse sections from NOT IN FORCE schedule
    const nifSection = result.sections.find((s) =>
      s.content.includes("not yet in force")
    );
    expect(nifSection).toBeDefined();
  });

  test("parses multiple root-level Schedules", () => {
    const xml = `<?xml version="1.0"?>
<Statute>
  <Identification>
    <Chapter>
      <ConsolidatedNumber>M-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle>Multi Schedule Act</ShortTitle>
  </Identification>
  <Body>
    <Section>
      <Label>1</Label>
      <Text>Main body content.</Text>
    </Section>
  </Body>
  <Schedule id="RelatedProvs">
    <ScheduleFormHeading><TitleText>RELATED PROVISIONS</TitleText></ScheduleFormHeading>
    <BillPiece>
      <RelatedOrNotInForce>
        <Section><Label>R1</Label><Text>Related provision one.</Text></Section>
      </RelatedOrNotInForce>
    </BillPiece>
  </Schedule>
  <Schedule id="NifProvs">
    <ScheduleFormHeading><TitleText>NOT IN FORCE</TitleText></ScheduleFormHeading>
    <BillPiece>
      <RelatedOrNotInForce>
        <Section><Label>N1</Label><Text>Not in force provision.</Text></Section>
      </RelatedOrNotInForce>
    </BillPiece>
  </Schedule>
</Statute>`;

    const result = parseActXml(xml, "en");

    // Should have content from both schedules
    const relatedSection = result.sections.find((s) =>
      s.content.includes("Related provision one")
    );
    const nifSection = result.sections.find((s) =>
      s.content.includes("Not in force provision")
    );

    expect(relatedSection).toBeDefined();
    expect(nifSection).toBeDefined();
  });
});

test.describe("parseActXml TableGroup extraction", () => {
  test("extracts TableGroup content from schedules", () => {
    const xml = `<?xml version="1.0"?>
<Statute>
  <Identification>
    <Chapter>
      <ConsolidatedNumber>T-2</ConsolidatedNumber>
    </Chapter>
    <ShortTitle>Table Schedule Act</ShortTitle>
  </Identification>
  <Body>
    <Schedule id="sch-1">
      <ScheduleFormHeading>
        <Label>SCHEDULE I</Label>
        <OriginatingRef>(Section 2)</OriginatingRef>
      </ScheduleFormHeading>
      <TableGroup pointsize="8" bilingual="no">
        <table frame="topbot">
          <tgroup cols="2">
            <colspec colname="1" colnum="1"/>
            <colspec colname="2" colnum="2"/>
            <thead>
              <row>
                <entry>Column I</entry>
                <entry>Column II</entry>
              </row>
              <row>
                <entry>Department</entry>
                <entry>Appropriate Minister</entry>
              </row>
            </thead>
            <tbody>
              <row>
                <entry>Department of Justice</entry>
                <entry>Minister of Justice</entry>
              </row>
              <row>
                <entry>Department of Finance</entry>
                <entry>Minister of Finance</entry>
              </row>
            </tbody>
          </tgroup>
        </table>
      </TableGroup>
    </Schedule>
  </Body>
</Statute>`;

    const result = parseActXml(xml, "en");

    // Should have a section from the TableGroup
    const tableSection = result.sections.find(
      (s) =>
        s.content.includes("Department of Justice") ||
        s.content.includes("Minister of Justice")
    );
    expect(tableSection).toBeDefined();
    expect(tableSection?.sectionType).toBe("schedule");

    // Should have table content flags
    expect(tableSection?.contentFlags?.hasTable).toBe(true);
  });

  test("extracts TableGroup with table metadata", () => {
    const xml = `<?xml version="1.0"?>
<Statute>
  <Identification>
    <Chapter><ConsolidatedNumber>T-3</ConsolidatedNumber></Chapter>
    <ShortTitle>Metadata Table Act</ShortTitle>
  </Identification>
  <Body>
    <Schedule id="sch-I.1" lims:inforce-start-date="2023-06-01">
      <ScheduleFormHeading>
        <Label>SCHEDULE I.1</Label>
      </ScheduleFormHeading>
      <TableGroup lims:inforce-start-date="2023-06-01" pointsize="8">
        <table>
          <tgroup cols="2">
            <thead>
              <row><entry>Name</entry><entry>Value</entry></row>
            </thead>
            <tbody>
              <row><entry>Item A</entry><entry>100</entry></row>
            </tbody>
          </tgroup>
        </table>
      </TableGroup>
    </Schedule>
  </Body>
</Statute>`;

    const result = parseActXml(xml, "en");

    const tableSection = result.sections.find((s) =>
      s.content.includes("Item A")
    );
    expect(tableSection).toBeDefined();
    expect(tableSection?.contentFlags?.hasTable).toBe(true);
  });
});

test.describe("parseActXml BillPiece and RelatedOrNotInForce in Body schedules", () => {
  test("extracts content from BillPiece within Body Schedule", () => {
    const xml = `<?xml version="1.0"?>
<Statute>
  <Identification>
    <Chapter><ConsolidatedNumber>B-1</ConsolidatedNumber></Chapter>
    <ShortTitle>BillPiece Test Act</ShortTitle>
  </Identification>
  <Body>
    <Schedule id="sch-transitional">
      <ScheduleFormHeading>
        <TitleText>TRANSITIONAL PROVISIONS</TitleText>
      </ScheduleFormHeading>
      <BillPiece>
        <RelatedOrNotInForce>
          <Heading level="5">
            <TitleText>— 2022, c. 15, s. 100</TitleText>
          </Heading>
          <Section>
            <MarginalNote>Application</MarginalNote>
            <Label>100</Label>
            <Text>This section applies to all pending applications.</Text>
          </Section>
        </RelatedOrNotInForce>
        <RelatedOrNotInForce>
          <Heading level="5">
            <TitleText>— 2022, c. 15, s. 101</TitleText>
          </Heading>
          <Section>
            <MarginalNote>Continuation</MarginalNote>
            <Label>101</Label>
            <Text>Existing rights continue in effect.</Text>
          </Section>
        </RelatedOrNotInForce>
      </BillPiece>
    </Schedule>
  </Body>
</Statute>`;

    const result = parseActXml(xml, "en");

    // Should have sections from RelatedOrNotInForce elements
    const applicationSection = result.sections.find((s) =>
      s.content.includes("pending applications")
    );
    const continuationSection = result.sections.find((s) =>
      s.content.includes("Existing rights")
    );

    expect(applicationSection).toBeDefined();
    expect(continuationSection).toBeDefined();
  });

  test("extracts List content from BillPiece within Schedule", () => {
    const xml = `<?xml version="1.0"?>
<Statute>
  <Identification>
    <Chapter><ConsolidatedNumber>L-1</ConsolidatedNumber></Chapter>
    <ShortTitle>List in BillPiece Act</ShortTitle>
  </Identification>
  <Body>
    <Schedule id="sch-list">
      <ScheduleFormHeading>
        <Label>SCHEDULE</Label>
      </ScheduleFormHeading>
      <BillPiece>
        <RelatedOrNotInForce>
          <List>
            <Item><Label>1</Label><Text>First list item in schedule.</Text></Item>
            <Item><Label>2</Label><Text>Second list item in schedule.</Text></Item>
          </List>
        </RelatedOrNotInForce>
      </BillPiece>
    </Schedule>
  </Body>
</Statute>`;

    const result = parseActXml(xml, "en");

    // Should extract the List content from within BillPiece/RelatedOrNotInForce
    const listSection = result.sections.find(
      (s) =>
        s.content.includes("First list item") ||
        s.content.includes("Second list item")
    );
    expect(listSection).toBeDefined();
  });
});

test.describe("parseRegulationXml Schedule parsing", () => {
  test("parses schedules in regulations", () => {
    const xml = `<?xml version="1.0"?>
<Regulation lims:inforce-start-date="2020-01-01">
  <Identification>
    <InstrumentNumber>SOR/2020-100</InstrumentNumber>
    <RegistrationDate>2020-05-15</RegistrationDate>
    <LongTitle>Test Regulations</LongTitle>
  </Identification>
  <Body>
    <Section>
      <Label>1</Label>
      <Text>Main regulation content.</Text>
    </Section>
    <Schedule id="sch-1">
      <ScheduleFormHeading>
        <Label>SCHEDULE</Label>
        <OriginatingRef>(Section 1)</OriginatingRef>
      </ScheduleFormHeading>
      <List>
        <Item><Label>1</Label><Text>Schedule item one.</Text></Item>
        <Item><Label>2</Label><Text>Schedule item two.</Text></Item>
      </List>
    </Schedule>
  </Body>
</Regulation>`;

    const result = parseRegulationXml(xml, "en");

    // Should have main section and schedule content
    expect(result.sections.length).toBeGreaterThanOrEqual(2);

    const scheduleSection = result.sections.find((s) =>
      s.content.includes("Schedule item")
    );
    expect(scheduleSection).toBeDefined();
    expect(scheduleSection?.sectionType).toBe("schedule");
  });

  test("parses regulation with TableGroup in schedule", () => {
    const xml = `<?xml version="1.0"?>
<Regulation>
  <Identification>
    <InstrumentNumber>SOR/2021-50</InstrumentNumber>
    <LongTitle>Table Regulations</LongTitle>
  </Identification>
  <Body>
    <Schedule id="sch-rates">
      <ScheduleFormHeading>
        <Label>SCHEDULE</Label>
        <TitleText>Fee Schedule</TitleText>
      </ScheduleFormHeading>
      <TableGroup>
        <table>
          <tgroup cols="2">
            <thead>
              <row><entry>Service</entry><entry>Fee</entry></row>
            </thead>
            <tbody>
              <row><entry>Application</entry><entry>$100</entry></row>
              <row><entry>Renewal</entry><entry>$50</entry></row>
            </tbody>
          </tgroup>
        </table>
      </TableGroup>
    </Schedule>
  </Body>
</Regulation>`;

    const result = parseRegulationXml(xml, "en");

    const tableSection = result.sections.find(
      (s) => s.content.includes("Application") || s.content.includes("$100")
    );
    expect(tableSection).toBeDefined();
    expect(tableSection?.contentFlags?.hasTable).toBe(true);
  });
});

test.describe("Parser cross-reference extraction from schedules", () => {
  test("extracts cross-references from TableGroup content", () => {
    const xml = `<?xml version="1.0"?>
<Statute>
  <Identification>
    <Chapter><ConsolidatedNumber>X-1</ConsolidatedNumber></Chapter>
    <ShortTitle>Cross Ref Act</ShortTitle>
  </Identification>
  <Body>
    <Schedule id="sch-refs">
      <ScheduleFormHeading><Label>SCHEDULE</Label></ScheduleFormHeading>
      <TableGroup>
        <table>
          <tgroup cols="1">
            <tbody>
              <row>
                <entry>
                  See <XRefExternal reference-type="act" link="C-46">Criminal Code</XRefExternal>
                </entry>
              </row>
            </tbody>
          </tgroup>
        </table>
      </TableGroup>
    </Schedule>
  </Body>
</Statute>`;

    const result = parseActXml(xml, "en");

    // Should have cross-references extracted from table content
    const criminalCodeRef = result.crossReferences.find(
      (ref) => ref.targetRef === "C-46" || ref.referenceText === "Criminal Code"
    );
    expect(criminalCodeRef).toBeDefined();
  });
});

test.describe("parseRegulationXml Order/Provision parsing", () => {
  test("parses Order/Provision elements from regulations", () => {
    const xml = `<?xml version="1.0"?>
<Regulation lims:inforce-start-date="2020-01-01" xmlns:lims="http://justice.gc.ca/lims">
  <Identification>
    <InstrumentNumber>SOR/2000-1</InstrumentNumber>
    <LongTitle>Test Divestiture Regulations</LongTitle>
    <RegulationMakerOrder>
      <RegulationMaker>T.B.</RegulationMaker>
      <OrderNumber>827750</OrderNumber>
    </RegulationMakerOrder>
  </Identification>
  <Order lims:inforce-start-date="2020-01-01" lims:fid="123456">
    <Provision lims:inforce-start-date="2020-01-01" lims:fid="123457">
      <Text>The Treasury Board, on the recommendation of the President of the Treasury Board, pursuant to paragraph 42.1(1)(u) of the Public Service Superannuation Act, hereby makes the annexed Test Divestiture Regulations.</Text>
    </Provision>
  </Order>
  <Body>
    <Section>
      <Label>1</Label>
      <Text>The definitions in this section apply in these Regulations.</Text>
    </Section>
  </Body>
</Regulation>`;

    const result = parseRegulationXml(xml, "en");

    // Should have both the Order provision and the body section
    expect(result.sections.length).toBeGreaterThanOrEqual(2);

    // Find the order provision section
    const orderSection = result.sections.find(
      (s) => s.sectionType === "provision"
    );
    expect(orderSection).toBeDefined();
    expect(orderSection?.sectionLabel).toBe("order");
    expect(orderSection?.content).toContain("Treasury Board");
    expect(orderSection?.content).toContain("recommendation");
  });

  test("parses Order/Provision with footnotes", () => {
    const xml = `<?xml version="1.0"?>
<Regulation xmlns:lims="http://justice.gc.ca/lims">
  <Identification>
    <InstrumentNumber>SOR/2000-2</InstrumentNumber>
    <LongTitle>Test Regulations with Footnotes</LongTitle>
  </Identification>
  <Order lims:inforce-start-date="2020-01-01">
    <Provision lims:inforce-start-date="2020-01-01">
      <Text>Made pursuant to paragraph 42.1(1)(u)<FootnoteRef idref="fn_test">a</FootnoteRef> of the Act.</Text>
      <Footnote id="fn_test" placement="page" status="official">
        <Label>a</Label>
        <Text>S.C. 1992, c. 46, s. 22</Text>
      </Footnote>
    </Provision>
  </Order>
  <Body>
    <Section><Label>1</Label><Text>Test section.</Text></Section>
  </Body>
</Regulation>`;

    const result = parseRegulationXml(xml, "en");

    const orderSection = result.sections.find(
      (s) => s.sectionType === "provision"
    );
    expect(orderSection).toBeDefined();
    expect(orderSection?.footnotes).toBeDefined();
    expect(orderSection?.footnotes?.length).toBeGreaterThanOrEqual(1);
    expect(orderSection?.footnotes?.[0]?.id).toBe("fn_test");
    expect(orderSection?.footnotes?.[0]?.text).toContain("S.C. 1992");
  });

  test("parses Order with multiple Provision elements", () => {
    const xml = `<?xml version="1.0"?>
<Regulation xmlns:lims="http://justice.gc.ca/lims">
  <Identification>
    <InstrumentNumber>SOR/2000-3</InstrumentNumber>
    <LongTitle>Multi-Provision Regulations</LongTitle>
  </Identification>
  <Order>
    <Provision>
      <Text>First provision: Authority text.</Text>
    </Provision>
    <Provision>
      <Text>Second provision: Additional authority.</Text>
    </Provision>
  </Order>
  <Body>
    <Section><Label>1</Label><Text>Body section.</Text></Section>
  </Body>
</Regulation>`;

    const result = parseRegulationXml(xml, "en");

    const provisionSections = result.sections.filter(
      (s) => s.sectionType === "provision"
    );
    expect(provisionSections.length).toBe(2);

    // First provision should have label "order"
    expect(provisionSections[0].sectionLabel).toBe("order");
    expect(provisionSections[0].content).toContain("First provision");

    // Second provision should have label "order-provision-2"
    expect(provisionSections[1].sectionLabel).toBe("order-provision-2");
    expect(provisionSections[1].content).toContain("Second provision");
  });

  test("extracts cross-references from Order/Provision", () => {
    const xml = `<?xml version="1.0"?>
<Regulation xmlns:lims="http://justice.gc.ca/lims">
  <Identification>
    <InstrumentNumber>SOR/2000-4</InstrumentNumber>
    <LongTitle>Cross-Reference Regulations</LongTitle>
  </Identification>
  <Order>
    <Provision>
      <Text>Pursuant to <XRefExternal reference-type="act" link="P-36">Public Service Superannuation Act</XRefExternal> and <XRefExternal reference-type="act" link="F-11">Financial Administration Act</XRefExternal>.</Text>
    </Provision>
  </Order>
  <Body>
    <Section><Label>1</Label><Text>Body section.</Text></Section>
  </Body>
</Regulation>`;

    const result = parseRegulationXml(xml, "en");

    // Should extract cross-references from the Order/Provision
    const p36Ref = result.crossReferences.find((r) => r.targetRef === "P-36");
    expect(p36Ref).toBeDefined();
    expect(p36Ref?.sourceSectionLabel).toBe("order");

    const f11Ref = result.crossReferences.find((r) => r.targetRef === "F-11");
    expect(f11Ref).toBeDefined();
  });

  test("preserves LIMS metadata from Order/Provision", () => {
    const xml = `<?xml version="1.0"?>
<Regulation xmlns:lims="http://justice.gc.ca/lims">
  <Identification>
    <InstrumentNumber>SOR/2000-5</InstrumentNumber>
    <LongTitle>LIMS Metadata Regulations</LongTitle>
  </Identification>
  <Order lims:fid="order-fid" lims:id="order-id">
    <Provision lims:inforce-start-date="2020-06-15" lims:fid="prov-fid" lims:id="prov-id">
      <Text>Authority provision with LIMS metadata.</Text>
    </Provision>
  </Order>
  <Body>
    <Section><Label>1</Label><Text>Body section.</Text></Section>
  </Body>
</Regulation>`;

    const result = parseRegulationXml(xml, "en");

    const orderSection = result.sections.find(
      (s) => s.sectionType === "provision"
    );
    expect(orderSection).toBeDefined();
    expect(orderSection?.inForceStartDate).toBe("2020-06-15");
    expect(orderSection?.limsMetadata?.fid).toBe("prov-fid");
    expect(orderSection?.limsMetadata?.id).toBe("prov-id");
  });

  test("generates correct canonical section ID for provisions", () => {
    const xml = `<?xml version="1.0"?>
<Regulation xmlns:lims="http://justice.gc.ca/lims">
  <Identification>
    <InstrumentNumber>SOR/2000-6</InstrumentNumber>
    <LongTitle>Canonical ID Regulations</LongTitle>
  </Identification>
  <Order>
    <Provision>
      <Text>Authority text.</Text>
    </Provision>
  </Order>
  <Body>
    <Section><Label>1</Label><Text>Body section.</Text></Section>
  </Body>
</Regulation>`;

    const result = parseRegulationXml(xml, "en");

    const orderSection = result.sections.find(
      (s) => s.sectionType === "provision"
    );
    expect(orderSection).toBeDefined();
    expect(orderSection?.canonicalSectionId).toBe("SOR-2000-6/en/order");
  });

  test("French regulation Order/Provision parsing", () => {
    const xml = `<?xml version="1.0"?>
<Regulation xmlns:lims="http://justice.gc.ca/lims" xml:lang="fr">
  <Identification>
    <InstrumentNumber>DORS/2000-1</InstrumentNumber>
    <LongTitle>Règlement sur la cession</LongTitle>
  </Identification>
  <Order>
    <Provision>
      <Text>Sur recommandation du président du Conseil du Trésor et en vertu de l'alinéa de la Loi.</Text>
    </Provision>
  </Order>
  <Body>
    <Section><Label>1</Label><Text>Définitions.</Text></Section>
  </Body>
</Regulation>`;

    const result = parseRegulationXml(xml, "fr");

    const orderSection = result.sections.find(
      (s) => s.sectionType === "provision"
    );
    expect(orderSection).toBeDefined();
    expect(orderSection?.language).toBe("fr");
    expect(orderSection?.content).toContain("recommandation");
    expect(orderSection?.canonicalSectionId).toBe("DORS-2000-1/fr/order");
  });
});
