/**
 * Tests for cross-reference extraction from legislation XML.
 *
 * Cross-references link legislation documents to other acts and regulations.
 * Only act and regulation reference types are captured.
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
  test.describe("Act references", () => {
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

  test.describe("Regulation references", () => {
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

  test.describe("Mixed act and regulation references", () => {
    test("extracts both act and regulation references", () => {
      const xml = createActXmlWithRefs(
        '<XRefExternal reference-type="act" link="A-1">Act A</XRefExternal> and ' +
          '<XRefExternal reference-type="regulation" link="SOR-1">Reg 1</XRefExternal>.'
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(2);

      const actRef = result.crossReferences.find((r) => r.targetType === "act");
      const regRef = result.crossReferences.find(
        (r) => r.targetType === "regulation"
      );

      expect(actRef).toMatchObject({
        targetType: "act",
        targetRef: "A-1",
      });
      expect(regRef).toMatchObject({
        targetType: "regulation",
        targetRef: "SOR-1",
      });
    });
  });

  test.describe("Ignored reference types", () => {
    test("ignores XRefInternal (internal section references)", () => {
      const xml = createActXmlWithRefs(
        "As defined in subsection <XRefInternal>3</XRefInternal>(1)."
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(0);
    });

    test("ignores non-legislation reference types", () => {
      const xml = createActXmlWithRefs(
        '<XRefExternal reference-type="standard" link="ISO-9001">ISO Standard</XRefExternal> and ' +
          '<XRefExternal reference-type="agreement" link="NAFTA">Trade Agreement</XRefExternal> and ' +
          '<XRefExternal reference-type="canada-gazette" link="CG-1">Canada Gazette</XRefExternal> and ' +
          '<XRefExternal reference-type="other" link="misc">Other</XRefExternal>'
      );
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
  });

  test.describe("Edge cases", () => {
    test("handles empty content gracefully", () => {
      const xml = createActXmlWithRefs("No references here.");
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(0);
    });

    test("only captures act/regulation even when mixed with other types", () => {
      const xml = createActXmlWithRefs(
        '<XRefExternal reference-type="act" link="C-46">Criminal Code</XRefExternal> and ' +
          '<XRefExternal reference-type="standard" link="ISO-9001">ISO</XRefExternal> and ' +
          "section <XRefInternal>5</XRefInternal>"
      );
      const result = parseActXml(xml, "en");

      expect(result.crossReferences).toHaveLength(1);
      expect(result.crossReferences[0].targetType).toBe("act");
      expect(result.crossReferences[0].targetRef).toBe("C-46");
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
      <Text>Voir le <XRefExternal reference-type="act" link="C-46">Code criminel</XRefExternal>.</Text>
    </Section>
  </Body>
</Statute>`;

      const result = parseActXml(xml, "fr");

      expect(result.crossReferences).toHaveLength(1);
      expect(result.crossReferences[0]).toMatchObject({
        targetType: "act",
        targetRef: "C-46",
        referenceText: "Code criminel",
      });
    });
  });
});
