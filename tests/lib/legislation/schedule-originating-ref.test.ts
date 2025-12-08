/**
 * Tests for OriginatingRef extraction from schedule headers.
 *
 * Task 5: Extract OriginatingRef element from ScheduleFormHeading
 * and persist it to sections via scheduleOriginatingRef field.
 */

import { expect, test } from "@playwright/test";
import { parseActXml } from "@/lib/legislation/parser";

/**
 * Helper to create a minimal Act XML with a Schedule containing OriginatingRef
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
    ${scheduleContent}
  </Schedule>
</Statute>`;
}

test.describe("OriginatingRef extraction from schedule headers", () => {
  test("extracts OriginatingRef from ScheduleFormHeading", () => {
    const xml = createActXmlWithSchedule(`
      <ScheduleFormHeading>
        <Label>SCHEDULE</Label>
        <OriginatingRef>(Section 2)</OriginatingRef>
        <TitleText>Administrative Tribunals</TitleText>
      </ScheduleFormHeading>
      <List>
        <Item><Label>1</Label><Text>Item content</Text></Item>
      </List>
    `);
    const result = parseActXml(xml, "en");

    // Find schedule sections
    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    // All schedule sections should have the originating ref
    for (const section of scheduleSections) {
      expect(section.scheduleOriginatingRef).toBe("(Section 2)");
    }
  });

  test("extracts complex OriginatingRef with subsections", () => {
    const xml = createActXmlWithSchedule(`
      <ScheduleFormHeading>
        <Label>SCHEDULE I</Label>
        <OriginatingRef>(Subsections 4(1) and 5(2))</OriginatingRef>
        <TitleText>Designated Substances</TitleText>
      </ScheduleFormHeading>
      <List>
        <Item><Label>1</Label><Text>Substance A</Text></Item>
      </List>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    for (const section of scheduleSections) {
      expect(section.scheduleOriginatingRef).toBe(
        "(Subsections 4(1) and 5(2))"
      );
    }
  });

  test("extracts OriginatingRef with multiple section references", () => {
    const xml = createActXmlWithSchedule(`
      <ScheduleFormHeading>
        <Label>SCHEDULE II</Label>
        <OriginatingRef>(Sections 3, 5, 7 and 12)</OriginatingRef>
        <TitleText>Controlled Items</TitleText>
      </ScheduleFormHeading>
      <List>
        <Item><Label>1</Label><Text>Item 1</Text></Item>
      </List>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    for (const section of scheduleSections) {
      expect(section.scheduleOriginatingRef).toBe("(Sections 3, 5, 7 and 12)");
    }
  });

  test("handles schedule without OriginatingRef", () => {
    const xml = createActXmlWithSchedule(`
      <ScheduleFormHeading>
        <Label>SCHEDULE</Label>
        <TitleText>Form of Notice</TitleText>
      </ScheduleFormHeading>
      <List>
        <Item><Label>1</Label><Text>Notice content</Text></Item>
      </List>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    for (const section of scheduleSections) {
      expect(section.scheduleOriginatingRef).toBeUndefined();
    }
  });

  test("preserves scheduleLabel and scheduleTitle with OriginatingRef", () => {
    const xml = createActXmlWithSchedule(`
      <ScheduleFormHeading>
        <Label>SCHEDULE III</Label>
        <OriginatingRef>(Section 8)</OriginatingRef>
        <TitleText>Prohibited Activities</TitleText>
      </ScheduleFormHeading>
      <List>
        <Item><Label>1</Label><Text>Activity content</Text></Item>
      </List>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    // Check schedule metadata is preserved alongside originating ref
    const section = scheduleSections[0];
    expect(section.scheduleOriginatingRef).toBe("(Section 8)");
    // The section label should contain the schedule label
    expect(section.sectionLabel).toContain("SCHEDULE");
  });

  test("extracts OriginatingRef from FormGroup within schedule", () => {
    const xml = createActXmlWithSchedule(`
      <ScheduleFormHeading>
        <Label>SCHEDULE</Label>
        <OriginatingRef>(Paragraph 6(a))</OriginatingRef>
        <TitleText>Application Form</TitleText>
      </ScheduleFormHeading>
      <FormGroup>
        <Form>Form content here</Form>
      </FormGroup>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    for (const section of scheduleSections) {
      expect(section.scheduleOriginatingRef).toBe("(Paragraph 6(a))");
    }
  });

  test("extracts OriginatingRef from TableGroup within schedule", () => {
    const xml = createActXmlWithSchedule(`
      <ScheduleFormHeading>
        <Label>SCHEDULE IV</Label>
        <OriginatingRef>(Section 10)</OriginatingRef>
        <TitleText>Tariff Table</TitleText>
      </ScheduleFormHeading>
      <TableGroup>
        <table>
          <tgroup cols="2">
            <tbody>
              <row>
                <entry>Item 1</entry>
                <entry>Value</entry>
              </row>
            </tbody>
          </tgroup>
        </table>
      </TableGroup>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    for (const section of scheduleSections) {
      expect(section.scheduleOriginatingRef).toBe("(Section 10)");
    }
  });

  test("handles French OriginatingRef format", () => {
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
      <OriginatingRef>(article 2)</OriginatingRef>
      <TitleText>Tribunaux administratifs</TitleText>
    </ScheduleFormHeading>
    <List>
      <Item><Label>1</Label><Text>Contenu</Text></Item>
    </List>
  </Schedule>
</Statute>`;
    const result = parseActXml(xml, "fr");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    for (const section of scheduleSections) {
      expect(section.scheduleOriginatingRef).toBe("(article 2)");
    }
  });
});
