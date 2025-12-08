/**
 * Tests for LIMS metadata extraction from Definition elements.
 *
 * Task 6: Extract lims:fid, lims:id, and lims:inforce-start-date from
 * Definition elements and populate defined_terms.lims_metadata.
 */

import { expect, test } from "@playwright/test";
import { parseActXml } from "@/lib/legislation/parser";

/**
 * Helper to create a minimal Act XML with a Definition containing LIMS attributes
 */
function createActXmlWithDefinition(
  definitionAttrs: string,
  definedTerm: string,
  definitionText: string
): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Statute xml:lang="en" xmlns:lims="http://justice.gc.ca/lims">
  <Identification>
    <Chapter>
      <ConsolidatedNumber>T-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle>Test Act</ShortTitle>
  </Identification>
  <Body>
    <Section>
      <MarginalNote>Definitions</MarginalNote>
      <Label>1</Label>
      <Text>In this Act,</Text>
      <Definition ${definitionAttrs}>
        <Text><DefinedTermEn>${definedTerm}</DefinedTermEn> ${definitionText}</Text>
      </Definition>
    </Section>
  </Body>
</Statute>`;
}

test.describe("LIMS metadata extraction for defined terms", () => {
  test("extracts lims:fid from Definition element", () => {
    const xml = createActXmlWithDefinition(
      'lims:fid="12345"',
      "term",
      "means a test term."
    );
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(1);
    expect(result.definedTerms[0].limsMetadata).toBeDefined();
    expect(result.definedTerms[0].limsMetadata?.fid).toBe("12345");
  });

  test("extracts lims:id from Definition element", () => {
    const xml = createActXmlWithDefinition(
      'lims:id="67890"',
      "term",
      "means a test term."
    );
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(1);
    expect(result.definedTerms[0].limsMetadata).toBeDefined();
    expect(result.definedTerms[0].limsMetadata?.id).toBe("67890");
  });

  test("extracts lims:inforce-start-date from Definition element", () => {
    const xml = createActXmlWithDefinition(
      'lims:inforce-start-date="2020-01-15"',
      "term",
      "means a test term."
    );
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(1);
    expect(result.definedTerms[0].limsMetadata).toBeDefined();
    expect(result.definedTerms[0].limsMetadata?.inForceStartDate).toBe(
      "2020-01-15"
    );
  });

  test("extracts all LIMS attributes together", () => {
    const xml = createActXmlWithDefinition(
      'lims:fid="111" lims:id="222" lims:inforce-start-date="2021-06-01"',
      "combined term",
      "means all attributes are present."
    );
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(1);
    const metadata = result.definedTerms[0].limsMetadata;
    expect(metadata).toBeDefined();
    expect(metadata?.fid).toBe("111");
    expect(metadata?.id).toBe("222");
    expect(metadata?.inForceStartDate).toBe("2021-06-01");
  });

  test("handles Definition without LIMS attributes", () => {
    const xml = createActXmlWithDefinition(
      "",
      "plain term",
      "means no LIMS attributes."
    );
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(1);
    expect(result.definedTerms[0].limsMetadata).toBeUndefined();
  });

  test("extracts LIMS metadata from multiple definitions", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Statute xml:lang="en" xmlns:lims="http://justice.gc.ca/lims">
  <Identification>
    <Chapter>
      <ConsolidatedNumber>T-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle>Test Act</ShortTitle>
  </Identification>
  <Body>
    <Section>
      <MarginalNote>Definitions</MarginalNote>
      <Label>1</Label>
      <Text>In this Act,</Text>
      <Definition lims:fid="100" lims:id="101">
        <Text><DefinedTermEn>first term</DefinedTermEn> means the first.</Text>
      </Definition>
      <Definition lims:fid="200" lims:id="201" lims:inforce-start-date="2022-03-01">
        <Text><DefinedTermEn>second term</DefinedTermEn> means the second.</Text>
      </Definition>
      <Definition lims:fid="300">
        <Text><DefinedTermEn>third term</DefinedTermEn> means the third.</Text>
      </Definition>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(3);

    // First term
    const first = result.definedTerms.find((t) => t.term === "first term");
    expect(first?.limsMetadata?.fid).toBe("100");
    expect(first?.limsMetadata?.id).toBe("101");
    expect(first?.limsMetadata?.inForceStartDate).toBeUndefined();

    // Second term
    const second = result.definedTerms.find((t) => t.term === "second term");
    expect(second?.limsMetadata?.fid).toBe("200");
    expect(second?.limsMetadata?.id).toBe("201");
    expect(second?.limsMetadata?.inForceStartDate).toBe("2022-03-01");

    // Third term
    const third = result.definedTerms.find((t) => t.term === "third term");
    expect(third?.limsMetadata?.fid).toBe("300");
    expect(third?.limsMetadata?.id).toBeUndefined();
  });

  test("extracts LIMS metadata from French definition", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Statute xml:lang="fr" xmlns:lims="http://justice.gc.ca/lims">
  <Identification>
    <Chapter>
      <ConsolidatedNumber>T-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle>Loi test</ShortTitle>
  </Identification>
  <Body>
    <Section>
      <MarginalNote>Définitions</MarginalNote>
      <Label>1</Label>
      <Text>Les définitions qui suivent s'appliquent à la présente loi.</Text>
      <Definition lims:fid="555" lims:id="556" lims:inforce-start-date="2019-04-01">
        <Text><DefinedTermFr>terme français</DefinedTermFr> signifie un terme en français.</Text>
      </Definition>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "fr");

    expect(result.definedTerms.length).toBe(1);
    expect(result.definedTerms[0].term).toBe("terme français");
    expect(result.definedTerms[0].language).toBe("fr");
    expect(result.definedTerms[0].limsMetadata?.fid).toBe("555");
    expect(result.definedTerms[0].limsMetadata?.id).toBe("556");
    expect(result.definedTerms[0].limsMetadata?.inForceStartDate).toBe(
      "2019-04-01"
    );
  });

  test("extracts lims:enacted-date from Definition element", () => {
    const xml = createActXmlWithDefinition(
      'lims:enacted-date="2015-07-01"',
      "enacted term",
      "means a term with enacted date."
    );
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(1);
    expect(result.definedTerms[0].limsMetadata?.enactedDate).toBe("2015-07-01");
  });

  test("extracts all available LIMS fields", () => {
    const xml = createActXmlWithDefinition(
      'lims:fid="999" lims:id="888" lims:enacted-date="2010-01-01" lims:inforce-start-date="2010-06-01" lims:pit-date="2023-01-01" lims:current-date="2024-01-01"',
      "complete term",
      "has all LIMS fields."
    );
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(1);
    const metadata = result.definedTerms[0].limsMetadata;
    expect(metadata?.fid).toBe("999");
    expect(metadata?.id).toBe("888");
    expect(metadata?.enactedDate).toBe("2010-01-01");
    expect(metadata?.inForceStartDate).toBe("2010-06-01");
    expect(metadata?.pitDate).toBe("2023-01-01");
    expect(metadata?.currentDate).toBe("2024-01-01");
  });
});
