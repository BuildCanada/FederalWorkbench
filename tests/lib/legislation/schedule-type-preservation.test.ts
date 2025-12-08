/**
 * Tests for schedule type/provenance attribute preservation.
 *
 * Task: Preserve schedule type/provenance attributes (e.g., amending/not-in-force)
 * instead of forcing sectionType to "schedule" for all schedule content.
 */

import { expect, test } from "@playwright/test";
import { parseActXml } from "@/lib/legislation/parser";

/**
 * Helper to create an Act XML with a schedule
 */
function createActXml(scheduleContent: string): string {
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
  ${scheduleContent}
</Statute>`;
}

test.describe("Schedule type preservation", () => {
  test("NifProvs schedule produces amending sectionType", () => {
    const xml = createActXml(`
      <Schedule id="NifProvs">
        <ScheduleFormHeading type="amending">
          <TitleText>AMENDMENTS NOT IN FORCE</TitleText>
        </ScheduleFormHeading>
        <BillPiece>
          <RelatedOrNotInForce>
            <Section type="amending">
              <Label>20</Label>
              <Text>Section 5 of the Act is replaced by the following:</Text>
            </Section>
          </RelatedOrNotInForce>
        </BillPiece>
      </Schedule>
    `);
    const result = parseActXml(xml, "en");

    // Find sections from the NifProvs schedule
    const scheduleSections = result.sections.filter(
      (s) => s.scheduleId === "NifProvs"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    // All NifProvs schedule sections should be amending type
    for (const section of scheduleSections) {
      expect(section.sectionType).toBe("amending");
    }
  });

  test("Schedule with ScheduleFormHeading type=amending produces amending sectionType", () => {
    const xml = createActXml(`
      <Schedule id="custom-amending-schedule">
        <ScheduleFormHeading type="amending">
          <Label>SCHEDULE</Label>
          <TitleText>Amending Provisions</TitleText>
        </ScheduleFormHeading>
        <List>
          <Item><Label>1</Label><Text>Amendment item</Text></Item>
        </List>
      </Schedule>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.scheduleId === "custom-amending-schedule"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    for (const section of scheduleSections) {
      expect(section.sectionType).toBe("amending");
    }
  });

  test("Section with type=amending inside schedule produces amending sectionType", () => {
    const xml = createActXml(`
      <Schedule id="regular-schedule">
        <ScheduleFormHeading>
          <Label>SCHEDULE</Label>
          <TitleText>Mixed Content</TitleText>
        </ScheduleFormHeading>
        <Section type="amending">
          <Label>10</Label>
          <Text>This is an amending section</Text>
        </Section>
      </Schedule>
    `);
    const result = parseActXml(xml, "en");

    // Find the amending section
    const amendingSections = result.sections.filter(
      (s) => s.sectionLabel === "10"
    );
    expect(amendingSections.length).toBe(1);
    expect(amendingSections[0].sectionType).toBe("amending");
  });

  test("Section with type=CIF inside schedule produces amending sectionType", () => {
    const xml = createActXml(`
      <Schedule id="regular-schedule">
        <ScheduleFormHeading>
          <Label>SCHEDULE</Label>
          <TitleText>Coming into Force</TitleText>
        </ScheduleFormHeading>
        <Section type="CIF">
          <Label>15</Label>
          <Text>This Act comes into force on a day to be fixed</Text>
        </Section>
      </Schedule>
    `);
    const result = parseActXml(xml, "en");

    const cifSections = result.sections.filter((s) => s.sectionLabel === "15");
    expect(cifSections.length).toBe(1);
    expect(cifSections[0].sectionType).toBe("amending");
  });

  test("Regular schedule produces schedule sectionType", () => {
    const xml = createActXml(`
      <Schedule id="regular-schedule">
        <ScheduleFormHeading>
          <Label>SCHEDULE I</Label>
          <OriginatingRef>(Section 2)</OriginatingRef>
          <TitleText>Designated Substances</TitleText>
        </ScheduleFormHeading>
        <List>
          <Item><Label>1</Label><Text>Substance A</Text></Item>
          <Item><Label>2</Label><Text>Substance B</Text></Item>
        </List>
      </Schedule>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.scheduleId === "regular-schedule"
    );
    expect(scheduleSections.length).toBe(2);

    for (const section of scheduleSections) {
      expect(section.sectionType).toBe("schedule");
    }
  });

  test("RelatedProvs schedule without amending sections produces schedule sectionType", () => {
    const xml = createActXml(`
      <Schedule id="RelatedProvs">
        <ScheduleFormHeading>
          <TitleText>RELATED PROVISIONS</TitleText>
        </ScheduleFormHeading>
        <BillPiece>
          <RelatedOrNotInForce>
            <Section>
              <Label>45</Label>
              <Text>Related provision text</Text>
            </Section>
          </RelatedOrNotInForce>
        </BillPiece>
      </Schedule>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.scheduleId === "RelatedProvs"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    // RelatedProvs without explicit amending type should be "schedule"
    for (const section of scheduleSections) {
      expect(section.sectionType).toBe("schedule");
    }
  });

  test("FormGroup content inherits schedule type", () => {
    const xml = createActXml(`
      <Schedule id="NifProvs">
        <ScheduleFormHeading type="amending">
          <TitleText>AMENDMENTS NOT IN FORCE</TitleText>
        </ScheduleFormHeading>
        <FormGroup>
          <Form>Amendment form content</Form>
        </FormGroup>
      </Schedule>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.scheduleId === "NifProvs"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    for (const section of scheduleSections) {
      expect(section.sectionType).toBe("amending");
    }
  });

  test("TableGroup content inherits schedule type", () => {
    const xml = createActXml(`
      <Schedule id="NifProvs">
        <ScheduleFormHeading type="amending">
          <TitleText>AMENDMENTS NOT IN FORCE</TitleText>
        </ScheduleFormHeading>
        <TableGroup>
          <table>
            <tgroup cols="2">
              <tbody>
                <row>
                  <entry>Amendment</entry>
                  <entry>Date</entry>
                </row>
              </tbody>
            </tgroup>
          </table>
        </TableGroup>
      </Schedule>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.scheduleId === "NifProvs"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    for (const section of scheduleSections) {
      expect(section.sectionType).toBe("amending");
    }
  });

  test("scheduleType is captured in schedule context", () => {
    const xml = createActXml(`
      <Schedule id="test-schedule">
        <ScheduleFormHeading type="amending">
          <Label>SCHEDULE</Label>
          <TitleText>Amending Schedule</TitleText>
        </ScheduleFormHeading>
        <List>
          <Item><Label>1</Label><Text>Content</Text></Item>
        </List>
      </Schedule>
    `);
    const result = parseActXml(xml, "en");

    // The schedule sections should exist
    const scheduleSections = result.sections.filter(
      (s) => s.scheduleId === "test-schedule"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    // And they should have amending type due to the heading type
    expect(scheduleSections[0].sectionType).toBe("amending");
  });

  test("French NifProvs schedule produces amending sectionType", () => {
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
  <Schedule id="NifProvs">
    <ScheduleFormHeading type="amending">
      <TitleText>MODIFICATIONS NON EN VIGUEUR</TitleText>
    </ScheduleFormHeading>
    <BillPiece>
      <RelatedOrNotInForce>
        <Section type="amending">
          <Label>20</Label>
          <Text>L'article 5 est remplacé</Text>
        </Section>
      </RelatedOrNotInForce>
    </BillPiece>
  </Schedule>
</Statute>`;
    const result = parseActXml(xml, "fr");

    const scheduleSections = result.sections.filter(
      (s) => s.scheduleId === "NifProvs"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    for (const section of scheduleSections) {
      expect(section.sectionType).toBe("amending");
    }
  });
});
