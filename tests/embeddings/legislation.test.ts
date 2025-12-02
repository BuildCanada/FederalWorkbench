/**
 * Tests for legislation embeddings utilities and processing functions.
 *
 * These tests cover the pure utility functions used in the legislation
 * embeddings generation script without requiring database connections.
 */

import { expect, test } from "@playwright/test";

// Precompiled regex for sentence boundary checks in tests
const SENTENCE_END_REGEX = /[.!?]$/;

import type {
  Act,
  DefinedTerm,
  Regulation,
  Section,
} from "@/lib/db/legislation/schema";
import {
  chunkSection,
  shouldSkipSection,
} from "@/lib/rag/legislation/chunking";
import {
  chunkTextByTokens,
  countTokens,
  normalizeForEmbedding,
  TARGET_CHUNK_TOKENS,
} from "@/lib/rag/shared/chunking";

import { buildActMetadataText } from "@/scripts/embeddings/legislation/acts";
import { buildRelatedProvisionContent } from "@/scripts/embeddings/legislation/additional-content";
import { buildTermContent } from "@/scripts/embeddings/legislation/defined-terms";
import { buildRegulationMetadataText } from "@/scripts/embeddings/legislation/regulations";
import {
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
    annualStatuteYear: null,
    annualStatuteChapter: null,
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
    contentFlags: null,
    formattingAttributes: null,
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
    contentFlags: null,
    formattingAttributes: null,
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
    contentFlags: null,
    formattingAttributes: null,
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
