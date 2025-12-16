/**
 * Tests for heading extraction utilities and Heading ContentNode support.
 */

import { expect, test } from "@playwright/test";
import { XMLParser } from "fast-xml-parser";
import { extractAllContent } from "@/lib/legislation/utils/content-tree";
import {
  extractHeadingComponents,
  extractTitleText,
} from "@/lib/legislation/utils/heading";

/**
 * Parser that preserves document order - essential for mixed content.
 */
const preserveOrderParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  trimValues: false,
  textNodeName: "#text",
});

test.describe("Heading extraction utilities", () => {
  test("extractHeadingComponents extracts label and title", () => {
    const obj = {
      Label: "PART I",
      TitleText: "General Provisions",
    };

    const result = extractHeadingComponents(obj);

    expect(result.label).toBe("PART I");
    expect(result.title).toBe("General Provisions");
    expect(result.combined).toBe("PART I General Provisions");
  });

  test("extractHeadingComponents handles label only", () => {
    const obj = {
      Label: "Division A",
    };

    const result = extractHeadingComponents(obj);

    expect(result.label).toBe("Division A");
    expect(result.title).toBeUndefined();
    expect(result.combined).toBe("Division A");
  });

  test("extractHeadingComponents handles title only", () => {
    const obj = {
      TitleText: "Interpretation",
    };

    const result = extractHeadingComponents(obj);

    expect(result.label).toBeUndefined();
    expect(result.title).toBe("Interpretation");
    expect(result.combined).toBe("Interpretation");
  });

  test("extractHeadingComponents handles empty object", () => {
    const obj = {};

    const result = extractHeadingComponents(obj);

    expect(result.label).toBeUndefined();
    expect(result.title).toBeUndefined();
    expect(result.combined).toBe("");
  });

  test("extractTitleText returns title when present", () => {
    const obj = {
      Label: "PART I",
      TitleText: "General",
    };

    const result = extractTitleText(obj);

    expect(result).toBe("General");
  });

  test("extractTitleText returns undefined when missing", () => {
    const obj = {
      Label: "PART I",
    };

    const result = extractTitleText(obj);

    expect(result).toBeUndefined();
  });
});

/**
 * Helper to create a minimal Act XML with Headings
 */
function createActXmlWithHeading(bodyContent: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Statute xml:lang="en">
  <Identification>
    <Chapter>
      <ConsolidatedNumber>T-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle>Test Act</ShortTitle>
  </Identification>
  <Body>
    ${bodyContent}
  </Body>
</Statute>`;
}

/**
 * Helper to parse XML with preserved order and extract content
 */
function parseWithPreservedOrder(xml: string) {
  const parsed = preserveOrderParser.parse(xml);
  return extractAllContent(parsed);
}

test.describe("Heading in contentTree", () => {
  test("Heading elements appear in parser output", () => {
    const xml = createActXmlWithHeading(`
      <Heading level="1">
        <Label>PART I</Label>
        <TitleText>General Provisions</TitleText>
      </Heading>
      <Section lims:id="test-section-1" xmlns:lims="http://justice.gc.ca/lims">
        <Label>1</Label>
        <Text>Main section content</Text>
      </Section>
    `);

    // Use preserved-order parsing to extract contentTrees including headings
    const extractedContent = parseWithPreservedOrder(xml);

    // The extracted content should include the heading
    const headingEntry = extractedContent.contentTrees.find(
      (ct) => ct.sectionLabel === "PART I General Provisions"
    );
    expect(headingEntry).toBeDefined();
    expect(headingEntry?.contentTree).toBeDefined();
    expect(headingEntry?.contentTree?.length).toBeGreaterThan(0);

    const headingNode = headingEntry?.contentTree?.[0];
    expect(headingNode?.type).toBe("Heading");
  });

  test("Heading level is preserved in contentTree", () => {
    const xml = createActXmlWithHeading(`
      <Heading level="2">
        <Label>Division A</Label>
        <TitleText>Special Rules</TitleText>
      </Heading>
      <Section lims:id="test-section-1" xmlns:lims="http://justice.gc.ca/lims">
        <Label>1</Label>
        <Text>Content</Text>
      </Section>
    `);

    const extractedContent = parseWithPreservedOrder(xml);

    const headingEntry = extractedContent.contentTrees.find(
      (ct) => ct.sectionLabel === "Division A Special Rules"
    );
    expect(headingEntry).toBeDefined();

    const headingNode = headingEntry?.contentTree?.[0] as {
      type: string;
      level?: number;
    };
    expect(headingNode?.type).toBe("Heading");
    expect(headingNode?.level).toBe(2);
  });

  test("Heading hierarchy path is populated", () => {
    const xml = createActXmlWithHeading(`
      <Heading level="1">
        <Label>PART I</Label>
        <TitleText>General</TitleText>
      </Heading>
      <Section lims:id="test-section-1" xmlns:lims="http://justice.gc.ca/lims">
        <Label>1</Label>
        <Text>Content</Text>
      </Section>
    `);

    const extractedContent = parseWithPreservedOrder(xml);

    const headingEntry = extractedContent.contentTrees.find((ct) =>
      ct.sectionLabel?.includes("PART I")
    );
    expect(headingEntry?.hierarchyPath).toBeDefined();
    expect(headingEntry?.hierarchyPath).toContain("PART I General");
  });

  test("Multiple headings create multiple contentTree entries", () => {
    const xml = createActXmlWithHeading(`
      <Heading level="1">
        <Label>PART I</Label>
        <TitleText>First Part</TitleText>
      </Heading>
      <Section lims:id="test-section-1" xmlns:lims="http://justice.gc.ca/lims">
        <Label>1</Label>
        <Text>Content 1</Text>
      </Section>
      <Heading level="1">
        <Label>PART II</Label>
        <TitleText>Second Part</TitleText>
      </Heading>
      <Section lims:id="test-section-2" xmlns:lims="http://justice.gc.ca/lims">
        <Label>2</Label>
        <Text>Content 2</Text>
      </Section>
    `);

    const extractedContent = parseWithPreservedOrder(xml);

    // Should have contentTree entries for both headings
    const part1 = extractedContent.contentTrees.find((ct) =>
      ct.sectionLabel?.includes("PART I")
    );
    const part2 = extractedContent.contentTrees.find((ct) =>
      ct.sectionLabel?.includes("PART II")
    );

    expect(part1).toBeDefined();
    expect(part2).toBeDefined();
  });
});
