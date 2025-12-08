/**
 * Tests for ConventionAgreementTreaty parsing with full structural detail.
 */

import { expect, test } from "@playwright/test";
import { parseRegulationXml } from "@/lib/legislation/parser";

function createRegulationWithTreaty(treatyContent: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Regulation xml:lang="en">
  <Identification>
    <InstrumentNumber>SI/2024-999</InstrumentNumber>
    <LongTitle>Test Treaty Proclamation</LongTitle>
  </Identification>
  <Schedule spanlanguages="no" bilingual="no">
    <ConventionAgreementTreaty>
      ${treatyContent}
    </ConventionAgreementTreaty>
  </Schedule>
</Regulation>`;
}

test.describe("Treaty parsing with structural detail", () => {
  test("extracts main title from first heading", () => {
    const xml = createRegulationWithTreaty(`
      <Heading level="1">
        <TitleText>Agreement on Social Security Between Canada and Estonia</TitleText>
      </Heading>
      <Provision format-ref="indent-0-0">
        <Text>THE PARTIES AGREE AS FOLLOWS:</Text>
      </Provision>
    `);

    const result = parseRegulationXml(xml, "en");

    expect(result.regulation?.treaties).toHaveLength(1);
    const treaty = result.regulation?.treaties?.[0];
    expect(treaty?.title).toBe(
      "Agreement on Social Security Between Canada and Estonia"
    );
  });

  test("extracts section headings for Parts and Articles", () => {
    const xml = createRegulationWithTreaty(`
      <Heading level="1">
        <TitleText>Test Agreement</TitleText>
      </Heading>
      <Heading level="1">
        <Label>PART I</Label>
        <TitleText>General Provisions</TitleText>
      </Heading>
      <Heading level="2">
        <Label>ARTICLE 1</Label>
        <TitleText>Definitions</TitleText>
      </Heading>
      <Heading level="2">
        <Label>ARTICLE 2</Label>
        <TitleText>Scope</TitleText>
      </Heading>
      <Heading level="1">
        <Label>PART II</Label>
        <TitleText>Benefits</TitleText>
      </Heading>
    `);

    const result = parseRegulationXml(xml, "en");

    expect(result.regulation?.treaties).toHaveLength(1);
    const treaty = result.regulation?.treaties?.[0];

    expect(treaty?.sections).toHaveLength(4);
    expect(treaty?.sections?.[0]).toMatchObject({
      level: 1,
      label: "PART I",
      title: "General Provisions",
    });
    expect(treaty?.sections?.[1]).toMatchObject({
      level: 2,
      label: "ARTICLE 1",
      title: "Definitions",
    });
    expect(treaty?.sections?.[2]).toMatchObject({
      level: 2,
      label: "ARTICLE 2",
      title: "Scope",
    });
    expect(treaty?.sections?.[3]).toMatchObject({
      level: 1,
      label: "PART II",
      title: "Benefits",
    });
  });

  test("extracts defined terms from treaty content", () => {
    const xml = createRegulationWithTreaty(`
      <Heading level="1">
        <TitleText>Test Agreement</TitleText>
      </Heading>
      <Heading level="2">
        <Label>ARTICLE 1</Label>
        <TitleText>Definitions</TitleText>
      </Heading>
      <Provision list-item="yes">
        <Label>1</Label>
        <Text>For the purposes of this Agreement:</Text>
        <Definition>
          <Text><DefinedTermEn>benefit</DefinedTermEn> means any pension or cash benefit payable under the legislation;</Text>
        </Definition>
        <Definition>
          <Text><DefinedTermEn>competent authority</DefinedTermEn> means the Minister responsible for social security;</Text>
        </Definition>
      </Provision>
    `);

    const result = parseRegulationXml(xml, "en");

    expect(result.regulation?.treaties).toHaveLength(1);
    const treaty = result.regulation?.treaties?.[0];

    expect(treaty?.definitions).toHaveLength(2);
    expect(treaty?.definitions?.[0]).toMatchObject({
      term: "benefit",
    });
    // The definition includes the term - verify it contains the definition text
    expect(treaty?.definitions?.[0]?.definition).toContain(
      "means any pension or cash benefit payable under the legislation"
    );
    expect(treaty?.definitions?.[1]).toMatchObject({
      term: "competent authority",
    });
    expect(treaty?.definitions?.[1]?.definition).toContain(
      "means the Minister responsible for social security"
    );
    expect(treaty?.definitions?.[0]?.definitionHtml).toContain("<dfn>");
  });

  test("extracts preamble text before PART headings", () => {
    const xml = createRegulationWithTreaty(`
      <Heading level="1">
        <TitleText>Test Agreement</TitleText>
      </Heading>
      <Provision format-ref="indent-0-0">
        <Text><Emphasis style="bold">CANADA</Emphasis></Text>
      </Provision>
      <Provision format-ref="indent-0-0">
        <Text><Emphasis style="bold">AND</Emphasis></Text>
      </Provision>
      <Provision format-ref="indent-0-0">
        <Text><Emphasis style="bold">THE REPUBLIC OF ESTONIA</Emphasis></Text>
      </Provision>
      <Provision format-ref="indent-0-0">
        <Text>hereinafter referred to as "the Parties",</Text>
      </Provision>
      <Provision format-ref="indent-0-0">
        <Text>RESOLVED to co-operate in the field of social security,</Text>
      </Provision>
      <Provision format-ref="indent-0-0">
        <Text>HAVE AGREED AS FOLLOWS:</Text>
      </Provision>
      <Heading level="1">
        <Label>PART I</Label>
        <TitleText>General Provisions</TitleText>
      </Heading>
    `);

    const result = parseRegulationXml(xml, "en");

    expect(result.regulation?.treaties).toHaveLength(1);
    const treaty = result.regulation?.treaties?.[0];

    expect(treaty?.preamble).toBeDefined();
    expect(treaty?.preamble).toContain("CANADA");
    expect(treaty?.preamble).toContain("the Parties");
    expect(treaty?.preamble).toContain("RESOLVED");
    expect(treaty?.preambleHtml).toContain("<strong>");
  });

  test("extracts signature text with IN WITNESS WHEREOF", () => {
    const xml = createRegulationWithTreaty(`
      <Heading level="1">
        <TitleText>Test Agreement</TitleText>
      </Heading>
      <Heading level="2">
        <Label>ARTICLE 1</Label>
        <TitleText>Entry into Force</TitleText>
      </Heading>
      <Provision>
        <Text>This Agreement enters into force on the first day of the fourth month.</Text>
      </Provision>
      <Provision format-ref="indent-0-0">
        <Text><Emphasis style="italic"><Emphasis style="bold">IN WITNESS WHEREOF,</Emphasis> the undersigned have signed this Agreement.</Emphasis></Text>
      </Provision>
      <Provision format-ref="indent-0-0">
        <Text><Emphasis style="italic"><Emphasis style="bold">DONE</Emphasis> in duplicate at Ottawa, this 21st day of February, 2005.</Emphasis></Text>
      </Provision>
    `);

    const result = parseRegulationXml(xml, "en");

    expect(result.regulation?.treaties).toHaveLength(1);
    const treaty = result.regulation?.treaties?.[0];

    expect(treaty?.signatureText).toBeDefined();
    expect(treaty?.signatureText).toContain("IN WITNESS WHEREOF");
    expect(treaty?.signatureText).toContain("DONE");
    expect(treaty?.signatureTextHtml).toContain("<em>");
  });

  test("generates full HTML with proper structure", () => {
    const xml = createRegulationWithTreaty(`
      <Heading level="1">
        <TitleText>Test Agreement</TitleText>
      </Heading>
      <Heading level="1">
        <Label>PART I</Label>
        <TitleText>General Provisions</TitleText>
      </Heading>
      <Heading level="2">
        <Label>ARTICLE 1</Label>
        <TitleText>Definitions</TitleText>
      </Heading>
      <Provision list-item="yes">
        <Label>1</Label>
        <Text>First provision content.</Text>
      </Provision>
      <Provision>
        <Text>Unlabeled provision.</Text>
      </Provision>
    `);

    const result = parseRegulationXml(xml, "en");

    expect(result.regulation?.treaties).toHaveLength(1);
    const treaty = result.regulation?.treaties?.[0];

    expect(treaty?.textHtml).toBeDefined();
    expect(treaty?.textHtml).toContain('class="treaty-heading level-1"');
    expect(treaty?.textHtml).toContain('class="label"');
    expect(treaty?.textHtml).toContain('class="treaty-provision"');
  });

  test("preserves full text for backward compatibility", () => {
    const xml = createRegulationWithTreaty(`
      <Heading level="1">
        <TitleText>Test Agreement</TitleText>
      </Heading>
      <Provision>
        <Text>Content of the agreement.</Text>
      </Provision>
    `);

    const result = parseRegulationXml(xml, "en");

    expect(result.regulation?.treaties).toHaveLength(1);
    const treaty = result.regulation?.treaties?.[0];

    expect(treaty?.text).toBeDefined();
    expect(treaty?.text).toContain("Test Agreement");
    expect(treaty?.text).toContain("Content of the agreement");
  });

  test("handles treaties with chapters", () => {
    const xml = createRegulationWithTreaty(`
      <Heading level="1">
        <TitleText>Test Agreement</TitleText>
      </Heading>
      <Heading level="1">
        <Label>PART III</Label>
        <TitleText>Provisions Concerning Benefits</TitleText>
      </Heading>
      <Heading level="2">
        <Label>CHAPTER 1</Label>
        <TitleText>Totalizing Periods</TitleText>
      </Heading>
      <Heading level="3">
        <Label>ARTICLE 8</Label>
        <TitleText>Periods Under Legislation</TitleText>
      </Heading>
    `);

    const result = parseRegulationXml(xml, "en");

    expect(result.regulation?.treaties).toHaveLength(1);
    const treaty = result.regulation?.treaties?.[0];

    expect(treaty?.sections).toHaveLength(3);
    expect(treaty?.sections?.[0]).toMatchObject({
      level: 1,
      label: "PART III",
    });
    expect(treaty?.sections?.[1]).toMatchObject({
      level: 2,
      label: "CHAPTER 1",
      title: "Totalizing Periods",
    });
    expect(treaty?.sections?.[2]).toMatchObject({
      level: 3,
      label: "ARTICLE 8",
    });
  });

  test("extracts definitions from French documents", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Regulation xml:lang="fr">
  <Identification>
    <InstrumentNumber>TR/2024-999</InstrumentNumber>
    <LongTitle>Proclamation test</LongTitle>
  </Identification>
  <Schedule spanlanguages="no" bilingual="no">
    <ConventionAgreementTreaty>
      <Heading level="1">
        <TitleText>Accord de sécurité sociale</TitleText>
      </Heading>
      <Provision list-item="yes">
        <Label>1</Label>
        <Text>Aux fins du présent Accord :</Text>
        <Definition>
          <Text><DefinedTermFr>prestation</DefinedTermFr> désigne toute pension ou allocation en espèces;</Text>
        </Definition>
      </Provision>
    </ConventionAgreementTreaty>
  </Schedule>
</Regulation>`;

    const result = parseRegulationXml(xml, "fr");

    expect(result.regulation?.treaties).toHaveLength(1);
    const treaty = result.regulation?.treaties?.[0];

    expect(treaty?.definitions).toHaveLength(1);
    expect(treaty?.definitions?.[0]?.term).toBe("prestation");
  });
});
