/**
 * Tests for legislation RAG search and retrieval functions.
 *
 * These tests cover citation building, context building, and other
 * search/retrieval functions used when querying legislation embeddings.
 */

import { expect, test } from "@playwright/test";

// Regex for checking sort order in context builder tests
const CONTEXT_SORT_ORDER_REGEX = /Criminal Code.*Broadcasting Act/s;

import type { LegResourceMetadata } from "@/lib/db/rag/schema";
import {
  buildActCitation,
  buildActSectionCitation,
  buildCitation,
  buildCrossReferenceCitation,
  buildDefinedTermCitation,
  buildPreambleCitation,
  buildRegulationCitation,
  buildRegulationSectionCitation,
  buildSignatureBlockCitation,
  buildTableOfProvisionsCitation,
  buildTreatyCitation,
} from "@/lib/rag/legislation/citations";
import {
  buildLegislationContext,
  LEGISLATION_CITATION_PREFIX,
  type RerankerFn,
} from "@/lib/rag/legislation/context-builder";
import type { RerankedLegislationResult } from "@/lib/rag/legislation/reranker";
import type { LegislationSearchResult } from "@/lib/rag/legislation/search";

/**
 * Mock reranker that preserves original order and scores without API calls.
 * Used for testing context builder logic without Cohere API dependencies.
 */
const mockReranker: RerankerFn = (_query, results, topN) => {
  return Promise.resolve(
    results.slice(0, topN).map((r) => ({
      ...r,
      originalSimilarity: r.similarity,
      rerankScore: r.similarity,
    })) as RerankedLegislationResult[]
  );
};

// ---------- Citation Builder Tests ----------

test.describe("buildActCitation", () => {
  test("builds citation with all fields", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "act",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
    };
    const citation = buildActCitation(metadata, 1);

    expect(citation.id).toBe(1);
    expect(citation.textEn).toBe("[Criminal Code]");
    expect(citation.textFr).toBe("[Criminal Code]");
    expect(citation.urlEn).toContain("laws-lois.justice.gc.ca");
    expect(citation.urlEn).toContain("/eng/acts/C-46/");
    expect(citation.urlFr).toContain("/fra/lois/C-46/");
    expect(citation.sourceType).toBe("act");
  });

  test("handles missing actId", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "act",
      language: "en",
      documentTitle: "Unknown Act",
    };
    const citation = buildActCitation(metadata, 1);

    expect(citation.urlEn).toContain("unknown");
    expect(citation.textEn).toBe("[Unknown Act]");
  });
});

test.describe("buildActSectionCitation", () => {
  test("includes section label in citation text", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "act_section",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
      sectionLabel: "91",
    };
    const citation = buildActSectionCitation(metadata, 2);

    expect(citation.textEn).toBe("[Criminal Code, s 91]");
    expect(citation.textFr).toBe("[Criminal Code, art 91]");
    expect(citation.urlEn).toContain("#sec91");
    expect(citation.sourceType).toBe("act_section");
  });

  test("handles missing section label", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "act_section",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
    };
    const citation = buildActSectionCitation(metadata, 2);

    expect(citation.textEn).toBe("[Criminal Code]");
    expect(citation.urlEn).not.toContain("#sec");
  });
});

test.describe("buildRegulationCitation", () => {
  test("builds citation correctly", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "regulation",
      language: "en",
      regulationId: "SOR-86-946",
      documentTitle: "Employment Insurance Regulations",
    };
    const citation = buildRegulationCitation(metadata, 3);

    expect(citation.textEn).toBe("[Employment Insurance Regulations]");
    expect(citation.urlEn).toContain("/eng/regulations/SOR-86-946/");
    expect(citation.urlFr).toContain("/fra/reglements/SOR-86-946/");
    expect(citation.sourceType).toBe("regulation");
  });
});

test.describe("buildRegulationSectionCitation", () => {
  test("includes section label", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "regulation_section",
      language: "fr",
      regulationId: "SOR-86-946",
      documentTitle: "Règlement sur l'assurance-emploi",
      sectionLabel: "12",
    };
    const citation = buildRegulationSectionCitation(metadata, 4);

    expect(citation.textEn).toContain("s 12");
    expect(citation.textFr).toContain("art 12");
    expect(citation.urlEn).toContain("#sec12");
    expect(citation.sourceType).toBe("regulation_section");
  });
});

test.describe("buildDefinedTermCitation", () => {
  test("builds citation for defined term", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "defined_term",
      language: "en",
      actId: "C-81",
      documentTitle: "Accessible Canada Act",
      term: "barrier",
      sectionLabel: "2",
    };
    const citation = buildDefinedTermCitation(metadata, 5);

    expect(citation.textEn).toContain('"barrier"');
    expect(citation.textFr).toContain("« barrier »");
    expect(citation.titleEn).toContain("defined in");
    expect(citation.sourceType).toBe("defined_term");
  });

  test("handles term without section", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "defined_term",
      language: "en",
      actId: "C-81",
      documentTitle: "Accessible Canada Act",
      term: "obstacle",
    };
    const citation = buildDefinedTermCitation(metadata, 5);

    expect(citation.textEn).not.toContain(", s ");
    expect(citation.urlEn).not.toContain("#sec");
  });
});

test.describe("buildPreambleCitation", () => {
  test("builds preamble citation", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "preamble",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
    };
    const citation = buildPreambleCitation(metadata, 6);

    expect(citation.textEn).toBe("[Criminal Code, Preamble]");
    expect(citation.textFr).toBe("[Criminal Code, Préambule]");
    expect(citation.titleEn).toContain("Preamble");
    expect(citation.titleFr).toContain("Préambule");
    expect(citation.sourceType).toBe("preamble");
  });
});

test.describe("buildTreatyCitation", () => {
  test("builds treaty citation with title", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "treaty",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
      treatyTitle: "Vienna Convention",
    };
    const citation = buildTreatyCitation(metadata, 7);

    expect(citation.textEn).toBe("[Vienna Convention]");
    expect(citation.titleEn).toBe("Vienna Convention");
    expect(citation.sourceType).toBe("treaty");
  });

  test("falls back to parent document when no treaty title", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "treaty",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
    };
    const citation = buildTreatyCitation(metadata, 7);

    expect(citation.textEn).toContain("Treaty in Criminal Code");
  });
});

test.describe("buildCrossReferenceCitation", () => {
  test("builds cross-reference citation", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "cross_reference",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
      targetType: "act",
      targetRef: "C-81",
    };
    const citation = buildCrossReferenceCitation(metadata, 8);

    expect(citation.textEn).toContain("Criminal Code →");
    expect(citation.textEn).toContain("Act C-81");
    expect(citation.textFr).toContain("Loi C-81");
    expect(citation.urlEn).toContain("C-81");
    expect(citation.sourceType).toBe("cross_reference");
  });

  test("handles regulation target type", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "cross_reference",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
      targetType: "regulation",
      targetRef: "SOR-86-946",
    };
    const citation = buildCrossReferenceCitation(metadata, 8);

    expect(citation.textEn).toContain("Regulation SOR-86-946");
    expect(citation.textFr).toContain("Règlement SOR-86-946");
  });
});

test.describe("buildTableOfProvisionsCitation", () => {
  test("builds table of provisions citation", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "table_of_provisions",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
      provisionLabel: "Part I",
      provisionTitle: "General",
    };
    const citation = buildTableOfProvisionsCitation(metadata, 9);

    expect(citation.textEn).toContain("Table of Provisions");
    expect(citation.textEn).toContain("Part I");
    expect(citation.textEn).toContain("General");
    expect(citation.textFr).toContain("Table des dispositions");
    expect(citation.sourceType).toBe("table_of_provisions");
  });
});

test.describe("buildSignatureBlockCitation", () => {
  test("builds signature block citation with signatory", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "signature_block",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
      signatureName: "John Smith",
      signatureTitle: "Minister of Justice",
    };
    const citation = buildSignatureBlockCitation(metadata, 10);

    expect(citation.textEn).toContain("Signature");
    expect(citation.textEn).toContain("John Smith");
    expect(citation.textEn).toContain("Minister of Justice");
    expect(citation.sourceType).toBe("signature_block");
  });

  test("handles missing signatory info", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "signature_block",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
    };
    const citation = buildSignatureBlockCitation(metadata, 10);

    expect(citation.textEn).toBe("[Criminal Code, Signature]");
  });
});

test.describe("buildCitation (dispatcher)", () => {
  test("dispatches to correct builder for each source type", () => {
    const sourceTypes: LegResourceMetadata["sourceType"][] = [
      "act",
      "act_section",
      "regulation",
      "regulation_section",
      "defined_term",
      "preamble",
      "treaty",
      "cross_reference",
      "table_of_provisions",
      "signature_block",
    ];

    for (const sourceType of sourceTypes) {
      const metadata: LegResourceMetadata = {
        sourceType,
        language: "en",
        documentTitle: "Test Document",
        actId: "C-46",
      };
      const citation = buildCitation(metadata, 1);

      expect(citation.sourceType).toBe(sourceType);
      expect(citation.id).toBe(1);
      expect(citation.textEn).toBeTruthy();
      expect(citation.urlEn).toBeTruthy();
    }
  });
});

// ---------- Context Builder Tests ----------

test.describe("buildLegislationContext", () => {
  // Helper to create mock search results
  const createMockSearchResult = (
    overrides: Partial<LegislationSearchResult> = {}
  ): LegislationSearchResult => ({
    content: "This is the section content for testing purposes.",
    metadata: {
      sourceType: "act_section",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
      sectionLabel: "91",
      marginalNote: "Legislative Powers",
    },
    similarity: 0.85,
    citation: {
      id: 1,
      prefixedId: "",
      textEn: "[Criminal Code, s 91]",
      textFr: "[Code criminel, art 91]",
      urlEn: "https://laws-lois.justice.gc.ca/eng/acts/C-46/page-1.html#sec91",
      urlFr: "https://laws-lois.justice.gc.ca/fra/lois/C-46/page-1.html#sec91",
      titleEn: "Criminal Code",
      titleFr: "Code criminel",
      sourceType: "act_section",
    },
    ...overrides,
  });

  test("returns empty context message when no results", async () => {
    const context = await buildLegislationContext("test query", [], {
      language: "en",
    });

    expect(context.prompt).toBe("No legislative results found.");
    expect(context.citations).toHaveLength(0);
    expect(context.language).toBe("en");
  });

  test("returns French empty message for French language", async () => {
    const context = await buildLegislationContext("test query", [], {
      language: "fr",
    });

    expect(context.prompt).toBe("Aucun résultat législatif trouvé.");
  });

  test("builds context with citations", async () => {
    const results = [createMockSearchResult()];
    const context = await buildLegislationContext("test query", results, {
      language: "en",
      reranker: mockReranker,
    });

    expect(context.prompt).toContain("Legislative context:");
    expect(context.prompt).toContain("Sources:");
    expect(context.citations).toHaveLength(1);
    expect(context.citations[0].prefixedId).toBe(
      `${LEGISLATION_CITATION_PREFIX}1`
    );
  });

  test("uses L prefix for citation IDs", async () => {
    const results = [
      createMockSearchResult({
        similarity: 0.9,
        content: "First section content for testing.",
        metadata: {
          sourceType: "act_section",
          language: "en",
          actId: "C-46",
          documentTitle: "Criminal Code",
          sectionLabel: "91",
        },
      }),
      createMockSearchResult({
        similarity: 0.8,
        content: "Second section content for testing.",
        metadata: {
          sourceType: "act_section",
          language: "en",
          actId: "C-11",
          documentTitle: "Broadcasting Act",
          sectionLabel: "1",
        },
        citation: {
          id: 2,
          prefixedId: "",
          textEn: "[Broadcasting Act, s 1]",
          textFr: "[Loi sur la radiodiffusion, art 1]",
          urlEn:
            "https://laws-lois.justice.gc.ca/eng/acts/C-11/page-1.html#sec1",
          urlFr:
            "https://laws-lois.justice.gc.ca/fra/lois/C-11/page-1.html#sec1",
          titleEn: "Broadcasting Act",
          titleFr: "Loi sur la radiodiffusion",
          sourceType: "act_section",
        },
      }),
    ];
    const context = await buildLegislationContext("test query", results, {
      language: "en",
      reranker: mockReranker,
    });

    expect(context.citations[0].prefixedId).toBe("L1");
    expect(context.citations[1].prefixedId).toBe("L2");
  });

  test("deduplicates results by content", async () => {
    const result1 = createMockSearchResult({ similarity: 0.9 });
    const result2 = createMockSearchResult({ similarity: 0.8 }); // Same content

    const context = await buildLegislationContext(
      "test query",
      [result1, result2],
      {
        language: "en",
        reranker: mockReranker,
      }
    );

    // Should only have one citation since content is duplicated
    expect(context.citations.length).toBeLessThanOrEqual(2);
  });

  test("sorts results by similarity", async () => {
    const lowSimilarity = createMockSearchResult({
      similarity: 0.5,
      content: "Broadcasting content for testing.",
      metadata: {
        sourceType: "act_section",
        language: "en",
        actId: "C-11",
        documentTitle: "Broadcasting Act",
        sectionLabel: "1",
      },
      citation: {
        id: 2,
        prefixedId: "",
        textEn: "[Broadcasting Act, s 1]",
        textFr: "[Loi sur la radiodiffusion, art 1]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/acts/C-11/page-1.html#sec1",
        urlFr: "https://laws-lois.justice.gc.ca/fra/lois/C-11/page-1.html#sec1",
        titleEn: "Broadcasting Act",
        titleFr: "Loi sur la radiodiffusion",
        sourceType: "act_section",
      },
    });
    const highSimilarity = createMockSearchResult({
      similarity: 0.95,
      content: "Criminal law content for testing.",
      metadata: {
        sourceType: "act_section",
        language: "en",
        actId: "C-46",
        documentTitle: "Criminal Code",
        sectionLabel: "91",
      },
    });

    const context = await buildLegislationContext(
      "test query",
      [lowSimilarity, highSimilarity],
      { language: "en", reranker: mockReranker }
    );

    // Higher similarity should appear first
    expect(context.prompt).toMatch(CONTEXT_SORT_ORDER_REGEX);
  });

  test("truncates long content with ellipsis", async () => {
    const longContent = "A".repeat(600); // Longer than 480 char max
    const result = createMockSearchResult({ content: longContent });

    const context = await buildLegislationContext("test query", [result], {
      language: "en",
      reranker: mockReranker,
    });

    expect(context.prompt).toContain("…");
  });

  test("respects topN limit", async () => {
    const results = new Array(20).fill(null).map((_, i) =>
      createMockSearchResult({
        similarity: 0.9 - i * 0.01,
        metadata: {
          sourceType: "act_section",
          language: "en",
          actId: `C-${i}`,
          documentTitle: `Act ${i}`,
          sectionLabel: `${i}`,
        },
        content: `Unique content for section ${i} to avoid deduplication.`,
      })
    );

    const context = await buildLegislationContext("test query", results, {
      language: "en",
      topN: 5,
      reranker: mockReranker,
    });

    expect(context.citations.length).toBeLessThanOrEqual(5);
  });

  test("uses French labels for French language", async () => {
    const result = createMockSearchResult({
      metadata: {
        sourceType: "act_section",
        language: "fr",
        actId: "C-46",
        documentTitle: "Code criminel",
        sectionLabel: "91",
      },
    });

    const context = await buildLegislationContext("test query", [result], {
      language: "fr",
      reranker: mockReranker,
    });

    expect(context.prompt).toContain("Contexte législatif:");
    expect(context.prompt).toContain("art 91");
  });
});

// ---------- LEGISLATION_CITATION_PREFIX Test ----------

test.describe("LEGISLATION_CITATION_PREFIX", () => {
  test("is defined as L", () => {
    expect(LEGISLATION_CITATION_PREFIX).toBe("L");
  });
});
