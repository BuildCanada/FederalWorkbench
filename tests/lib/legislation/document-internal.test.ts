/**
 * Tests for DocumentInternal node handling in schedule parsing.
 *
 * DocumentInternal elements typically contain Group elements with GroupHeading
 * and Provision elements, commonly used in treaties, agreements, and schedules.
 *
 * The parser creates individual sections for each Provision within DocumentInternal
 * for better RAG retrieval granularity.
 */

import { expect, test } from "@playwright/test";
import { parseActXml } from "@/lib/legislation/parser";

/**
 * Helper to create a minimal Act XML with a Schedule containing DocumentInternal
 */
function createActXmlWithSchedule(scheduleContent: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Statute xml:lang="en">
  <Identification>
    <Chapter>
      <ConsolidatedNumber>T-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle>Test Act</ShortTitle>
  </Identification>
  <Body>
    <Section>
      <Label>1</Label>
      <Text>Main section content</Text>
    </Section>
  </Body>
  <Schedule id="schedule-1">
    <ScheduleFormHeading>
      <Label>SCHEDULE</Label>
      <TitleText>Agreement</TitleText>
    </ScheduleFormHeading>
    ${scheduleContent}
  </Schedule>
</Statute>`;
}

test.describe("DocumentInternal provision parsing", () => {
  test("creates section for each Provision in DocumentInternal", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Provision><Text>Agreement text here</Text></Provision>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    const section = scheduleSections[0];
    expect(section.content).toContain("Agreement text here");
  });

  test("extracts provision text content", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Provision><Text>Agreement text here</Text></Provision>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const content = scheduleSections[0]?.content || "";

    expect(content).toContain("Agreement text here");
  });

  test("handles multiple Provisions as separate sections", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Provision><Text>First provision text</Text></Provision>
        <Provision><Text>Second provision text</Text></Provision>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );

    // Each provision becomes its own section
    expect(scheduleSections.length).toBe(2);
    expect(scheduleSections[0].content).toContain("First provision text");
    expect(scheduleSections[1].content).toContain("Second provision text");
  });

  test("includes Group heading in hierarchy path", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Group>
          <GroupHeading><Label>Article I</Label></GroupHeading>
          <Provision><Text>Article content</Text></Provision>
        </Group>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    const section = scheduleSections[0];
    expect(section.hierarchyPath).toContain("Article I");
  });

  test("extracts Group heading with Label and TitleText", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Group>
          <GroupHeading>
            <Label>ARTICLE II</Label>
            <TitleText>Membership</TitleText>
          </GroupHeading>
          <Provision><Text>Membership provisions here</Text></Provision>
        </Group>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );

    const section = scheduleSections[0];
    // The group heading should include both label and title
    expect(section.hierarchyPath.join(" ")).toContain("ARTICLE II");
    expect(section.hierarchyPath.join(" ")).toContain("Membership");
  });

  test("handles nested Groups", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Group>
          <GroupHeading><Label>Part I</Label></GroupHeading>
          <Group>
            <GroupHeading><Label>Section A</Label></GroupHeading>
            <Provision><Text>Nested content</Text></Provision>
          </Group>
        </Group>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    const section = scheduleSections[0];
    expect(section.content).toContain("Nested content");
    // Hierarchy should include both levels
    expect(section.hierarchyPath).toContain("Part I");
    expect(section.hierarchyPath).toContain("Section A");
  });

  test("preserves Provision labels in section label", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Provision>
          <Label>(i)</Label>
          <Text>First numbered provision</Text>
        </Provision>
        <Provision>
          <Label>(ii)</Label>
          <Text>Second numbered provision</Text>
        </Provision>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );

    expect(scheduleSections[0].sectionLabel).toContain("(i)");
    expect(scheduleSections[1].sectionLabel).toContain("(ii)");
  });

  test("extracts emphasized text content", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Provision>
          <Text>This has <Emphasis style="italic">italicized</Emphasis> text</Text>
        </Provision>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const content = scheduleSections[0]?.content || "";

    expect(content).toContain("italicized");
  });
});

test.describe("ProvisionHeading extraction in DocumentInternal", () => {
  test("extracts ProvisionHeading text from Provision elements", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Group>
          <GroupHeading><Label>ARTICLE II</Label><TitleText>Membership</TitleText></GroupHeading>
          <Provision lims:inforce-start-date="2012-12-14" format-ref="indent-0-0">
            <Label>Section 1</Label>
            <ProvisionHeading lims:inforce-start-date="2012-12-14" format-ref="indent-0-0">
              <Emphasis style="italic">Original members</Emphasis>
            </ProvisionHeading>
            <Text>The original members shall be those countries whose governments accept membership.</Text>
          </Provision>
        </Group>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const sectionsWithPH = result.sections.filter(
      (s) => s.provisionHeading !== undefined
    );
    expect(sectionsWithPH.length).toBe(1);

    const section = sectionsWithPH[0];
    expect(section.provisionHeading).toBeDefined();
    expect(section.provisionHeading?.text).toBe("Original members");
  });

  test("extracts ProvisionHeading format-ref attribute", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Provision format-ref="indent-0-0">
          <Label>Section 1</Label>
          <ProvisionHeading format-ref="heading-2">
            Custom Heading Format
          </ProvisionHeading>
          <Text>Content here.</Text>
        </Provision>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const sectionsWithPH = result.sections.filter(
      (s) => s.provisionHeading !== undefined
    );
    expect(sectionsWithPH.length).toBe(1);

    const section = sectionsWithPH[0];
    expect(section.provisionHeading?.formatRef).toBe("heading-2");
  });

  test("extracts ProvisionHeading LIMS metadata", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Provision format-ref="indent-0-0">
          <Label>Section 1</Label>
          <ProvisionHeading lims:inforce-start-date="2012-12-14" lims:fid="12345" lims:id="12345" format-ref="indent-0-0">
            Heading with LIMS
          </ProvisionHeading>
          <Text>Content here.</Text>
        </Provision>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const sectionsWithPH = result.sections.filter(
      (s) => s.provisionHeading !== undefined
    );
    expect(sectionsWithPH.length).toBe(1);

    const section = sectionsWithPH[0];
    expect(section.provisionHeading?.limsMetadata).toBeDefined();
    expect(section.provisionHeading?.limsMetadata?.fid).toBe("12345");
    expect(section.provisionHeading?.limsMetadata?.id).toBe("12345");
    expect(section.provisionHeading?.limsMetadata?.inForceStartDate).toBe(
      "2012-12-14"
    );
  });

  test("handles multiple Provisions with ProvisionHeading", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Provision>
          <ProvisionHeading>First Heading</ProvisionHeading>
          <Text>First content</Text>
        </Provision>
        <Provision>
          <ProvisionHeading>Second Heading</ProvisionHeading>
          <Text>Second content</Text>
        </Provision>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const sectionsWithPH = result.sections.filter(
      (s) => s.provisionHeading !== undefined
    );
    expect(sectionsWithPH.length).toBe(2);

    expect(sectionsWithPH[0].provisionHeading?.text).toBe("First Heading");
    expect(sectionsWithPH[1].provisionHeading?.text).toBe("Second Heading");
  });

  test("handles ProvisionHeading with emphasis", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Provision>
          <ProvisionHeading>
            <Emphasis style="italic">Emphasized Heading</Emphasis>
          </ProvisionHeading>
          <Text>Content</Text>
        </Provision>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const sectionsWithPH = result.sections.filter(
      (s) => s.provisionHeading !== undefined
    );
    expect(sectionsWithPH.length).toBe(1);

    const section = sectionsWithPH[0];
    expect(section.provisionHeading?.text).toBe("Emphasized Heading");
  });
});

test.describe("DocumentInternal metadata extraction", () => {
  test("extracts LIMS metadata from Provision", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Provision lims:inforce-start-date="2012-12-14" lims:fid="31271" lims:id="31271">
          <Text>Provision with metadata</Text>
        </Provision>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );

    const section = scheduleSections[0];
    expect(section.limsMetadata).toBeDefined();
    expect(section.limsMetadata?.fid).toBe("31271");
    expect(section.inForceStartDate).toBe("2012-12-14");
  });

  test("extracts format-ref from Provision", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Provision format-ref="indent-2-2">
          <Text>Formatted provision</Text>
        </Provision>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );

    const section = scheduleSections[0];
    expect(section.formattingAttributes?.formatRef).toBe("indent-2-2");
  });

  test("sets schedule context on sections", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Provision><Text>Content</Text></Provision>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );

    const section = scheduleSections[0];
    expect(section.scheduleId).toBeDefined();
    expect(section.actId).toBe("T-1");
  });
});

test.describe("Real-world DocumentInternal patterns", () => {
  test("parses IMF Agreement style structure", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal lims:inforce-start-date="2012-12-14" lims:fid="31270" lims:id="31270">
        <Provision lims:inforce-start-date="2012-12-14" lims:fid="31271" lims:id="31271" format-ref="indent-0-0" language-align="no" list-item="no">
          <Text>Articles of Agreement of the International Monetary Fund</Text>
        </Provision>
        <Provision lims:inforce-start-date="2012-12-14" lims:fid="31272" lims:id="31272" format-ref="indent-0-0" language-align="no" list-item="no">
          <Text>The Governments on whose behalf the present Agreement is signed agree as follows:</Text>
        </Provision>
        <Group lims:inforce-start-date="2012-12-14" lims:fid="31273" lims:id="31273">
          <GroupHeading lims:inforce-start-date="2012-12-14" lims:fid="31274" lims:id="31274" format-ref="group1-part">
            <Label>INTRODUCTORY ARTICLE</Label>
          </GroupHeading>
          <Provision lims:inforce-start-date="2012-12-14" lims:fid="31275" lims:id="31275" format-ref="indent-2-2" language-align="no" list-item="no">
            <Label>(i)</Label>
            <Text>The International Monetary Fund is established and shall operate in accordance with the provisions of this Agreement.</Text>
          </Provision>
        </Group>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );

    // Should have 3 sections: 2 provisions + 1 from group
    expect(scheduleSections.length).toBe(3);

    // First provision - title
    expect(scheduleSections[0].content).toContain(
      "Articles of Agreement of the International Monetary Fund"
    );

    // Second provision - preamble
    expect(scheduleSections[1].content).toContain(
      "The Governments on whose behalf"
    );

    // Third provision - from group with label
    expect(scheduleSections[2].content).toContain(
      "The International Monetary Fund is established"
    );
    expect(scheduleSections[2].sectionLabel).toContain("(i)");
    expect(scheduleSections[2].hierarchyPath).toContain("INTRODUCTORY ARTICLE");
  });
});
