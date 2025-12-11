/**
 * Tests for enacting clause extraction from Introduction.Enacts element.
 *
 * The enacting clause is the operative "Now, therefore, Her Majesty..." text
 * that gives legal authority to the statute. This should be stored as its own
 * section with sectionType="enacts" so it can be queried separately.
 */

import { expect, test } from "@playwright/test";
import { parseActXml } from "@/lib/legislation/parser";
import { extractEnactingClause } from "@/lib/legislation/utils/document-metadata";

/**
 * Helper to create a minimal Act XML with Introduction containing Enacts
 */
function createActXmlWithEnacts(enactsContent: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Statute xml:lang="en" xmlns:lims="http://justice.gc.ca/lims">
  <Identification>
    <Chapter>
      <ConsolidatedNumber>T-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle>Test Act</ShortTitle>
  </Identification>
  <Introduction>
    <Preamble>
      <Provision><Text>Whereas something important;</Text></Provision>
    </Preamble>
    ${enactsContent}
  </Introduction>
  <Body>
    <Section>
      <Label>1</Label>
      <Text>Main section content</Text>
    </Section>
  </Body>
</Statute>`;
}

test.describe("extractEnactingClause utility function", () => {
  test("extracts enacting clause text from Enacts.Provision", () => {
    const intro = {
      Enacts: {
        Provision: {
          Text: "Now, therefore, Her Majesty, by and with the advice and consent of the Senate and House of Commons of Canada, enacts as follows:",
        },
      },
    };

    const result = extractEnactingClause(intro);

    expect(result).toBeDefined();
    expect(result?.text).toContain("Her Majesty");
    expect(result?.text).toContain("enacts as follows");
  });

  test("returns undefined when no Enacts element", () => {
    const intro = {
      Preamble: {
        Provision: {
          Text: "Whereas something;",
        },
      },
    };

    const result = extractEnactingClause(intro);

    expect(result).toBeUndefined();
  });

  test("returns undefined for null/undefined intro", () => {
    expect(extractEnactingClause(null)).toBeUndefined();
    expect(extractEnactingClause(undefined)).toBeUndefined();
  });

  test("extracts LIMS metadata from Enacts element", () => {
    const intro = {
      Enacts: {
        "@_lims:inforce-start-date": "2019-06-21",
        "@_lims:enacted-date": "2019-06-21",
        "@_lims:fid": "12345",
        "@_lims:id": "12345",
        Provision: {
          Text: "Now, therefore, Her Majesty enacts as follows:",
        },
      },
    };

    const result = extractEnactingClause(intro);

    expect(result?.limsMetadata).toBeDefined();
    expect(result?.limsMetadata?.fid).toBe("12345");
    expect(result?.inForceStartDate).toBe("2019-06-21");
    expect(result?.enactedDate).toBe("2019-06-21");
  });

  test("extracts formatting attributes from Provision", () => {
    const intro = {
      Enacts: {
        Provision: {
          "@_format-ref": "indent-0-0",
          "@_language-align": "yes",
          Text: "Now, therefore, Her Majesty enacts as follows:",
        },
      },
    };

    const result = extractEnactingClause(intro);

    expect(result?.formattingAttributes).toBeDefined();
    expect(result?.formattingAttributes?.formatRef).toBe("indent-0-0");
    expect(result?.formattingAttributes?.languageAlign).toBe(true);
  });

  test("handles multiple Provision elements", () => {
    const intro = {
      Enacts: {
        Provision: [
          { Text: "First part of enacting text." },
          { Text: "Second part of enacting text." },
        ],
      },
    };

    const result = extractEnactingClause(intro);

    expect(result).toBeDefined();
    expect(result?.text).toContain("First part");
    expect(result?.text).toContain("Second part");
  });

  test("handles direct text content without Provision wrapper", () => {
    const intro = {
      Enacts: {
        "#text": "Direct enacting clause text.",
      },
    };

    const result = extractEnactingClause(intro);

    expect(result).toBeDefined();
    expect(result?.text).toContain("Direct enacting clause text");
  });
});

test.describe("Enacting clause section creation in parser", () => {
  test("creates section with sectionType='enacts'", () => {
    const xml = createActXmlWithEnacts(`
      <Enacts lims:inforce-start-date="2019-06-21" lims:enacted-date="2019-06-21">
        <Provision format-ref="indent-0-0" language-align="yes">
          <Text>Now, therefore, Her Majesty, by and with the advice and consent of the Senate and House of Commons of Canada, enacts as follows:</Text>
        </Provision>
      </Enacts>
    `);
    const result = parseActXml(xml, "en");

    const enactsSections = result.sections.filter(
      (s) => s.sectionType === "enacts"
    );
    expect(enactsSections.length).toBe(1);

    const enactsSection = enactsSections[0];
    expect(enactsSection.sectionType).toBe("enacts");
    expect(enactsSection.content).toContain("Her Majesty");
    expect(enactsSection.content).toContain("enacts as follows");
  });

  test("enacts section has correct canonicalSectionId", () => {
    const xml = createActXmlWithEnacts(`
      <Enacts>
        <Provision><Text>Her Majesty enacts as follows:</Text></Provision>
      </Enacts>
    `);
    const result = parseActXml(xml, "en");

    const enactsSection = result.sections.find(
      (s) => s.sectionType === "enacts"
    );
    expect(enactsSection?.canonicalSectionId).toBe("T-1/en/enacts/0/clause");
  });

  test("enacts section has sectionOrder 0 (before body sections)", () => {
    const xml = createActXmlWithEnacts(`
      <Enacts>
        <Provision><Text>Her Majesty enacts as follows:</Text></Provision>
      </Enacts>
    `);
    const result = parseActXml(xml, "en");

    const enactsSection = result.sections.find(
      (s) => s.sectionType === "enacts"
    );
    expect(enactsSection?.sectionOrder).toBe(0);

    // Body sections should have higher order
    const bodySections = result.sections.filter(
      (s) => s.sectionType === "section"
    );
    expect(bodySections.length).toBeGreaterThan(0);
    expect(bodySections[0].sectionOrder).toBeGreaterThan(0);
  });

  test("enacts section has sectionLabel 'Enacting Clause'", () => {
    const xml = createActXmlWithEnacts(`
      <Enacts>
        <Provision><Text>Her Majesty enacts as follows:</Text></Provision>
      </Enacts>
    `);
    const result = parseActXml(xml, "en");

    const enactsSection = result.sections.find(
      (s) => s.sectionType === "enacts"
    );
    expect(enactsSection?.sectionLabel).toBe("Enacting Clause");
  });

  test("enacts section preserves LIMS metadata", () => {
    const xml = createActXmlWithEnacts(`
      <Enacts lims:inforce-start-date="2019-06-21" lims:enacted-date="2019-06-21" lims:fid="12345" lims:id="12345">
        <Provision><Text>Her Majesty enacts as follows:</Text></Provision>
      </Enacts>
    `);
    const result = parseActXml(xml, "en");

    const enactsSection = result.sections.find(
      (s) => s.sectionType === "enacts"
    );
    expect(enactsSection?.limsMetadata).toBeDefined();
    expect(enactsSection?.inForceStartDate).toBe("2019-06-21");
    expect(enactsSection?.enactedDate).toBe("2019-06-21");
  });

  test("no enacts section created when Introduction.Enacts missing", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Statute xml:lang="en">
  <Identification>
    <Chapter>
      <ConsolidatedNumber>T-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle>Test Act</ShortTitle>
  </Identification>
  <Introduction>
    <Preamble>
      <Provision><Text>Whereas something important;</Text></Provision>
    </Preamble>
  </Introduction>
  <Body>
    <Section>
      <Label>1</Label>
      <Text>Main section content</Text>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "en");

    const enactsSections = result.sections.filter(
      (s) => s.sectionType === "enacts"
    );
    expect(enactsSections.length).toBe(0);
  });

  test("handles French enacting clause", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Statute xml:lang="fr" xmlns:lims="http://justice.gc.ca/lims">
  <Identification>
    <Chapter>
      <ConsolidatedNumber>T-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle>Loi test</ShortTitle>
  </Identification>
  <Introduction>
    <Enacts>
      <Provision>
        <Text>Sa Majesté, sur l'avis et avec le consentement du Sénat et de la Chambre des communes du Canada, édicte :</Text>
      </Provision>
    </Enacts>
  </Introduction>
  <Body>
    <Section>
      <Label>1</Label>
      <Text>Contenu principal</Text>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "fr");

    const enactsSection = result.sections.find(
      (s) => s.sectionType === "enacts"
    );
    expect(enactsSection).toBeDefined();
    expect(enactsSection?.canonicalSectionId).toBe("T-1/fr/enacts/0/clause");
    expect(enactsSection?.content).toContain("Sa Majesté");
    expect(enactsSection?.content).toContain("édicte");
    expect(enactsSection?.language).toBe("fr");
  });

  test("enacts section is first in sections array", () => {
    const xml = createActXmlWithEnacts(`
      <Enacts>
        <Provision><Text>Her Majesty enacts as follows:</Text></Provision>
      </Enacts>
    `);
    const result = parseActXml(xml, "en");

    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.sections[0].sectionType).toBe("enacts");
  });

  test("actId is set correctly on enacts section", () => {
    const xml = createActXmlWithEnacts(`
      <Enacts>
        <Provision><Text>Her Majesty enacts as follows:</Text></Provision>
      </Enacts>
    `);
    const result = parseActXml(xml, "en");

    const enactsSection = result.sections.find(
      (s) => s.sectionType === "enacts"
    );
    expect(enactsSection?.actId).toBe("T-1");
    expect(enactsSection?.regulationId).toBeUndefined();
  });
});

test.describe("Real-world enacting clause examples", () => {
  test("parses Accessible Canada Act style enacting clause", () => {
    const xml = createActXmlWithEnacts(`
      <Enacts lims:inforce-start-date="2019-06-21" lims:enacted-date="2019-06-21" lims:fid="1153389" lims:id="1153389">
        <Provision lims:inforce-start-date="2019-06-21" lims:enacted-date="2019-06-21" lims:fid="1153390" lims:id="1153390" format-ref="indent-0-0" language-align="yes">
          <Text>Now, therefore, Her Majesty, by and with the advice and consent of the Senate and House of Commons of Canada, enacts as follows:</Text>
        </Provision>
      </Enacts>
    `);
    const result = parseActXml(xml, "en");

    const enactsSection = result.sections.find(
      (s) => s.sectionType === "enacts"
    );
    expect(enactsSection).toBeDefined();
    expect(enactsSection?.content).toBe(
      "Now, therefore, Her Majesty, by and with the advice and consent of the Senate and House of Commons of Canada, enacts as follows:"
    );
    expect(enactsSection?.status).toBe("in-force");
  });

  test("enacts section has empty hierarchyPath", () => {
    const xml = createActXmlWithEnacts(`
      <Enacts>
        <Provision><Text>Her Majesty enacts as follows:</Text></Provision>
      </Enacts>
    `);
    const result = parseActXml(xml, "en");

    const enactsSection = result.sections.find(
      (s) => s.sectionType === "enacts"
    );
    expect(enactsSection?.hierarchyPath).toEqual([]);
  });
});
