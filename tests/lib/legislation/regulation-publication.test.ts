/**
 * Tests for Recommendation/Notice extraction on regulations.
 */

import { expect, test } from "@playwright/test";
import { parseRegulationXml } from "@/lib/legislation/parser";

function createRegulationXml(content: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Regulation xml:lang="en">
  <Identification>
    <InstrumentNumber>SOR/2024-999</InstrumentNumber>
    <ShortTitle>Test Regulation</ShortTitle>
  </Identification>
  ${content}
  <Body>
    <Section>
      <Label>1</Label>
      <Text>Body content.</Text>
    </Section>
  </Body>
</Regulation>`;
}

test.describe("Regulation Recommendation/Notice extraction", () => {
  test("captures Recommendation blocks with section linkage", () => {
    const xml = createRegulationXml(`
      <Recommendation>
        <Provision>
          <Text>The Minister recommends action under <XRefInternal>7</XRefInternal>.</Text>
        </Provision>
      </Recommendation>
    `);

    const result = parseRegulationXml(xml, "en");

    expect(result.regulation?.recommendations).toHaveLength(1);
    const rec = result.regulation?.recommendations?.[0];
    expect(rec).toMatchObject({
      type: "recommendation",
      publicationRequirement: undefined,
    });
    expect(rec?.sourceSections).toEqual(["7"]);
    expect(rec?.contentHtml).toContain('<a class="xref">');
  });

  test("captures Notice blocks with publication requirement, footnotes, and section linkage", () => {
    const xml = createRegulationXml(`
      <Notice publication-requirement="STATUTORY">
        <Provision>
          <Text>Publish before section <XRefInternal>9</XRefInternal> comes into force.</Text>
        </Provision>
        <Footnote id="fn1" placement="page" status="official">
          <Label>1</Label>
          <Text>Supporting note</Text>
        </Footnote>
      </Notice>
    `);

    const result = parseRegulationXml(xml, "en");

    expect(result.regulation?.notices).toHaveLength(1);
    const notice = result.regulation?.notices?.[0];
    expect(notice).toMatchObject({
      type: "notice",
      publicationRequirement: "STATUTORY",
    });
    expect(notice?.sourceSections).toEqual(["9"]);
    expect(notice?.footnotes?.[0]).toMatchObject({
      id: "fn1",
      text: "Supporting note",
    });
  });
});
