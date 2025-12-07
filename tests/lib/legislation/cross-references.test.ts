/**
 * Tests for cross-reference extraction from legislation XML.
 *
 * These tests verify that the parser correctly extracts:
 * - XRefExternal elements with all reference types (act, regulation, agreement, etc.)
 * - XRefInternal elements for intra-document section references
 */

import { expect, test } from "@playwright/test";
import { parseActXml } from "@/lib/legislation/parser";

/**
 * Helper to create a minimal Act XML with cross-references in a section
 */
function createActXmlWithRefs(sectionContent: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Statute xml:lang="en">
  <Identification>
    <Chapter>
      <ConsolidatedNumber>T-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle status="official">Test Act</ShortTitle>
  </Identification>
  <Body>
    <Section>
      <Label>1</Label>
      <Text>${sectionContent}</Text>
    </Section>
  </Body>
</Statute>`;
}

test.describe("Cross-reference extraction", () => {
  test.describe("XRefExternal - act references", () => {
    test("extracts act references with link", () => {
      const xml = createActXmlWithRefs(
        'See the <XRefExternal reference-type="act" link="C-46">Criminal Code</XRefExternal>.'
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(1);
      expect(result.crossReferences[0]).toMatchObject({
        sourceActId: "T-1",
        sourceSectionLabel: "1",
        targetType: "act",
        targetRef: "C-46",
        referenceText: "Criminal Code",
      });
    });

    test("extracts multiple act references from same section", () => {
      const xml = createActXmlWithRefs(
        'See the <XRefExternal reference-type="act" link="C-46">Criminal Code</XRefExternal> ' +
          'and the <XRefExternal reference-type="act" link="I-2.5">Immigration Act</XRefExternal>.'
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(2);
      expect(result.crossReferences[0].targetRef).toBe("C-46");
      expect(result.crossReferences[1].targetRef).toBe("I-2.5");
    });
  });

  test.describe("XRefExternal - regulation references", () => {
    test("extracts regulation references", () => {
      const xml = createActXmlWithRefs(
        'See <XRefExternal reference-type="regulation" link="SOR-2000-1">the Regulations</XRefExternal>.'
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(1);
      expect(result.crossReferences[0]).toMatchObject({
        targetType: "regulation",
        targetRef: "SOR-2000-1",
        referenceText: "the Regulations",
      });
    });
  });

  test.describe("XRefExternal - other reference types", () => {
    test("extracts agreement references", () => {
      const xml = createActXmlWithRefs(
        '<XRefExternal reference-type="agreement" link="NAFTA-2020">Trade Agreement</XRefExternal>'
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(1);
      expect(result.crossReferences[0]).toMatchObject({
        targetType: "agreement",
        targetRef: "NAFTA-2020",
        referenceText: "Trade Agreement",
      });
    });

    test("extracts canada-gazette references", () => {
      const xml = createActXmlWithRefs(
        '<XRefExternal reference-type="canada-gazette" link="CG-2023-01">Canada Gazette</XRefExternal>'
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(1);
      expect(result.crossReferences[0]).toMatchObject({
        targetType: "canada-gazette",
        targetRef: "CG-2023-01",
      });
    });

    test("extracts citation references", () => {
      const xml = createActXmlWithRefs(
        '<XRefExternal reference-type="citation" link="2020 SCC 5">Court Citation</XRefExternal>'
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(1);
      expect(result.crossReferences[0]).toMatchObject({
        targetType: "citation",
        targetRef: "2020 SCC 5",
      });
    });

    test("extracts standard references", () => {
      const xml = createActXmlWithRefs(
        '<XRefExternal reference-type="standard" link="ISO-9001">ISO Standard</XRefExternal>'
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(1);
      expect(result.crossReferences[0]).toMatchObject({
        targetType: "standard",
        targetRef: "ISO-9001",
      });
    });

    test('extracts "other" reference type', () => {
      const xml = createActXmlWithRefs(
        '<XRefExternal reference-type="other" link="misc-ref">Other Reference</XRefExternal>'
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(1);
      expect(result.crossReferences[0]).toMatchObject({
        targetType: "other",
        targetRef: "misc-ref",
      });
    });
  });

  test.describe("XRefInternal - section references", () => {
    test("extracts simple section reference", () => {
      const xml = createActXmlWithRefs(
        "As defined in subsection <XRefInternal>3</XRefInternal>(1)."
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(1);
      expect(result.crossReferences[0]).toMatchObject({
        sourceActId: "T-1",
        sourceSectionLabel: "1",
        targetType: "section",
        targetRef: "3",
        referenceText: "3",
      });
    });

    test("extracts multiple internal section references", () => {
      const xml = createActXmlWithRefs(
        "See sections <XRefInternal>5</XRefInternal> and <XRefInternal>10</XRefInternal>."
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(2);
      expect(result.crossReferences[0].targetRef).toBe("5");
      expect(result.crossReferences[0].targetType).toBe("section");
      expect(result.crossReferences[1].targetRef).toBe("10");
      expect(result.crossReferences[1].targetType).toBe("section");
    });

    test("extracts subsection reference format", () => {
      const xml = createActXmlWithRefs(
        "Pursuant to <XRefInternal>7(1)(a)</XRefInternal>."
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(1);
      expect(result.crossReferences[0]).toMatchObject({
        targetType: "section",
        targetRef: "7(1)(a)",
      });
    });
  });

  test.describe("Mixed references", () => {
    test("extracts both external and internal references", () => {
      const xml = createActXmlWithRefs(
        'See the <XRefExternal reference-type="act" link="C-46">Criminal Code</XRefExternal> ' +
          "and section <XRefInternal>15</XRefInternal> of this Act."
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(2);

      const externalRef = result.crossReferences.find(
        (r) => r.targetType === "act"
      );
      const internalRef = result.crossReferences.find(
        (r) => r.targetType === "section"
      );

      expect(externalRef).toMatchObject({
        targetType: "act",
        targetRef: "C-46",
      });
      expect(internalRef).toMatchObject({
        targetType: "section",
        targetRef: "15",
      });
    });

    test("extracts all reference types in one section", () => {
      const xml = createActXmlWithRefs(
        '<XRefExternal reference-type="act" link="A-1">Act A</XRefExternal>, ' +
          '<XRefExternal reference-type="regulation" link="SOR-1">Reg 1</XRefExternal>, ' +
          '<XRefExternal reference-type="agreement" link="AGR-1">Agreement</XRefExternal>, ' +
          "section <XRefInternal>5</XRefInternal>"
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(4);

      const types = result.crossReferences.map((r) => r.targetType);
      expect(types).toContain("act");
      expect(types).toContain("regulation");
      expect(types).toContain("agreement");
      expect(types).toContain("section");
    });
  });

  test.describe("Edge cases", () => {
    test("handles empty content gracefully", () => {
      const xml = createActXmlWithRefs("No references here.");
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(0);
    });

    test("ignores XRefExternal without link attribute", () => {
      const xml = createActXmlWithRefs(
        '<XRefExternal reference-type="act">No Link</XRefExternal>'
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(0);
    });

    test("ignores XRefExternal with unknown reference-type", () => {
      const xml = createActXmlWithRefs(
        '<XRefExternal reference-type="unknown" link="X-1">Unknown Type</XRefExternal>'
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(0);
    });

    test("handles XRefInternal with whitespace", () => {
      const xml = createActXmlWithRefs(
        "See <XRefInternal> 42 </XRefInternal>."
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(1);
      // The parser should trim whitespace
      expect(result.crossReferences[0].targetRef).toBe("42");
    });
  });

  test.describe("French language support", () => {
    test("extracts references from French Act", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<Statute xml:lang="fr">
  <Identification>
    <Chapter>
      <ConsolidatedNumber>T-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle status="official">Loi test</ShortTitle>
  </Identification>
  <Body>
    <Section>
      <Label>1</Label>
      <Text>Voir le <XRefExternal reference-type="act" link="C-46">Code criminel</XRefExternal> et l'article <XRefInternal>3</XRefInternal>.</Text>
    </Section>
  </Body>
</Statute>`;

      const result = parseActXml(xml, "fr");

      expect(result.crossReferences).toHaveLength(2);
      expect(result.crossReferences[0]).toMatchObject({
        targetType: "act",
        targetRef: "C-46",
        referenceText: "Code criminel",
      });
      expect(result.crossReferences[1]).toMatchObject({
        targetType: "section",
        targetRef: "3",
      });
    });
  });
});
