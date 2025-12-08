/**
 * Tests for DocumentInternal node handling in extractHtmlContent.
 *
 * Task 7: Handle DocumentInternal nodes so internal references are preserved.
 * DocumentInternal elements typically contain Group elements with GroupHeading
 * and Provision elements, commonly used in treaties, agreements, and schedules.
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

test.describe("DocumentInternal handling in extractHtmlContent", () => {
  test("wraps DocumentInternal in section with class", () => {
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

    const contentHtml = scheduleSections[0].contentHtml;
    expect(contentHtml).toContain('<section class="document-internal">');
    expect(contentHtml).toContain("</section>");
  });

  test("wraps Group elements in div with class", () => {
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
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    expect(contentHtml).toContain('<div class="group">');
    expect(contentHtml).toContain("</div>");
  });

  test("renders GroupHeading as h4 with class", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Group>
          <GroupHeading><Label><Emphasis style="italic">Article I</Emphasis></Label></GroupHeading>
          <Provision><Text>Definitions section</Text></Provision>
        </Group>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    expect(contentHtml).toContain('<h4 class="group-heading">');
    expect(contentHtml).toContain("Article I");
    expect(contentHtml).toContain("</h4>");
  });

  test("wraps Provision elements in p with class", () => {
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
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    expect(contentHtml).toContain('<p class="provision">');
    expect(contentHtml).toContain("First provision text");
    expect(contentHtml).toContain("Second provision text");
  });

  test("handles multiple Groups within DocumentInternal", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Group>
          <GroupHeading><Label>Article I</Label></GroupHeading>
          <Provision><Text>Definitions</Text></Provision>
        </Group>
        <Group>
          <GroupHeading><Label>Article II</Label></GroupHeading>
          <Provision><Text>Obligations</Text></Provision>
        </Group>
        <Group>
          <GroupHeading><Label>Article III</Label></GroupHeading>
          <Provision><Text>Rights</Text></Provision>
        </Group>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    // Count Groups
    const groupMatches = contentHtml.match(/<div class="group">/g) || [];
    expect(groupMatches.length).toBe(3);

    // Verify all articles present
    expect(contentHtml).toContain("Article I");
    expect(contentHtml).toContain("Article II");
    expect(contentHtml).toContain("Article III");
    expect(contentHtml).toContain("Definitions");
    expect(contentHtml).toContain("Obligations");
    expect(contentHtml).toContain("Rights");
  });

  test("preserves nested content within Provision", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Provision>
          <Text>The <DefinedTermEn>deep waterway</DefinedTermEn> means...</Text>
        </Provision>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    expect(contentHtml).toContain("<dfn>");
    expect(contentHtml).toContain("deep waterway");
    expect(contentHtml).toContain("</dfn>");
  });

  test("handles SectionPiece elements", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <SectionPiece>
          <Text>Section piece content</Text>
        </SectionPiece>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    expect(contentHtml).toContain('<div class="section-piece">');
    expect(contentHtml).toContain("Section piece content");
    expect(contentHtml).toContain("</div>");
  });

  test("preserves emphasis within GroupHeading", () => {
    const xml = createActXmlWithSchedule(`
      <DocumentInternal>
        <Group>
          <GroupHeading>
            <Label><Emphasis style="italic">Article IV</Emphasis></Label>
          </GroupHeading>
          <Provision><Text>Content</Text></Provision>
        </Group>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    expect(contentHtml).toContain("<em>");
    expect(contentHtml).toContain("Article IV");
    expect(contentHtml).toContain("</em>");
  });

  test("handles complex agreement structure", () => {
    // This mirrors the structure found in real legislation agreements
    const xml = createActXmlWithSchedule(`
      <Provision><Text><Emphasis style="smallcaps">Agreement</Emphasis> made this third day of December</Text></Provision>
      <Provision><Text><Emphasis style="smallcaps">Between</Emphasis></Text></Provision>
      <Provision><Text>The Government of Canada</Text></Provision>
      <DocumentInternal>
        <Group>
          <GroupHeading><Label><Emphasis style="italic">Article I</Emphasis></Label></GroupHeading>
          <Provision>
            <Text>For the purposes of this Agreement:</Text>
            <Provision>
              <Label>(a)</Label>
              <Text><DefinedTermEn>deep waterway</DefinedTermEn> means adequate provision for navigation</Text>
            </Provision>
            <Provision>
              <Label>(b)</Label>
              <Text><DefinedTermEn>International Section</DefinedTermEn> means that part of the river</Text>
            </Provision>
          </Provision>
        </Group>
        <Group>
          <GroupHeading><Label><Emphasis style="italic">Article II</Emphasis></Label></GroupHeading>
          <Provision><Text>Canada will do all in its power...</Text></Provision>
        </Group>
      </DocumentInternal>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    const contentHtml = scheduleSections[0]?.contentHtml || "";

    // Verify structure is preserved
    expect(contentHtml).toContain('<section class="document-internal">');
    expect(contentHtml).toContain('<div class="group">');
    expect(contentHtml).toContain('<h4 class="group-heading">');

    // Verify content is present
    expect(contentHtml).toContain("Agreement");
    expect(contentHtml).toContain("Article I");
    expect(contentHtml).toContain("Article II");
    expect(contentHtml).toContain("deep waterway");
    expect(contentHtml).toContain("International Section");
  });

  test("handles French DocumentInternal structure", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Statute xml:lang="fr">
  <Identification>
    <Chapter>
      <ConsolidatedNumber>T-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle>Loi test</ShortTitle>
  </Identification>
  <Body>
    <Section>
      <Label>1</Label>
      <Text>Contenu principal</Text>
    </Section>
  </Body>
  <Schedule id="annexe-1">
    <ScheduleFormHeading>
      <Label>ANNEXE</Label>
      <TitleText>Accord</TitleText>
    </ScheduleFormHeading>
    <DocumentInternal>
      <Group>
        <GroupHeading><Label><Emphasis style="italic">Article premier</Emphasis></Label></GroupHeading>
        <Provision><Text>Définitions applicables</Text></Provision>
      </Group>
    </DocumentInternal>
  </Schedule>
</Statute>`;
    const result = parseActXml(xml, "fr");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    const contentHtml = scheduleSections[0]?.contentHtml || "";
    expect(contentHtml).toContain('<section class="document-internal">');
    expect(contentHtml).toContain("Article premier");
    expect(contentHtml).toContain("Définitions applicables");
  });
});
