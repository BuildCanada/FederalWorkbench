/**
 * Tests for capturing internal references (XRefInternal) within legislation.
 */

import { expect, test } from "@playwright/test";
import { parseActXml } from "@/lib/legislation/parser";

function createActXml(sectionContent: string): string {
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

test.describe("Internal references", () => {
  test("captures multiple XRefInternal entries within a section", () => {
    const xml = createActXml(
      "See <XRefInternal>5</XRefInternal> and <XRefInternal>6(1)</XRefInternal>."
    );
    const result = parseActXml(xml, "en");

    const refs = result.sections[0]?.internalReferences;
    expect(refs).toBeDefined();
    expect(refs).toHaveLength(2);
    expect(refs?.map((ref) => ref.targetLabel)).toEqual(["5", "6(1)"]);
  });

  test("preserves target identifiers when provided on XRefInternal", () => {
    const xml = createActXml(
      'See <XRefInternal idref="sec-2">section 2</XRefInternal>.'
    );
    const result = parseActXml(xml, "en");

    const refs = result.sections[0]?.internalReferences;
    expect(refs).toBeDefined();
    expect(refs?.[0]).toMatchObject({
      targetLabel: "section 2",
      targetId: "sec-2",
      referenceText: "section 2",
    });
  });

  test("extracts internal references inside schedule list items", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
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
      <Text>Base section</Text>
    </Section>
  </Body>
  <Schedule id="sched-1">
    <ScheduleFormHeading>
      <Label>SCHEDULE</Label>
      <TitleText>Forms</TitleText>
    </ScheduleFormHeading>
    <List>
      <Item>
        <Label>1</Label>
        <Text>Complete according to section <XRefInternal>42</XRefInternal>.</Text>
      </Item>
    </List>
  </Schedule>
</Statute>`;

    const result = parseActXml(xml, "en");
    const scheduleSection = result.sections.find(
      (section) => section.sectionType === "schedule"
    );

    expect(scheduleSection?.internalReferences).toBeDefined();
    expect(scheduleSection?.internalReferences).toHaveLength(1);
    expect(scheduleSection?.internalReferences?.[0]).toMatchObject({
      targetLabel: "42",
    });
  });
});
