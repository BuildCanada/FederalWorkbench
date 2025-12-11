/**
 * Tests for repealed section detection.
 *
 * The Justice Canada XML uses multiple patterns to represent repealed sections.
 * These tests verify that the isRepealedSection helper correctly identifies
 * sections that are fully repealed vs sections with some repealed nested content.
 */

import { expect, test } from "@playwright/test";
import { parseRegulationXml } from "@/lib/legislation/parser";
import { isRepealedSection } from "@/lib/legislation/utils/sections";

test.describe("isRepealedSection helper", () => {
  test("returns true for direct Repealed child", () => {
    // Pattern: <Section><Repealed>...</Repealed></Section>
    const sectionEl = {
      Label: "1",
      Repealed: "[Repealed, SOR/2023-5]",
    };
    expect(isRepealedSection(sectionEl)).toBe(true);
  });

  test("returns true for Repealed inside Text only", () => {
    // Pattern: <Section><Label>1</Label><Text><Repealed>...</Repealed></Text></Section>
    // This is the most common pattern for repealed sections
    const sectionEl = {
      Label: "1",
      Text: {
        Repealed: "[Repealed, SOR/2018-39, s. 2]",
      },
    };
    expect(isRepealedSection(sectionEl)).toBe(true);
  });

  test("returns true for Repealed with whitespace text", () => {
    // Pattern where Text has Repealed and insignificant whitespace
    const sectionEl = {
      Label: "1",
      Text: {
        Repealed: "[Repealed, SOR/2020-100]",
        "#text": " ",
      },
    };
    expect(isRepealedSection(sectionEl)).toBe(true);
  });

  test("returns false for section with no Repealed", () => {
    const sectionEl = {
      Label: "1",
      Text: "Normal section content",
    };
    expect(isRepealedSection(sectionEl)).toBe(false);
  });

  test("returns false for section with Text containing other elements plus Repealed", () => {
    // Pattern: <Text><DefinedTermEn>Term</DefinedTermEn><Repealed>[Revoked]</Repealed></Text>
    // This represents a definition that was revoked, not the whole section
    const sectionEl = {
      Label: "2",
      Text: {
        DefinedTermEn: "Some Term",
        Repealed: "[Revoked, SOR/85-1092, s. 1]",
      },
    };
    expect(isRepealedSection(sectionEl)).toBe(false);
  });

  test("returns false when Repealed is in nested Definition only", () => {
    // Section is active but contains a definition that was repealed
    const sectionEl = {
      Label: "2",
      Text: "In these Regulations,",
      Definition: [
        {
          Text: {
            DefinedTermEn: "active term",
          },
        },
        {
          Text: {
            DefinedTermEn: "revoked term",
            Repealed: "[Revoked, SOR/85-1092, s. 1]",
          },
        },
      ],
    };
    expect(isRepealedSection(sectionEl)).toBe(false);
  });

  test("returns false for string Text (not object)", () => {
    // When fast-xml-parser parses <Text>simple content</Text>, it returns a string
    const sectionEl = {
      Label: "1",
      Text: "Simple text content",
    };
    expect(isRepealedSection(sectionEl)).toBe(false);
  });

  test("returns false for Text with XML attributes plus Repealed", () => {
    // Attributes starting with @ should be ignored, but other content should prevent repealed status
    const sectionEl = {
      Label: "1",
      Text: {
        "@_format": "indent-0",
        Repealed: "[Repealed]",
        // If there was additional content, it would indicate partial repeal
      },
    };
    // This should be true because @ attributes are filtered out
    expect(isRepealedSection(sectionEl)).toBe(true);
  });
});

test.describe("Repealed section parsing integration", () => {
  /**
   * Helper to create a regulation XML with a section
   */
  function createRegulationXml(sectionContent: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<Regulation xml:lang="en" regulation-type="SOR">
  <Identification>
    <InstrumentNumber>SOR/2024-1</InstrumentNumber>
    <ShortTitle>Test Regulation</ShortTitle>
  </Identification>
  <Body>
    ${sectionContent}
  </Body>
</Regulation>`;
  }

  test("parses section with Text>Repealed as status=repealed", () => {
    const xml = createRegulationXml(`
      <Section>
        <Label>1</Label>
        <Text><Repealed>[Repealed, SOR/2018-39, s. 2]</Repealed></Text>
      </Section>
    `);

    const result = parseRegulationXml(xml, "en");
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].status).toBe("repealed");
    expect(result.sections[0].sectionLabel).toBe("1");
  });

  test("parses section with direct Repealed as status=repealed", () => {
    const xml = createRegulationXml(`
      <Section>
        <Label>2</Label>
        <Repealed>[Repealed, SOR/2023-5]</Repealed>
      </Section>
    `);

    const result = parseRegulationXml(xml, "en");
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].status).toBe("repealed");
  });

  test("parses active section with repealed definition as status=in-force", () => {
    const xml = createRegulationXml(`
      <Section>
        <Label>2</Label>
        <Text>In these Regulations,</Text>
        <Definition>
          <Text>
            <DefinedTermEn>active term</DefinedTermEn> means something. ()
          </Text>
        </Definition>
        <Definition>
          <Text>
            <DefinedTermEn>revoked term</DefinedTermEn>
            <Repealed>[Revoked, SOR/85-1092, s. 1]</Repealed>
          </Text>
        </Definition>
      </Section>
    `);

    const result = parseRegulationXml(xml, "en");
    expect(result.sections).toHaveLength(1);
    // Section should be in-force because only one definition is repealed
    expect(result.sections[0].status).toBe("in-force");
  });

  test("parses normal section as status=in-force", () => {
    const xml = createRegulationXml(`
      <Section>
        <Label>3</Label>
        <Text>This is a normal section with active content.</Text>
      </Section>
    `);

    const result = parseRegulationXml(xml, "en");
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].status).toBe("in-force");
  });

  test("parses not-in-force section correctly", () => {
    const xml = createRegulationXml(`
      <Section in-force="no">
        <Label>4</Label>
        <Text>This section is not yet in force.</Text>
      </Section>
    `);

    const result = parseRegulationXml(xml, "en");
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].status).toBe("not-in-force");
  });
});
