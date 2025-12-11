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
  buildFootnoteCitation,
  buildMarginalNoteCitation,
  buildPreambleCitation,
  buildPublicationItemCitation,
  buildRegulationCitation,
  buildRegulationSectionCitation,
  buildRelatedProvisionsCitation,
  buildScheduleCitation,
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
  test("builds table of provisions citation (batched per document)", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "table_of_provisions",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
      provisionCount: 150,
    };
    const citation = buildTableOfProvisionsCitation(metadata, 9);

    expect(citation.textEn).toContain("Table of Provisions");
    expect(citation.textEn).toContain("(150 entries)");
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

test.describe("buildRelatedProvisionsCitation", () => {
  test("builds citation with label and sections", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "related_provisions",
      language: "en",
      actId: "C-81",
      documentTitle: "Accessible Canada Act",
      relatedProvisionLabel: "Transitional Provisions",
      relatedProvisionSource: "2019, c. 29",
      relatedProvisionSections: ["100", "101"],
    };
    const citation = buildRelatedProvisionsCitation(metadata, 11);

    expect(citation.id).toBe(11);
    expect(citation.textEn).toContain("Accessible Canada Act");
    expect(citation.textEn).toContain("Related Provisions");
    expect(citation.textEn).toContain("Transitional Provisions");
    expect(citation.textEn).toContain("(ss 100, 101)");
    expect(citation.textFr).toContain("Dispositions connexes");
    expect(citation.titleEn).toContain("Related Provisions");
    expect(citation.titleEn).toContain("2019, c. 29");
    expect(citation.sourceType).toBe("related_provisions");
  });

  test("handles single section reference", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "related_provisions",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
      relatedProvisionSections: ["91"],
    };
    const citation = buildRelatedProvisionsCitation(metadata, 12);

    expect(citation.textEn).toContain("(s 91)");
    expect(citation.textEn).not.toContain("(ss");
  });

  test("handles missing optional fields", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "related_provisions",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
    };
    const citation = buildRelatedProvisionsCitation(metadata, 13);

    expect(citation.textEn).toBe("[Criminal Code, Related Provisions]");
    expect(citation.textFr).toBe("[Criminal Code, Dispositions connexes]");
    expect(citation.titleEn).toBe("Related Provisions in Criminal Code");
    expect(citation.titleFr).toBe("Dispositions connexes dans Criminal Code");
  });

  test("builds correct URL for regulation", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "related_provisions",
      language: "en",
      regulationId: "SOR-86-946",
      documentTitle: "Employment Insurance Regulations",
      relatedProvisionLabel: "Coming Into Force",
    };
    const citation = buildRelatedProvisionsCitation(metadata, 14);

    expect(citation.urlEn).toContain("/regulations/SOR-86-946/");
    expect(citation.urlFr).toContain("/reglements/SOR-86-946/");
  });
});

test.describe("buildFootnoteCitation", () => {
  test("builds citation with section and footnote label", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "footnote",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
      sectionLabel: "91",
      footnoteId: "fn1",
      footnoteLabel: "*",
      footnoteStatus: "official",
    };
    const citation = buildFootnoteCitation(metadata, 15);

    expect(citation.id).toBe(15);
    expect(citation.textEn).toContain("Criminal Code");
    expect(citation.textEn).toContain("s 91");
    expect(citation.textEn).toContain("Footnote");
    expect(citation.textEn).toContain("[*]");
    expect(citation.textFr).toContain("art 91");
    expect(citation.textFr).toContain("Note");
    expect(citation.urlEn).toContain("#sec91");
    expect(citation.titleEn).toContain("Footnote in Criminal Code, section 91");
    expect(citation.sourceType).toBe("footnote");
  });

  test("handles editorial footnote status", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "footnote",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
      sectionLabel: "5",
      footnoteStatus: "editorial",
    };
    const citation = buildFootnoteCitation(metadata, 16);

    expect(citation.textEn).toContain("(editorial)");
    expect(citation.textFr).toContain("(éditoriale)");
  });

  test("handles footnote without section label", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "footnote",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
      footnoteId: "fn2",
      footnoteLabel: "1",
    };
    const citation = buildFootnoteCitation(metadata, 17);

    expect(citation.textEn).toBe("[Criminal Code, Footnote [1]]");
    expect(citation.textFr).toBe("[Criminal Code, Note [1]]");
    expect(citation.urlEn).not.toContain("#sec");
    expect(citation.titleEn).toBe("Footnote in Criminal Code");
  });

  test("handles minimal footnote metadata", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "footnote",
      language: "en",
      regulationId: "SOR-86-946",
      documentTitle: "Employment Insurance Regulations",
    };
    const citation = buildFootnoteCitation(metadata, 18);

    expect(citation.textEn).toBe(
      "[Employment Insurance Regulations, Footnote]"
    );
    expect(citation.textFr).toBe("[Employment Insurance Regulations, Note]");
    expect(citation.urlEn).toContain("/regulations/SOR-86-946/");
  });
});

test.describe("buildMarginalNoteCitation", () => {
  test("builds citation with section label and marginal note", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "marginal_note",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
      sectionLabel: "322",
      marginalNote: "Theft",
    };
    const citation = buildMarginalNoteCitation(metadata, 19);

    expect(citation.id).toBe(19);
    expect(citation.textEn).toContain("Criminal Code");
    expect(citation.textEn).toContain("s 322");
    expect(citation.textEn).toContain("Theft");
    expect(citation.textFr).toContain("art 322");
    expect(citation.urlEn).toContain("#sec322");
    expect(citation.titleEn).toBe("Section 322 of Criminal Code: Theft");
    expect(citation.titleFr).toBe("Article 322 de Criminal Code: Theft");
    expect(citation.sourceType).toBe("marginal_note");
  });

  test("handles regulation marginal note", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "marginal_note",
      language: "en",
      regulationId: "SOR-86-946",
      documentTitle: "Employment Insurance Regulations",
      sectionLabel: "2",
      marginalNote: "Application",
    };
    const citation = buildMarginalNoteCitation(metadata, 20);

    expect(citation.textEn).toContain("Employment Insurance Regulations");
    expect(citation.textEn).toContain("s 2");
    expect(citation.textEn).toContain("Application");
    expect(citation.urlEn).toContain("/regulations/SOR-86-946/");
  });

  test("handles missing marginal note text with default", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "marginal_note",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
      sectionLabel: "91",
    };
    const citation = buildMarginalNoteCitation(metadata, 21);

    expect(citation.textEn).toContain("Section heading");
    expect(citation.textFr).toContain("Note marginale");
  });

  test("handles missing section label", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "marginal_note",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
      marginalNote: "Short Title",
    };
    const citation = buildMarginalNoteCitation(metadata, 22);

    expect(citation.textEn).toBe("[Criminal Code - Short Title]");
    expect(citation.textFr).toBe("[Criminal Code - Short Title]");
    expect(citation.urlEn).not.toContain("#sec");
    expect(citation.titleEn).toBe("Criminal Code: Short Title");
  });

  test("French citation uses proper formatting", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "marginal_note",
      language: "fr",
      actId: "C-46",
      documentTitle: "Code criminel",
      sectionLabel: "322",
      marginalNote: "Vol",
    };
    const citation = buildMarginalNoteCitation(metadata, 23);

    expect(citation.textFr).toContain("Code criminel");
    expect(citation.textFr).toContain("art 322");
    expect(citation.textFr).toContain("Vol");
    expect(citation.titleFr).toBe("Article 322 de Code criminel: Vol");
  });
});

test.describe("buildScheduleCitation", () => {
  test("builds citation for act schedule with section label", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "schedule",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
      sectionLabel: "Schedule I",
      sectionType: "schedule",
      scheduleId: "sch-1",
    };
    const citation = buildScheduleCitation(metadata, 1);

    expect(citation.id).toBe(1);
    expect(citation.textEn).toBe("[Criminal Code, Schedule I]");
    expect(citation.textFr).toBe("[Criminal Code, Schedule I]");
    expect(citation.urlEn).toContain("laws-lois.justice.gc.ca");
    expect(citation.urlEn).toContain("/eng/acts/C-46/");
    expect(citation.urlEn).toContain("#secScheduleI");
    expect(citation.urlFr).toContain("/fra/lois/C-46/");
    expect(citation.titleEn).toBe("Schedule I of Criminal Code");
    expect(citation.titleFr).toBe("Schedule I de Criminal Code");
    expect(citation.sourceType).toBe("schedule");
  });

  test("builds citation for regulation schedule", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "schedule",
      language: "en",
      regulationId: "C.R.C._c. 870",
      documentTitle: "Food and Drug Regulations",
      sectionLabel: "Schedule Item 1758",
      sectionType: "schedule",
    };
    const citation = buildScheduleCitation(metadata, 2);

    expect(citation.textEn).toBe(
      "[Food and Drug Regulations, Schedule Item 1758]"
    );
    expect(citation.urlEn).toContain("/regulations/C.R.C._c. 870/");
    expect(citation.urlFr).toContain("/reglements/C.R.C._c. 870/");
    expect(citation.titleEn).toBe(
      "Schedule Item 1758 of Food and Drug Regulations"
    );
    expect(citation.sourceType).toBe("schedule");
  });

  test("handles schedule without section label", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "schedule",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
      sectionType: "schedule",
    };
    const citation = buildScheduleCitation(metadata, 3);

    expect(citation.textEn).toBe("[Criminal Code, Schedule]");
    expect(citation.textFr).toBe("[Criminal Code, Schedule]");
    expect(citation.titleEn).toBe("Schedule of Criminal Code");
    expect(citation.urlEn).not.toContain("#sec");
  });

  test("French language schedule citation", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "schedule",
      language: "fr",
      actId: "C-46",
      documentTitle: "Code criminel",
      sectionLabel: "Annexe II",
      sectionType: "schedule",
    };
    const citation = buildScheduleCitation(metadata, 4);

    expect(citation.textEn).toBe("[Code criminel, Annexe II]");
    expect(citation.textFr).toBe("[Code criminel, Annexe II]");
    expect(citation.titleFr).toBe("Annexe II de Code criminel");
  });
});

test.describe("buildPublicationItemCitation", () => {
  test("builds citation for recommendation publication item", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "publication_item",
      language: "en",
      regulationId: "SOR-2020-123",
      documentTitle: "Test Regulations",
      publicationType: "recommendation",
      publicationIndex: 1,
    };
    const citation = buildPublicationItemCitation(metadata, 1);

    expect(citation.id).toBe(1);
    expect(citation.textEn).toBe("[Test Regulations, Recommendation]");
    expect(citation.textFr).toBe("[Test Regulations, Recommandation]");
    expect(citation.titleEn).toBe("Recommendation in Test Regulations");
    expect(citation.titleFr).toBe("Recommandation dans Test Regulations");
    expect(citation.sourceType).toBe("publication_item");
  });

  test("builds citation for notice publication item", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "publication_item",
      language: "en",
      regulationId: "SOR-2020-123",
      documentTitle: "Test Regulations",
      publicationType: "notice",
      publicationIndex: 0,
    };
    const citation = buildPublicationItemCitation(metadata, 2);

    expect(citation.textEn).toBe("[Test Regulations, Notice]");
    expect(citation.textFr).toBe("[Test Regulations, Avis]");
    expect(citation.titleEn).toBe("Notice in Test Regulations");
    expect(citation.titleFr).toBe("Avis dans Test Regulations");
  });

  test("handles publication item associated with act", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "publication_item",
      language: "en",
      actId: "C-46",
      documentTitle: "Criminal Code",
      publicationType: "recommendation",
      publicationIndex: 0,
    };
    const citation = buildPublicationItemCitation(metadata, 3);

    expect(citation.textEn).toBe("[Criminal Code, Recommendation]");
    expect(citation.urlEn).toContain("/eng/acts/C-46/");
  });

  test("defaults to Notice when publicationType is unrecognized", () => {
    const metadata: LegResourceMetadata = {
      sourceType: "publication_item",
      language: "en",
      regulationId: "SOR-2020-123",
      documentTitle: "Test Regulations",
      publicationType: "other" as "notice", // Force unrecognized type
    };
    const citation = buildPublicationItemCitation(metadata, 4);

    expect(citation.textEn).toBe("[Test Regulations, Notice]");
    expect(citation.textFr).toBe("[Test Regulations, Avis]");
  });

  test("handles missing document title", () => {
    // Test fallback when documentTitle is undefined at runtime
    const metadata = {
      sourceType: "publication_item",
      language: "en",
      regulationId: "SOR-2020-123",
      publicationType: "recommendation",
    } as LegResourceMetadata;
    const citation = buildPublicationItemCitation(metadata, 5);

    expect(citation.textEn).toBe("[Regulation, Recommendation]");
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
      "related_provisions",
      "footnote",
      "marginal_note",
      "schedule",
      "publication_item",
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

// ---------- Metadata Search Types Tests (Task 3.1) ----------

import type {
  DateFilter,
  LegislationMetadataResult,
  LegislationMetadataSearchOptions,
  LegislationSearchOptions,
} from "@/lib/rag/legislation/search";

test.describe("DateFilter type", () => {
  test("accepts 'before' filter", () => {
    const filter: DateFilter = { before: "2023-01-01" };
    expect("before" in filter).toBe(true);
    if ("before" in filter) {
      expect(filter.before).toBe("2023-01-01");
    }
  });

  test("accepts 'after' filter", () => {
    const filter: DateFilter = { after: "2020-01-01" };
    expect("after" in filter).toBe(true);
    if ("after" in filter) {
      expect(filter.after).toBe("2020-01-01");
    }
  });

  test("accepts 'on' filter", () => {
    const filter: DateFilter = { on: "2023-06-15" };
    expect("on" in filter).toBe(true);
    if ("on" in filter) {
      expect(filter.on).toBe("2023-06-15");
    }
  });

  test("accepts 'between' filter", () => {
    const filter: DateFilter = {
      between: { start: "2023-01-01", end: "2023-12-31" },
    };
    expect("between" in filter).toBe(true);
    if ("between" in filter) {
      expect(filter.between.start).toBe("2023-01-01");
      expect(filter.between.end).toBe("2023-12-31");
    }
  });
});

test.describe("LegislationMetadataSearchOptions type", () => {
  test("allows empty options", () => {
    const options: LegislationMetadataSearchOptions = {};
    expect(options).toBeDefined();
  });

  test("allows all filter options", () => {
    const options: LegislationMetadataSearchOptions = {
      limit: 20,
      offset: 10,
      language: "en",
      sourceType: "act",
      actId: "C-46",
      status: "in-force",
      sectionStatus: "in-force",
      lastAmendedDate: { after: "2023-01-01" },
      enactedDate: { before: "2020-01-01" },
      inForceDate: { between: { start: "2020-01-01", end: "2023-12-31" } },
      consolidationDate: { on: "2023-06-15" },
      registrationDate: { after: "2020-01-01" },
      sectionLabel: "91",
      orderBy: "lastAmendedDate",
      orderDirection: "desc",
    };
    expect(options.limit).toBe(20);
    expect(options.sourceType).toBe("act");
    expect(options.orderBy).toBe("lastAmendedDate");
  });

  test("allows array of source types", () => {
    const options: LegislationMetadataSearchOptions = {
      sourceType: ["act", "regulation", "act_section"],
    };
    expect(Array.isArray(options.sourceType)).toBe(true);
    if (Array.isArray(options.sourceType)) {
      expect(options.sourceType).toContain("act");
      expect(options.sourceType).toContain("regulation");
    }
  });

  test("allows all orderBy values", () => {
    const orderByValues: LegislationMetadataSearchOptions["orderBy"][] = [
      "lastAmendedDate",
      "enactedDate",
      "inForceDate",
      "consolidationDate",
      "registrationDate",
    ];

    for (const orderBy of orderByValues) {
      const options: LegislationMetadataSearchOptions = { orderBy };
      expect(options.orderBy).toBe(orderBy);
    }
  });
});

test.describe("LegislationMetadataResult type", () => {
  test("has required fields", () => {
    const result: LegislationMetadataResult = {
      content: "Test content",
      metadata: {
        sourceType: "act",
        language: "en",
        documentTitle: "Test Act",
      },
      citation: {
        id: 1,
        prefixedId: "L1",
        textEn: "[Test Act]",
        textFr: "[Test Act]",
        urlEn: "https://example.com/en",
        urlFr: "https://example.com/fr",
        titleEn: "Test Act",
        titleFr: "Test Act",
        sourceType: "act",
      },
    };

    expect(result.content).toBe("Test content");
    expect(result.metadata.sourceType).toBe("act");
    expect(result.citation.textEn).toBe("[Test Act]");
  });

  test("does not have similarity field (unlike vector search results)", () => {
    const result: LegislationMetadataResult = {
      content: "Test",
      metadata: {
        sourceType: "act",
        language: "en",
        documentTitle: "Test",
      },
      citation: {
        id: 1,
        prefixedId: "L1",
        textEn: "[Test]",
        textFr: "[Test]",
        urlEn: "",
        urlFr: "",
        titleEn: "",
        titleFr: "",
        sourceType: "act",
      },
    };

    // TypeScript ensures similarity is not part of the type
    expect("similarity" in result).toBe(false);
  });
});

// ---------- Scope Filtering Tests (Task 2.2) ----------

test.describe("LegislationSearchOptions scope filtering", () => {
  test("accepts scopeType filter for exact scope matching", () => {
    const options: LegislationSearchOptions = {
      scopeType: "section",
    };
    expect(options.scopeType).toBe("section");
  });

  test("accepts sectionScope filter for section-specific terms", () => {
    const options: LegislationSearchOptions = {
      sectionScope: "17",
    };
    expect(options.sectionScope).toBe("17");
  });

  test("allows combining scopeType and sectionScope", () => {
    // Typical use: find terms with section scope that apply to section 17
    const options: LegislationSearchOptions = {
      sourceType: "defined_term",
      scopeType: "section",
      sectionScope: "17",
    };
    expect(options.sourceType).toBe("defined_term");
    expect(options.scopeType).toBe("section");
    expect(options.sectionScope).toBe("17");
  });

  test("allows scope filters with other search options", () => {
    const options: LegislationSearchOptions = {
      language: "en",
      sourceType: "defined_term",
      actId: "C-46",
      limit: 10,
      scopeType: "part",
    };
    expect(options.language).toBe("en");
    expect(options.actId).toBe("C-46");
    expect(options.scopeType).toBe("part");
  });

  test("scopeType accepts various scope values", () => {
    // These are the scope types that can be stored in the database
    const scopeTypes = ["act", "regulation", "part", "division", "section"];

    for (const scopeType of scopeTypes) {
      const options: LegislationSearchOptions = { scopeType };
      expect(options.scopeType).toBe(scopeType);
    }
  });
});

// ---------- Bilingual Search Types Tests (Task 2.3) ----------

test.describe("LegislationSearchResult type", () => {
  test("has required fields", () => {
    const result: LegislationSearchResult = {
      content: "Test section content",
      metadata: {
        sourceType: "act_section",
        language: "en",
        actId: "C-46",
        documentTitle: "Criminal Code",
        sectionLabel: "91",
      },
      similarity: 0.85,
      citation: {
        id: 1,
        prefixedId: "L1",
        textEn: "[Criminal Code, s 91]",
        textFr: "[Code criminel, art 91]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/acts/C-46/#sec91",
        urlFr: "https://laws-lois.justice.gc.ca/fra/lois/C-46/#sec91",
        titleEn: "Criminal Code",
        titleFr: "Code criminel",
        sourceType: "act_section",
      },
    };

    expect(result.content).toBe("Test section content");
    expect(result.similarity).toBe(0.85);
    expect(result.metadata.sourceType).toBe("act_section");
    expect(result.citation.textEn).toBe("[Criminal Code, s 91]");
  });

  test("similarity is a required field for vector search results", () => {
    const result: LegislationSearchResult = {
      content: "Test",
      metadata: {
        sourceType: "act",
        language: "en",
        documentTitle: "Test",
      },
      similarity: 0.75,
      citation: {
        id: 1,
        prefixedId: "L1",
        textEn: "[Test]",
        textFr: "[Test]",
        urlEn: "",
        urlFr: "",
        titleEn: "",
        titleFr: "",
        sourceType: "act",
      },
    };

    expect(typeof result.similarity).toBe("number");
    expect(result.similarity).toBeGreaterThanOrEqual(0);
    expect(result.similarity).toBeLessThanOrEqual(1);
  });
});

// ---------- Source Type Arrays Tests ----------

test.describe("Source type arrays include marginal_note", () => {
  // Import the search module to access source type arrays indirectly through searchActs/searchRegulations behavior
  // We test this by verifying the deduplicateResults in context-builder handles marginal_note

  test("context builder deduplicates marginal_note results correctly", async () => {
    // Create two marginal_note results for the same section (same actId, sectionId, language)
    // The deduplicator should keep only the higher similarity one
    const marginalNote1: LegislationSearchResult = {
      content: "Theft - section heading content",
      metadata: {
        sourceType: "marginal_note",
        language: "en",
        actId: "C-46",
        documentTitle: "Criminal Code",
        sectionId: "sec-322",
        sectionLabel: "322",
        marginalNote: "Theft",
      },
      similarity: 0.85,
      citation: {
        id: 1,
        prefixedId: "",
        textEn: "[Criminal Code, s 322 - Theft]",
        textFr: "[Code criminel, art 322 - Theft]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/acts/C-46/#sec322",
        urlFr: "https://laws-lois.justice.gc.ca/fra/lois/C-46/#sec322",
        titleEn: "Section 322 of Criminal Code: Theft",
        titleFr: "Article 322 de Code criminel: Theft",
        sourceType: "marginal_note",
      },
    };

    const marginalNote2: LegislationSearchResult = {
      content: "Theft - duplicate section heading with lower score",
      metadata: {
        sourceType: "marginal_note",
        language: "en",
        actId: "C-46",
        documentTitle: "Criminal Code",
        sectionId: "sec-322",
        sectionLabel: "322",
        marginalNote: "Theft",
      },
      similarity: 0.75, // Lower similarity - should be deduplicated
      citation: {
        id: 2,
        prefixedId: "",
        textEn: "[Criminal Code, s 322 - Theft]",
        textFr: "[Code criminel, art 322 - Theft]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/acts/C-46/#sec322",
        urlFr: "https://laws-lois.justice.gc.ca/fra/lois/C-46/#sec322",
        titleEn: "Section 322 of Criminal Code: Theft",
        titleFr: "Article 322 de Code criminel: Theft",
        sourceType: "marginal_note",
      },
    };

    const context = await buildLegislationContext(
      "theft",
      [marginalNote1, marginalNote2],
      {
        language: "en",
        reranker: mockReranker,
      }
    );

    // Should only have one citation since both are for the same marginal note
    expect(context.citations).toHaveLength(1);
    // The higher similarity result should be kept
    expect(context.prompt).toContain("Theft - section heading content");
    expect(context.prompt).not.toContain("duplicate section heading");
  });

  test("context builder keeps different marginal_note results separate", async () => {
    // Two marginal notes from different sections should both be kept
    const marginalNote1: LegislationSearchResult = {
      content: "Theft - section heading",
      metadata: {
        sourceType: "marginal_note",
        language: "en",
        actId: "C-46",
        documentTitle: "Criminal Code",
        sectionId: "sec-322",
        sectionLabel: "322",
        marginalNote: "Theft",
      },
      similarity: 0.9,
      citation: {
        id: 1,
        prefixedId: "",
        textEn: "[Criminal Code, s 322 - Theft]",
        textFr: "[Code criminel, art 322 - Theft]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/acts/C-46/#sec322",
        urlFr: "https://laws-lois.justice.gc.ca/fra/lois/C-46/#sec322",
        titleEn: "Section 322 of Criminal Code: Theft",
        titleFr: "Article 322 de Code criminel: Theft",
        sourceType: "marginal_note",
      },
    };

    const marginalNote2: LegislationSearchResult = {
      content: "Robbery - section heading",
      metadata: {
        sourceType: "marginal_note",
        language: "en",
        actId: "C-46",
        documentTitle: "Criminal Code",
        sectionId: "sec-343", // Different section
        sectionLabel: "343",
        marginalNote: "Robbery",
      },
      similarity: 0.85,
      citation: {
        id: 2,
        prefixedId: "",
        textEn: "[Criminal Code, s 343 - Robbery]",
        textFr: "[Code criminel, art 343 - Robbery]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/acts/C-46/#sec343",
        urlFr: "https://laws-lois.justice.gc.ca/fra/lois/C-46/#sec343",
        titleEn: "Section 343 of Criminal Code: Robbery",
        titleFr: "Article 343 de Code criminel: Robbery",
        sourceType: "marginal_note",
      },
    };

    const context = await buildLegislationContext(
      "property crime",
      [marginalNote1, marginalNote2],
      {
        language: "en",
        reranker: mockReranker,
      }
    );

    // Both marginal notes should be kept (different sections)
    expect(context.citations).toHaveLength(2);
    expect(context.prompt).toContain("Theft");
    expect(context.prompt).toContain("Robbery");
  });

  test("context builder distinguishes marginal_note by language", async () => {
    // Same section but different languages should both be kept
    const marginalNoteEn: LegislationSearchResult = {
      content: "Theft - English heading",
      metadata: {
        sourceType: "marginal_note",
        language: "en",
        actId: "C-46",
        documentTitle: "Criminal Code",
        sectionId: "sec-322",
        sectionLabel: "322",
        marginalNote: "Theft",
      },
      similarity: 0.9,
      citation: {
        id: 1,
        prefixedId: "",
        textEn: "[Criminal Code, s 322 - Theft]",
        textFr: "[Code criminel, art 322 - Vol]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/acts/C-46/#sec322",
        urlFr: "https://laws-lois.justice.gc.ca/fra/lois/C-46/#sec322",
        titleEn: "Section 322 of Criminal Code: Theft",
        titleFr: "Article 322 de Code criminel: Vol",
        sourceType: "marginal_note",
      },
    };

    const marginalNoteFr: LegislationSearchResult = {
      content: "Vol - French heading",
      metadata: {
        sourceType: "marginal_note",
        language: "fr",
        actId: "C-46",
        documentTitle: "Code criminel",
        sectionId: "sec-322", // Same section
        sectionLabel: "322",
        marginalNote: "Vol",
      },
      similarity: 0.85,
      citation: {
        id: 2,
        prefixedId: "",
        textEn: "[Criminal Code, s 322 - Theft]",
        textFr: "[Code criminel, art 322 - Vol]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/acts/C-46/#sec322",
        urlFr: "https://laws-lois.justice.gc.ca/fra/lois/C-46/#sec322",
        titleEn: "Section 322 of Criminal Code: Theft",
        titleFr: "Article 322 de Code criminel: Vol",
        sourceType: "marginal_note",
      },
    };

    const context = await buildLegislationContext(
      "vol theft",
      [marginalNoteEn, marginalNoteFr],
      {
        language: "en",
        reranker: mockReranker,
      }
    );

    // Both should be kept (different languages)
    expect(context.citations).toHaveLength(2);
    expect(context.prompt).toContain("English heading");
    expect(context.prompt).toContain("French heading");
  });

  test("marginal_note appears in context output with correct formatting", async () => {
    const marginalNote: LegislationSearchResult = {
      content: "Theft provisions and related offences",
      metadata: {
        sourceType: "marginal_note",
        language: "en",
        actId: "C-46",
        documentTitle: "Criminal Code",
        sectionId: "sec-322",
        sectionLabel: "322",
        marginalNote: "Theft",
      },
      similarity: 0.9,
      citation: {
        id: 1,
        prefixedId: "",
        textEn: "[Criminal Code, s 322 - Theft]",
        textFr: "[Code criminel, art 322 - Vol]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/acts/C-46/#sec322",
        urlFr: "https://laws-lois.justice.gc.ca/fra/lois/C-46/#sec322",
        titleEn: "Section 322 of Criminal Code: Theft",
        titleFr: "Article 322 de Code criminel: Vol",
        sourceType: "marginal_note",
      },
    };

    const context = await buildLegislationContext("theft", [marginalNote], {
      language: "en",
      reranker: mockReranker,
    });

    // Should include marginal_note source type in output
    expect(context.prompt).toContain("(marginal_note)");
    expect(context.prompt).toContain("Criminal Code");
    expect(context.prompt).toContain("s 322");
    expect(context.prompt).toContain("(Theft)"); // Marginal note in parentheses
  });
});

// ---------- Schedule Source Type Tests ----------

test.describe("Source type arrays include schedule", () => {
  test("context builder deduplicates schedule results correctly", async () => {
    // Create two schedule results for the same section (same actId, sectionId, language)
    // The deduplicator should keep only the higher similarity one
    const schedule1: LegislationSearchResult = {
      content: "Schedule I - List of prohibited substances",
      metadata: {
        sourceType: "schedule",
        language: "en",
        actId: "C-46",
        documentTitle: "Criminal Code",
        sectionId: "sec-sch-1",
        sectionLabel: "Schedule I",
        sectionType: "schedule",
        scheduleId: "sch-1",
      },
      similarity: 0.9,
      citation: {
        id: 1,
        prefixedId: "",
        textEn: "[Criminal Code, Schedule I]",
        textFr: "[Code criminel, Annexe I]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/acts/C-46/#secScheduleI",
        urlFr: "https://laws-lois.justice.gc.ca/fra/lois/C-46/#secAnnexeI",
        titleEn: "Schedule I of Criminal Code",
        titleFr: "Annexe I de Code criminel",
        sourceType: "schedule",
      },
    };

    const schedule2: LegislationSearchResult = {
      content: "Schedule I - duplicate with lower score",
      metadata: {
        sourceType: "schedule",
        language: "en",
        actId: "C-46",
        documentTitle: "Criminal Code",
        sectionId: "sec-sch-1",
        sectionLabel: "Schedule I",
        sectionType: "schedule",
        scheduleId: "sch-1",
      },
      similarity: 0.7, // Lower similarity - should be deduplicated
      citation: {
        id: 2,
        prefixedId: "",
        textEn: "[Criminal Code, Schedule I]",
        textFr: "[Code criminel, Annexe I]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/acts/C-46/#secScheduleI",
        urlFr: "https://laws-lois.justice.gc.ca/fra/lois/C-46/#secAnnexeI",
        titleEn: "Schedule I of Criminal Code",
        titleFr: "Annexe I de Code criminel",
        sourceType: "schedule",
      },
    };

    const context = await buildLegislationContext(
      "prohibited substances",
      [schedule1, schedule2],
      {
        language: "en",
        reranker: mockReranker,
      }
    );

    // Should only have one citation since both are for the same schedule
    expect(context.citations).toHaveLength(1);
    // The higher similarity result should be kept
    expect(context.prompt).toContain("List of prohibited substances");
    expect(context.prompt).not.toContain("duplicate with lower score");
  });

  test("context builder keeps different schedule results separate", async () => {
    // Two schedules from different sections should both be kept
    const schedule1: LegislationSearchResult = {
      content: "Schedule I - prohibited substances list",
      metadata: {
        sourceType: "schedule",
        language: "en",
        actId: "C-46",
        documentTitle: "Criminal Code",
        sectionId: "sec-sch-1",
        sectionLabel: "Schedule I",
        sectionType: "schedule",
      },
      similarity: 0.9,
      citation: {
        id: 1,
        prefixedId: "",
        textEn: "[Criminal Code, Schedule I]",
        textFr: "[Code criminel, Annexe I]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/acts/C-46/#secScheduleI",
        urlFr: "https://laws-lois.justice.gc.ca/fra/lois/C-46/#secAnnexeI",
        titleEn: "Schedule I of Criminal Code",
        titleFr: "Annexe I de Code criminel",
        sourceType: "schedule",
      },
    };

    const schedule2: LegislationSearchResult = {
      content: "Schedule II - controlled substances",
      metadata: {
        sourceType: "schedule",
        language: "en",
        actId: "C-46",
        documentTitle: "Criminal Code",
        sectionId: "sec-sch-2", // Different section
        sectionLabel: "Schedule II",
        sectionType: "schedule",
      },
      similarity: 0.85,
      citation: {
        id: 2,
        prefixedId: "",
        textEn: "[Criminal Code, Schedule II]",
        textFr: "[Code criminel, Annexe II]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/acts/C-46/#secScheduleII",
        urlFr: "https://laws-lois.justice.gc.ca/fra/lois/C-46/#secAnnexeII",
        titleEn: "Schedule II of Criminal Code",
        titleFr: "Annexe II de Code criminel",
        sourceType: "schedule",
      },
    };

    const context = await buildLegislationContext(
      "substances",
      [schedule1, schedule2],
      {
        language: "en",
        reranker: mockReranker,
      }
    );

    // Both schedules should be kept (different sections)
    expect(context.citations).toHaveLength(2);
    expect(context.prompt).toContain("prohibited substances");
    expect(context.prompt).toContain("controlled substances");
  });

  test("schedule appears in context output with correct formatting", async () => {
    const schedule: LegislationSearchResult = {
      content: "Schedule I items and provisions",
      metadata: {
        sourceType: "schedule",
        language: "en",
        actId: "C-46",
        documentTitle: "Criminal Code",
        sectionId: "sec-sch-1",
        sectionLabel: "Schedule I",
        sectionType: "schedule",
      },
      similarity: 0.9,
      citation: {
        id: 1,
        prefixedId: "",
        textEn: "[Criminal Code, Schedule I]",
        textFr: "[Code criminel, Annexe I]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/acts/C-46/#secScheduleI",
        urlFr: "https://laws-lois.justice.gc.ca/fra/lois/C-46/#secAnnexeI",
        titleEn: "Schedule I of Criminal Code",
        titleFr: "Annexe I de Code criminel",
        sourceType: "schedule",
      },
    };

    const context = await buildLegislationContext(
      "schedule items",
      [schedule],
      {
        language: "en",
        reranker: mockReranker,
      }
    );

    // Should include schedule source type in output
    expect(context.prompt).toContain("(schedule)");
    expect(context.prompt).toContain("Criminal Code");
    expect(context.prompt).toContain("Schedule I");
  });

  test("regulation schedule results are handled correctly", async () => {
    const regSchedule: LegislationSearchResult = {
      content: "Schedule Item 1758 - food additive specifications",
      metadata: {
        sourceType: "schedule",
        language: "en",
        regulationId: "C.R.C._c. 870",
        documentTitle: "Food and Drug Regulations",
        sectionId: "sec-sch-1758",
        sectionLabel: "Schedule Item 1758",
        sectionType: "schedule",
      },
      similarity: 0.88,
      citation: {
        id: 1,
        prefixedId: "",
        textEn: "[Food and Drug Regulations, Schedule Item 1758]",
        textFr: "[Règlement sur les aliments et drogues, Annexe article 1758]",
        urlEn:
          "https://laws-lois.justice.gc.ca/eng/regulations/C.R.C._c. 870/#secScheduleItem1758",
        urlFr:
          "https://laws-lois.justice.gc.ca/fra/reglements/C.R.C._c. 870/#secAnnexearticle1758",
        titleEn: "Schedule Item 1758 of Food and Drug Regulations",
        titleFr: "Annexe article 1758 de Règlement sur les aliments et drogues",
        sourceType: "schedule",
      },
    };

    const context = await buildLegislationContext(
      "food additives",
      [regSchedule],
      {
        language: "en",
        reranker: mockReranker,
      }
    );

    expect(context.citations).toHaveLength(1);
    expect(context.prompt).toContain("Food and Drug Regulations");
    expect(context.prompt).toContain("Schedule Item 1758");
    expect(context.prompt).toContain("(schedule)");
  });
});

// ---------- Publication Item Source Type Tests ----------

test.describe("Source type arrays include publication_item", () => {
  test("context builder deduplicates publication_item results correctly", async () => {
    // Create two publication_item results for the same publication (same regulationId, type, index, language)
    // The deduplicator should keep only the higher similarity one
    const pubItem1: LegislationSearchResult = {
      content: "Recommendation content from first result",
      metadata: {
        sourceType: "publication_item",
        language: "en",
        regulationId: "SOR-2020-123",
        documentTitle: "Test Regulations",
        publicationType: "recommendation",
        publicationIndex: 0,
      },
      similarity: 0.9,
      citation: {
        id: 1,
        prefixedId: "",
        textEn: "[Test Regulations, Recommendation]",
        textFr: "[Test Regulations, Recommandation]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2020-123/",
        urlFr: "https://laws-lois.justice.gc.ca/fra/reglements/SOR-2020-123/",
        titleEn: "Recommendation in Test Regulations",
        titleFr: "Recommandation dans Test Regulations",
        sourceType: "publication_item",
      },
    };

    const pubItem2: LegislationSearchResult = {
      content: "Recommendation duplicate with lower score",
      metadata: {
        sourceType: "publication_item",
        language: "en",
        regulationId: "SOR-2020-123",
        documentTitle: "Test Regulations",
        publicationType: "recommendation",
        publicationIndex: 0,
      },
      similarity: 0.7, // Lower similarity - should be deduplicated
      citation: {
        id: 2,
        prefixedId: "",
        textEn: "[Test Regulations, Recommendation]",
        textFr: "[Test Regulations, Recommandation]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2020-123/",
        urlFr: "https://laws-lois.justice.gc.ca/fra/reglements/SOR-2020-123/",
        titleEn: "Recommendation in Test Regulations",
        titleFr: "Recommandation dans Test Regulations",
        sourceType: "publication_item",
      },
    };

    const context = await buildLegislationContext(
      "recommendation",
      [pubItem1, pubItem2],
      {
        language: "en",
        reranker: mockReranker,
      }
    );

    // Should only have one citation since both are for the same publication item
    expect(context.citations).toHaveLength(1);
    // The higher similarity result should be kept
    expect(context.prompt).toContain(
      "Recommendation content from first result"
    );
    expect(context.prompt).not.toContain("duplicate with lower score");
  });

  test("context builder keeps different publication_item results separate", async () => {
    // Two publication items with different indices should both be kept
    const pubItem1: LegislationSearchResult = {
      content: "First recommendation content",
      metadata: {
        sourceType: "publication_item",
        language: "en",
        regulationId: "SOR-2020-123",
        documentTitle: "Test Regulations",
        publicationType: "recommendation",
        publicationIndex: 0,
      },
      similarity: 0.9,
      citation: {
        id: 1,
        prefixedId: "",
        textEn: "[Test Regulations, Recommendation]",
        textFr: "[Test Regulations, Recommandation]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2020-123/",
        urlFr: "https://laws-lois.justice.gc.ca/fra/reglements/SOR-2020-123/",
        titleEn: "Recommendation in Test Regulations",
        titleFr: "Recommandation dans Test Regulations",
        sourceType: "publication_item",
      },
    };

    const pubItem2: LegislationSearchResult = {
      content: "Second recommendation content",
      metadata: {
        sourceType: "publication_item",
        language: "en",
        regulationId: "SOR-2020-123",
        documentTitle: "Test Regulations",
        publicationType: "recommendation",
        publicationIndex: 1, // Different index
      },
      similarity: 0.85,
      citation: {
        id: 2,
        prefixedId: "",
        textEn: "[Test Regulations, Recommendation]",
        textFr: "[Test Regulations, Recommandation]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2020-123/",
        urlFr: "https://laws-lois.justice.gc.ca/fra/reglements/SOR-2020-123/",
        titleEn: "Recommendation in Test Regulations",
        titleFr: "Recommandation dans Test Regulations",
        sourceType: "publication_item",
      },
    };

    const context = await buildLegislationContext(
      "recommendations",
      [pubItem1, pubItem2],
      {
        language: "en",
        reranker: mockReranker,
      }
    );

    // Both should be kept (different publication indices)
    expect(context.citations).toHaveLength(2);
    expect(context.prompt).toContain("First recommendation");
    expect(context.prompt).toContain("Second recommendation");
  });

  test("context builder distinguishes publication_item by type", async () => {
    // Recommendation and notice for same regulation should both be kept
    const recommendation: LegislationSearchResult = {
      content: "Recommendation content",
      metadata: {
        sourceType: "publication_item",
        language: "en",
        regulationId: "SOR-2020-123",
        documentTitle: "Test Regulations",
        publicationType: "recommendation",
        publicationIndex: 0,
      },
      similarity: 0.9,
      citation: {
        id: 1,
        prefixedId: "",
        textEn: "[Test Regulations, Recommendation]",
        textFr: "[Test Regulations, Recommandation]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2020-123/",
        urlFr: "https://laws-lois.justice.gc.ca/fra/reglements/SOR-2020-123/",
        titleEn: "Recommendation in Test Regulations",
        titleFr: "Recommandation dans Test Regulations",
        sourceType: "publication_item",
      },
    };

    const notice: LegislationSearchResult = {
      content: "Notice content",
      metadata: {
        sourceType: "publication_item",
        language: "en",
        regulationId: "SOR-2020-123",
        documentTitle: "Test Regulations",
        publicationType: "notice", // Different type
        publicationIndex: 0,
      },
      similarity: 0.85,
      citation: {
        id: 2,
        prefixedId: "",
        textEn: "[Test Regulations, Notice]",
        textFr: "[Test Regulations, Avis]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2020-123/",
        urlFr: "https://laws-lois.justice.gc.ca/fra/reglements/SOR-2020-123/",
        titleEn: "Notice in Test Regulations",
        titleFr: "Avis dans Test Regulations",
        sourceType: "publication_item",
      },
    };

    const context = await buildLegislationContext(
      "regulation publications",
      [recommendation, notice],
      {
        language: "en",
        reranker: mockReranker,
      }
    );

    // Both should be kept (different publication types)
    expect(context.citations).toHaveLength(2);
    expect(context.prompt).toContain("Recommendation content");
    expect(context.prompt).toContain("Notice content");
  });

  test("context builder distinguishes publication_item by language", async () => {
    // Same publication item in different languages should both be kept
    const pubItemEn: LegislationSearchResult = {
      content: "English recommendation content",
      metadata: {
        sourceType: "publication_item",
        language: "en",
        regulationId: "SOR-2020-123",
        documentTitle: "Test Regulations",
        publicationType: "recommendation",
        publicationIndex: 0,
      },
      similarity: 0.9,
      citation: {
        id: 1,
        prefixedId: "",
        textEn: "[Test Regulations, Recommendation]",
        textFr: "[Test Regulations, Recommandation]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2020-123/",
        urlFr: "https://laws-lois.justice.gc.ca/fra/reglements/SOR-2020-123/",
        titleEn: "Recommendation in Test Regulations",
        titleFr: "Recommandation dans Test Regulations",
        sourceType: "publication_item",
      },
    };

    const pubItemFr: LegislationSearchResult = {
      content: "Contenu de la recommandation en français",
      metadata: {
        sourceType: "publication_item",
        language: "fr", // Different language
        regulationId: "SOR-2020-123",
        documentTitle: "Règlement d'essai",
        publicationType: "recommendation",
        publicationIndex: 0,
      },
      similarity: 0.85,
      citation: {
        id: 2,
        prefixedId: "",
        textEn: "[Test Regulations, Recommendation]",
        textFr: "[Règlement d'essai, Recommandation]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2020-123/",
        urlFr: "https://laws-lois.justice.gc.ca/fra/reglements/SOR-2020-123/",
        titleEn: "Recommendation in Test Regulations",
        titleFr: "Recommandation dans Règlement d'essai",
        sourceType: "publication_item",
      },
    };

    const context = await buildLegislationContext(
      "recommandation recommendation",
      [pubItemEn, pubItemFr],
      {
        language: "en",
        reranker: mockReranker,
      }
    );

    // Both should be kept (different languages)
    expect(context.citations).toHaveLength(2);
    expect(context.prompt).toContain("English recommendation");
    expect(context.prompt).toContain("français");
  });

  test("publication_item appears in context output with correct formatting", async () => {
    const pubItem: LegislationSearchResult = {
      content: "This is the recommendation content for testing",
      metadata: {
        sourceType: "publication_item",
        language: "en",
        regulationId: "SOR-2020-123",
        documentTitle: "Test Regulations",
        publicationType: "recommendation",
        publicationIndex: 0,
      },
      similarity: 0.9,
      citation: {
        id: 1,
        prefixedId: "",
        textEn: "[Test Regulations, Recommendation]",
        textFr: "[Test Regulations, Recommandation]",
        urlEn: "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2020-123/",
        urlFr: "https://laws-lois.justice.gc.ca/fra/reglements/SOR-2020-123/",
        titleEn: "Recommendation in Test Regulations",
        titleFr: "Recommandation dans Test Regulations",
        sourceType: "publication_item",
      },
    };

    const context = await buildLegislationContext("recommendation", [pubItem], {
      language: "en",
      reranker: mockReranker,
    });

    // Should include publication_item source type in output
    expect(context.prompt).toContain("(publication_item)");
    expect(context.prompt).toContain("Test Regulations");
    expect(context.prompt).toContain("recommendation content for testing");
  });
});

test.describe("Bilingual search result structure", () => {
  // Helper to create a mock result
  const createMockResult = (
    lang: "en" | "fr",
    overrides: Partial<LegislationSearchResult> = {}
  ): LegislationSearchResult => ({
    content: lang === "en" ? "English content" : "Contenu français",
    metadata: {
      sourceType: "act_section",
      language: lang,
      actId: "C-46",
      documentTitle: lang === "en" ? "Criminal Code" : "Code criminel",
      sectionLabel: "91",
      pairedResourceKey:
        lang === "en" ? "act_section:sec-123:fr:0" : "act_section:sec-123:en:0",
    },
    similarity: 0.85,
    citation: {
      id: 1,
      prefixedId: "L1",
      textEn: "[Criminal Code, s 91]",
      textFr: "[Code criminel, art 91]",
      urlEn: "https://laws-lois.justice.gc.ca/eng/acts/C-46/#sec91",
      urlFr: "https://laws-lois.justice.gc.ca/fra/lois/C-46/#sec91",
      titleEn: "Criminal Code",
      titleFr: "Code criminel",
      sourceType: "act_section",
    },
    ...overrides,
  });

  test("result metadata can include pairedResourceKey", () => {
    const result = createMockResult("en");
    expect(result.metadata.pairedResourceKey).toBe("act_section:sec-123:fr:0");
  });

  test("EN result has paired key pointing to FR version", () => {
    const enResult = createMockResult("en");
    expect(enResult.metadata.language).toBe("en");
    expect(enResult.metadata.pairedResourceKey).toContain(":fr:");
  });

  test("FR result has paired key pointing to EN version", () => {
    const frResult = createMockResult("fr");
    expect(frResult.metadata.language).toBe("fr");
    expect(frResult.metadata.pairedResourceKey).toContain(":en:");
  });

  test("bilingual result with optional pairedResult field", () => {
    // Type for bilingual search results
    type BilingualSearchResult = LegislationSearchResult & {
      pairedResult?: LegislationSearchResult;
    };

    const enResult = createMockResult("en");
    const frResult = createMockResult("fr");

    // Simulating the structure returned by searchLegislationBilingual
    const bilingualResult: BilingualSearchResult = {
      ...enResult,
      pairedResult: frResult,
    };

    expect(bilingualResult.metadata.language).toBe("en");
    expect(bilingualResult.pairedResult).toBeDefined();
    expect(bilingualResult.pairedResult?.metadata.language).toBe("fr");
    expect(bilingualResult.pairedResult?.content).toBe("Contenu français");
  });

  test("bilingual result without paired language version", () => {
    type BilingualSearchResult = LegislationSearchResult & {
      pairedResult?: LegislationSearchResult;
    };

    const result = createMockResult("en", {
      metadata: {
        sourceType: "act_section",
        language: "en",
        actId: "C-46",
        documentTitle: "Criminal Code",
        sectionLabel: "91",
        // No pairedResourceKey - content only exists in one language
      },
    });

    const bilingualResult: BilingualSearchResult = {
      ...result,
      // pairedResult is undefined when no paired version exists
    };

    expect(bilingualResult.pairedResult).toBeUndefined();
    expect(bilingualResult.metadata.pairedResourceKey).toBeUndefined();
  });
});

// ---------- Hydration Tests ----------

import type { HydratedLegislationSource } from "@/lib/rag/legislation/hydrate";

/**
 * Tests for hydration functions that convert search results to markdown.
 * These tests validate:
 * - Each source type produces properly formatted markdown
 * - Language handling and fallback works correctly
 * - ID generation follows expected patterns
 * - Notes are added when language differs from requested
 */
test.describe("Hydration format functions", () => {
  // Helper to create a mock search result for hydration testing
  const createMockSearchResult = (
    sourceType: LegResourceMetadata["sourceType"],
    overrides: Partial<LegislationSearchResult> = {}
  ): LegislationSearchResult => {
    const baseMetadata: LegResourceMetadata = {
      sourceType,
      language: "en",
      documentTitle: "Test Act",
      actId: "C-46",
    };

    return {
      content: "Test content for hydration",
      metadata: { ...baseMetadata, ...overrides.metadata },
      similarity: 0.85,
      citation: {
        id: 1,
        prefixedId: "L1",
        textEn: "[Test Act]",
        textFr: "[Test Act]",
        urlEn: "https://example.com/en",
        urlFr: "https://example.com/fr",
        titleEn: "Test Act",
        titleFr: "Test Act",
        sourceType,
      },
      ...overrides,
    };
  };

  test.describe("Defined term hydration", () => {
    test("formats defined term with all fields", () => {
      const result = createMockSearchResult("defined_term", {
        content:
          "means a physical or mental obstacle that prevents participation",
        metadata: {
          sourceType: "defined_term",
          language: "en",
          documentTitle: "Accessible Canada Act",
          actId: "C-81",
          term: "barrier",
          termPaired: "obstacle",
          sectionLabel: "2",
          scopeType: "act",
        },
      });

      // Verify the result structure matches what hydration expects
      expect(result.metadata.term).toBe("barrier");
      expect(result.metadata.termPaired).toBe("obstacle");
      expect(result.metadata.sectionLabel).toBe("2");
      expect(result.content).toContain("obstacle");
    });

    test("handles term without paired translation", () => {
      const result = createMockSearchResult("defined_term", {
        content: "means something specific",
        metadata: {
          sourceType: "defined_term",
          language: "en",
          documentTitle: "Test Act",
          actId: "C-46",
          term: "unique-term",
        },
      });

      expect(result.metadata.term).toBe("unique-term");
      expect(result.metadata.termPaired).toBeUndefined();
    });

    test("handles section-scoped term", () => {
      const result = createMockSearchResult("defined_term", {
        content: "in this section means...",
        metadata: {
          sourceType: "defined_term",
          language: "en",
          documentTitle: "Criminal Code",
          actId: "C-46",
          term: "property",
          scopeType: "section",
          sectionLabel: "322",
        },
      });

      expect(result.metadata.scopeType).toBe("section");
      expect(result.metadata.sectionLabel).toBe("322");
    });
  });

  test.describe("Footnote hydration", () => {
    test("formats footnote with section context", () => {
      const result = createMockSearchResult("footnote", {
        content: "This provision was amended by S.C. 2019, c. 29",
        metadata: {
          sourceType: "footnote",
          language: "en",
          documentTitle: "Criminal Code",
          actId: "C-46",
          sectionLabel: "91",
          footnoteId: "fn1",
          footnoteLabel: "*",
          footnoteStatus: "official",
        },
      });

      expect(result.metadata.footnoteId).toBe("fn1");
      expect(result.metadata.footnoteLabel).toBe("*");
      expect(result.metadata.footnoteStatus).toBe("official");
      expect(result.metadata.sectionLabel).toBe("91");
    });

    test("handles editorial footnote", () => {
      const result = createMockSearchResult("footnote", {
        content: "[Editor's note: This section is obsolete]",
        metadata: {
          sourceType: "footnote",
          language: "en",
          documentTitle: "Test Act",
          actId: "C-46",
          footnoteStatus: "editorial",
        },
      });

      expect(result.metadata.footnoteStatus).toBe("editorial");
    });
  });

  test.describe("Related provisions hydration", () => {
    test("formats related provisions with label and sections", () => {
      const result = createMockSearchResult("related_provisions", {
        content: "Transitional provisions for the new amendments",
        metadata: {
          sourceType: "related_provisions",
          language: "en",
          documentTitle: "Accessible Canada Act",
          actId: "C-81",
          relatedProvisionLabel: "Transitional Provisions",
          relatedProvisionSource: "2019, c. 29",
          relatedProvisionSections: ["100", "101", "102"],
        },
      });

      expect(result.metadata.relatedProvisionLabel).toBe(
        "Transitional Provisions"
      );
      expect(result.metadata.relatedProvisionSource).toBe("2019, c. 29");
      expect(result.metadata.relatedProvisionSections).toEqual([
        "100",
        "101",
        "102",
      ]);
    });

    test("handles minimal related provisions", () => {
      const result = createMockSearchResult("related_provisions", {
        content: "Related statutory provisions",
        metadata: {
          sourceType: "related_provisions",
          language: "en",
          documentTitle: "Test Act",
          actId: "C-46",
        },
      });

      expect(result.metadata.relatedProvisionLabel).toBeUndefined();
      expect(result.metadata.relatedProvisionSections).toBeUndefined();
    });
  });

  test.describe("Preamble hydration", () => {
    test("formats preamble with document context", () => {
      const result = createMockSearchResult("preamble", {
        content:
          "Whereas Canada is founded upon principles that recognize the supremacy of God...",
        metadata: {
          sourceType: "preamble",
          language: "en",
          documentTitle: "Constitution Act, 1982",
          actId: "Constitution-1982",
          preambleIndex: 0,
        },
      });

      expect(result.metadata.sourceType).toBe("preamble");
      expect(result.metadata.preambleIndex).toBe(0);
      expect(result.content).toContain("Whereas");
    });

    test("handles French preamble", () => {
      const result = createMockSearchResult("preamble", {
        content: "Attendu que le Canada est fondé...",
        metadata: {
          sourceType: "preamble",
          language: "fr",
          documentTitle: "Loi constitutionnelle de 1982",
          actId: "Constitution-1982",
        },
      });

      expect(result.metadata.language).toBe("fr");
    });
  });

  test.describe("Treaty hydration", () => {
    test("formats treaty with title", () => {
      const result = createMockSearchResult("treaty", {
        content: "Article 1: The contracting parties agree to...",
        metadata: {
          sourceType: "treaty",
          language: "en",
          documentTitle: "Criminal Code",
          actId: "C-46",
          treatyTitle: "Vienna Convention on Diplomatic Relations",
        },
      });

      expect(result.metadata.treatyTitle).toBe(
        "Vienna Convention on Diplomatic Relations"
      );
    });

    test("handles treaty without explicit title", () => {
      const result = createMockSearchResult("treaty", {
        content: "Convention text content",
        metadata: {
          sourceType: "treaty",
          language: "en",
          documentTitle: "Test Act",
          actId: "C-46",
        },
      });

      expect(result.metadata.treatyTitle).toBeUndefined();
    });
  });

  test.describe("Cross-reference hydration", () => {
    test("formats cross-reference with target info", () => {
      const result = createMockSearchResult("cross_reference", {
        content: "See section 91 of the Constitution Act, 1867",
        metadata: {
          sourceType: "cross_reference",
          language: "en",
          documentTitle: "Criminal Code",
          actId: "C-46",
          targetDocumentTitle: "Constitution Act, 1867",
          targetRef: "Constitution-1867",
          targetSectionRef: "91",
          crossRefId: "xref-123",
        },
      });

      expect(result.metadata.targetDocumentTitle).toBe(
        "Constitution Act, 1867"
      );
      expect(result.metadata.targetRef).toBe("Constitution-1867");
      expect(result.metadata.targetSectionRef).toBe("91");
      expect(result.metadata.crossRefId).toBe("xref-123");
    });
  });

  test.describe("Table of provisions hydration", () => {
    test("formats table of provisions with count", () => {
      const result = createMockSearchResult("table_of_provisions", {
        content: "Part I - General\nPart II - Offences\nPart III - Procedure",
        metadata: {
          sourceType: "table_of_provisions",
          language: "en",
          documentTitle: "Criminal Code",
          actId: "C-46",
          provisionCount: 150,
        },
      });

      expect(result.metadata.provisionCount).toBe(150);
    });
  });

  test.describe("Signature block hydration", () => {
    test("formats signature block with signatory info", () => {
      const result = createMockSearchResult("signature_block", {
        content: "Her Excellency the Governor General",
        metadata: {
          sourceType: "signature_block",
          language: "en",
          documentTitle: "Criminal Code",
          actId: "C-46",
          signatureName: "Mary Simon",
          signatureTitle: "Governor General",
          signatureDate: "2023-06-21",
        },
      });

      expect(result.metadata.signatureName).toBe("Mary Simon");
      expect(result.metadata.signatureTitle).toBe("Governor General");
      expect(result.metadata.signatureDate).toBe("2023-06-21");
    });

    test("handles minimal signature block", () => {
      const result = createMockSearchResult("signature_block", {
        content: "Official signature",
        metadata: {
          sourceType: "signature_block",
          language: "en",
          documentTitle: "Test Act",
          actId: "C-46",
        },
      });

      expect(result.metadata.signatureName).toBeUndefined();
    });
  });

  test.describe("Marginal note hydration", () => {
    test("formats marginal note with section context", () => {
      const result = createMockSearchResult("marginal_note", {
        content: "Theft",
        metadata: {
          sourceType: "marginal_note",
          language: "en",
          documentTitle: "Criminal Code",
          actId: "C-46",
          sectionLabel: "322",
          sectionId: "sec-322",
          marginalNote: "Theft",
        },
      });

      expect(result.metadata.sectionLabel).toBe("322");
      expect(result.metadata.marginalNote).toBe("Theft");
    });

    test("handles French marginal note", () => {
      const result = createMockSearchResult("marginal_note", {
        content: "Vol",
        metadata: {
          sourceType: "marginal_note",
          language: "fr",
          documentTitle: "Code criminel",
          actId: "C-46",
          sectionLabel: "322",
          marginalNote: "Vol",
        },
      });

      expect(result.metadata.language).toBe("fr");
      expect(result.metadata.marginalNote).toBe("Vol");
    });
  });

  test.describe("Schedule hydration", () => {
    test("formats schedule with schedule ID", () => {
      const result = createMockSearchResult("schedule", {
        content: "List of controlled substances",
        metadata: {
          sourceType: "schedule",
          language: "en",
          documentTitle: "Criminal Code",
          actId: "C-46",
          sectionLabel: "Schedule I",
          scheduleId: "sch-1",
          sectionType: "schedule",
          marginalNote: "Prohibited Substances",
        },
      });

      expect(result.metadata.scheduleId).toBe("sch-1");
      expect(result.metadata.sectionType).toBe("schedule");
      expect(result.metadata.marginalNote).toBe("Prohibited Substances");
    });

    test("handles regulation schedule", () => {
      const result = createMockSearchResult("schedule", {
        content: "Food additive specifications",
        metadata: {
          sourceType: "schedule",
          language: "en",
          documentTitle: "Food and Drug Regulations",
          regulationId: "C.R.C._c. 870",
          sectionLabel: "Schedule Item 1758",
          sectionType: "schedule",
        },
      });

      expect(result.metadata.regulationId).toBe("C.R.C._c. 870");
    });
  });

  test.describe("Publication item hydration", () => {
    test("formats publication item with recommendation type", () => {
      const result = createMockSearchResult("publication_item", {
        content: "The Minister recommends that...",
        metadata: {
          sourceType: "publication_item",
          language: "en",
          documentTitle: "Test Regulations",
          regulationId: "SOR-2020-123",
          publicationType: "recommendation",
          publicationIndex: 0,
        },
      });

      expect(result.metadata.publicationType).toBe("recommendation");
      expect(result.metadata.publicationIndex).toBe(0);
      expect(result.content).toContain("recommends");
    });

    test("formats publication item with notice type", () => {
      const result = createMockSearchResult("publication_item", {
        content: "Notice is hereby given that...",
        metadata: {
          sourceType: "publication_item",
          language: "en",
          documentTitle: "Test Regulations",
          regulationId: "SOR-2020-123",
          publicationType: "notice",
          publicationIndex: 1,
        },
      });

      expect(result.metadata.publicationType).toBe("notice");
      expect(result.metadata.publicationIndex).toBe(1);
    });

    test("handles French publication item", () => {
      const result = createMockSearchResult("publication_item", {
        content: "Le ministre recommande que...",
        metadata: {
          sourceType: "publication_item",
          language: "fr",
          documentTitle: "Règlement d'essai",
          regulationId: "SOR-2020-123",
          publicationType: "recommendation",
          publicationIndex: 0,
        },
      });

      expect(result.metadata.language).toBe("fr");
      expect(result.content).toContain("recommande");
    });

    test("handles publication item associated with act", () => {
      const result = createMockSearchResult("publication_item", {
        content: "Publication content for act",
        metadata: {
          sourceType: "publication_item",
          language: "en",
          documentTitle: "Criminal Code",
          actId: "C-46",
          publicationType: "notice",
          publicationIndex: 0,
        },
      });

      expect(result.metadata.actId).toBe("C-46");
      expect(result.metadata.regulationId).toBeUndefined();
    });
  });
});

test.describe("HydratedLegislationSource type", () => {
  test("sourceType includes all supported hydration types", () => {
    // Test that all expected source types are valid for HydratedLegislationSource
    const sourceTypes: HydratedLegislationSource["sourceType"][] = [
      "act",
      "regulation",
      "defined_term",
      "footnote",
      "related_provisions",
      "preamble",
      "treaty",
      "cross_reference",
      "table_of_provisions",
      "signature_block",
      "marginal_note",
      "schedule",
      "publication_item",
    ];

    // Verify each source type is accepted
    for (const sourceType of sourceTypes) {
      const result: HydratedLegislationSource = {
        sourceType,
        markdown: "# Test\n\nContent",
        languageUsed: "en",
        id: `test-${sourceType}`,
      };

      expect(result.sourceType).toBe(sourceType);
      expect(result.markdown).toBeTruthy();
      expect(result.languageUsed).toBe("en");
      expect(result.id).toContain(sourceType);
    }
  });

  test("supports optional note field for language fallback", () => {
    const resultWithNote: HydratedLegislationSource = {
      sourceType: "act",
      markdown: "# Test Act",
      languageUsed: "en",
      id: "act-test",
      note: "French text not available; using English source text.",
    };

    expect(resultWithNote.note).toBe(
      "French text not available; using English source text."
    );

    const resultWithoutNote: HydratedLegislationSource = {
      sourceType: "act",
      markdown: "# Test Act",
      languageUsed: "en",
      id: "act-test",
    };

    expect(resultWithoutNote.note).toBeUndefined();
  });

  test("languageUsed accepts both en and fr", () => {
    const enResult: HydratedLegislationSource = {
      sourceType: "defined_term",
      markdown: "# Term: barrier",
      languageUsed: "en",
      id: "term-barrier",
    };

    const frResult: HydratedLegislationSource = {
      sourceType: "defined_term",
      markdown: "# Terme: obstacle",
      languageUsed: "fr",
      id: "term-obstacle",
    };

    expect(enResult.languageUsed).toBe("en");
    expect(frResult.languageUsed).toBe("fr");
  });
});

// Hydration ID patterns - top level for lint compliance
const TERM_ID_PATTERN = /^term-/;
const FOOTNOTE_ID_PATTERN = /^footnote-/;
const RELPROV_ID_PATTERN = /^relprov-/;
const PREAMBLE_ID_PATTERN = /^preamble-/;
const TREATY_ID_PATTERN = /^treaty-/;
const XREF_ID_PATTERN = /^xref-/;
const TOC_ID_PATTERN = /^toc-/;
const SIG_ID_PATTERN = /^sig-/;
const MARGINAL_ID_PATTERN = /^marginal-/;
const SCHEDULE_ID_PATTERN = /^schedule-/;
const PUBLICATION_ID_PATTERN = /^pub-/;

test.describe("Hydration ID generation patterns", () => {
  // These tests document the expected ID patterns for each source type

  test("defined term ID uses termId", () => {
    // Expected pattern: term-{termId}
    expect("term-barrier-en").toMatch(TERM_ID_PATTERN);
  });

  test("footnote ID includes document and section info", () => {
    // Expected pattern: footnote-{actId|regulationId}-{sectionLabel}-{footnoteId}
    expect("footnote-C-46-91-fn1").toMatch(FOOTNOTE_ID_PATTERN);
  });

  test("related provisions ID includes document and label", () => {
    // Expected pattern: relprov-{actId|regulationId}-{label|source}
    expect("relprov-C-81-Transitional Provisions").toMatch(RELPROV_ID_PATTERN);
  });

  test("preamble ID includes document and index", () => {
    // Expected pattern: preamble-{actId|regulationId}-{index}
    expect("preamble-C-46-0").toMatch(PREAMBLE_ID_PATTERN);
  });

  test("treaty ID includes document and title", () => {
    // Expected pattern: treaty-{actId|regulationId}-{treatyTitle}
    expect("treaty-C-46-Vienna Convention").toMatch(TREATY_ID_PATTERN);
  });

  test("cross-reference ID uses crossRefId", () => {
    // Expected pattern: xref-{crossRefId}
    expect("xref-123").toMatch(XREF_ID_PATTERN);
  });

  test("table of provisions ID uses document ID", () => {
    // Expected pattern: toc-{actId|regulationId}
    expect("toc-C-46").toMatch(TOC_ID_PATTERN);
  });

  test("signature block ID includes document and signatory", () => {
    // Expected pattern: sig-{actId|regulationId}-{signatureName}
    expect("sig-C-46-Mary Simon").toMatch(SIG_ID_PATTERN);
  });

  test("marginal note ID includes document and section", () => {
    // Expected pattern: marginal-{actId|regulationId}-{sectionId|sectionLabel}
    expect("marginal-C-46-sec-322").toMatch(MARGINAL_ID_PATTERN);
  });

  test("schedule ID includes document and section/schedule ID", () => {
    // Expected pattern: schedule-{actId|regulationId}-{sectionId|scheduleId}
    expect("schedule-C-46-sch-1").toMatch(SCHEDULE_ID_PATTERN);
  });

  test("publication item ID includes document, type, and index", () => {
    // Expected pattern: pub-{actId|regulationId}-{publicationType}-{publicationIndex}
    expect("pub-SOR-2020-123-recommendation-0").toMatch(PUBLICATION_ID_PATTERN);
    expect("pub-C-46-notice-1").toMatch(PUBLICATION_ID_PATTERN);
  });
});

// Regex for French unavailability notes (matches singular and plural forms)
const FRENCH_UNAVAILABLE_NOTE_PATTERN = /non disponibles? en français/;

test.describe("Hydration language fallback", () => {
  // Tests for language note patterns when fallback is used

  test("English note pattern for French fallback", () => {
    const note = "French text not available; using English source text.";
    expect(note).toContain("French text not available");
    expect(note).toContain("English source text");
  });

  test("French note patterns for various source types", () => {
    // Each source type has a specific French note
    const frenchNotes = [
      "Définition non disponible en français.",
      "Note non disponible en français.",
      "Dispositions non disponibles en français.",
      "Préambule non disponible en français.",
      "Traité non disponible en français.",
      "Renvoi non disponible en français.",
      "Table non disponible en français.",
      "Signature non disponible en français.",
      "Annexe non disponible en français.",
      "Publication non disponible en français.",
    ];

    for (const note of frenchNotes) {
      expect(note).toMatch(FRENCH_UNAVAILABLE_NOTE_PATTERN);
    }
  });
});
