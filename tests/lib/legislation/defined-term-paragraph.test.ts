/**
 * Tests for extracting paired terms from nested Paragraph elements.
 *
 * List-style definitions place the paired term at the end of the last paragraph:
 * <Definition>
 *   <Text><DefinedTermEn>business day</DefinedTermEn> means:</Text>
 *   <Paragraph>(a) Saturday;</Paragraph>
 *   <Paragraph>(c) ...(<DefinedTermFr>jour ouvrable</DefinedTermFr>)</Paragraph>
 * </Definition>
 */

import { expect, test } from "@playwright/test";
import { parseActXml } from "@/lib/legislation/parser";

test.describe("Paired term extraction from nested Paragraph elements", () => {
  test("extracts French paired term from nested Paragraph in English document", () => {
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
      <Definition>
        <Text><DefinedTermEn>business day</DefinedTermEn> means a day other than</Text>
        <Paragraph><Label>(a)</Label><Text>a Saturday;</Text></Paragraph>
        <Paragraph><Label>(b)</Label><Text>a Sunday; and</Text></Paragraph>
        <Paragraph><Label>(c)</Label><Text>a holiday. (<DefinedTermFr>jour ouvrable</DefinedTermFr>)</Text></Paragraph>
      </Definition>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(1);
    expect(result.definedTerms[0].term).toBe("business day");
    expect(result.definedTerms[0].pairedTerm).toBe("jour ouvrable");
    expect(result.definedTerms[0].language).toBe("en");
  });

  test("extracts English paired term from nested Paragraph in French document", () => {
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
      <Text>Les définitions qui suivent s'appliquent.</Text>
      <Definition>
        <Text><DefinedTermFr>jour ouvrable</DefinedTermFr> s'entend d'un jour autre que</Text>
        <Paragraph><Label>a)</Label><Text>le samedi;</Text></Paragraph>
        <Paragraph><Label>b)</Label><Text>le dimanche;</Text></Paragraph>
        <Paragraph><Label>c)</Label><Text>un jour férié. (<DefinedTermEn>business day</DefinedTermEn>)</Text></Paragraph>
      </Definition>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "fr");

    expect(result.definedTerms.length).toBe(1);
    expect(result.definedTerms[0].term).toBe("jour ouvrable");
    expect(result.definedTerms[0].pairedTerm).toBe("business day");
    expect(result.definedTerms[0].language).toBe("fr");
  });

  test("handles inline paired term (no paragraph search needed)", () => {
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
      <Definition>
        <Text><DefinedTermEn>Minister</DefinedTermEn> means the Minister of Justice. (<DefinedTermFr>ministre</DefinedTermFr>)</Text>
      </Definition>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(1);
    expect(result.definedTerms[0].term).toBe("Minister");
    expect(result.definedTerms[0].pairedTerm).toBe("ministre");
  });

  test("handles definition with no paired term", () => {
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
      <Definition>
        <Text><DefinedTermEn>unilingual term</DefinedTermEn> means a term only in English.</Text>
        <Paragraph><Label>(a)</Label><Text>first item;</Text></Paragraph>
        <Paragraph><Label>(b)</Label><Text>second item.</Text></Paragraph>
      </Definition>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(1);
    expect(result.definedTerms[0].term).toBe("unilingual term");
    expect(result.definedTerms[0].pairedTerm).toBeUndefined();
  });

  test("extracts paired term from Related Provisions style definition", () => {
    // This tests the pattern found in Related Provisions schedules where
    // the French term appears at the end of the last list item
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
      <Label>377</Label>
      <Text>The following definitions apply in sections 378 to 381.</Text>
      <Definition>
        <Text><DefinedTermEn>administrative tribunal</DefinedTermEn> means any of the following:</Text>
        <Paragraph><Label>(a)</Label><Text>the Canadian Human Rights Tribunal;</Text></Paragraph>
        <Paragraph><Label>(b)</Label><Text>the Canada Industrial Relations Board;</Text></Paragraph>
        <Paragraph><Label>(c)</Label><Text>the Competition Tribunal. (<DefinedTermFr>tribunal administratif</DefinedTermFr>)</Text></Paragraph>
      </Definition>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(1);
    expect(result.definedTerms[0].term).toBe("administrative tribunal");
    expect(result.definedTerms[0].pairedTerm).toBe("tribunal administratif");
  });

  test("handles multiple list-style definitions in same section", () => {
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
      <Definition>
        <Text><DefinedTermEn>government institution</DefinedTermEn> means</Text>
        <Paragraph><Label>(a)</Label><Text>any department;</Text></Paragraph>
        <Paragraph><Label>(b)</Label><Text>any Crown corporation. (<DefinedTermFr>institution fédérale</DefinedTermFr>)</Text></Paragraph>
      </Definition>
      <Definition>
        <Text><DefinedTermEn>head</DefinedTermEn> means</Text>
        <Paragraph><Label>(a)</Label><Text>in the case of a department, the Minister;</Text></Paragraph>
        <Paragraph><Label>(b)</Label><Text>in any other case, the CEO. (<DefinedTermFr>responsable d'institution fédérale</DefinedTermFr>)</Text></Paragraph>
      </Definition>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(2);

    const govInst = result.definedTerms.find(
      (t) => t.term === "government institution"
    );
    expect(govInst?.pairedTerm).toBe("institution fédérale");

    const head = result.definedTerms.find((t) => t.term === "head");
    expect(head?.pairedTerm).toBe("responsable d'institution fédérale");
  });

  test("extracts paired term from deeply nested Subparagraph (Criminal Code pattern)", () => {
    // This tests the pattern found in Criminal Code section 2 where the
    // paired term appears in a deeply nested Subparagraph:
    // Definition > Paragraph > Subparagraph > Text > DefinedTermFr
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Statute xml:lang="en" xmlns:lims="http://justice.gc.ca/lims">
  <Identification>
    <Chapter>
      <ConsolidatedNumber>C-46</ConsolidatedNumber>
    </Chapter>
    <ShortTitle>Criminal Code</ShortTitle>
  </Identification>
  <Body>
    <Section>
      <MarginalNote>Definitions</MarginalNote>
      <Label>2</Label>
      <Text>In this Act,</Text>
      <Definition>
        <Text><DefinedTermEn>peace officer</DefinedTermEn> includes</Text>
        <Paragraph>
          <Label>(a)</Label>
          <Text>a mayor, warden, reeve, sheriff;</Text>
        </Paragraph>
        <Paragraph>
          <Label>(g)</Label>
          <Text>officers and non-commissioned members of the Canadian Forces who are</Text>
          <Subparagraph>
            <Label>(i)</Label>
            <Text>appointed for the purposes of section 156,</Text>
          </Subparagraph>
          <Subparagraph>
            <Label>(ii)</Label>
            <Text>employed on duties that necessitate they have peace officer powers; (<DefinedTermFr>agent de la paix</DefinedTermFr>)</Text>
          </Subparagraph>
        </Paragraph>
      </Definition>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(1);
    expect(result.definedTerms[0].term).toBe("peace officer");
    expect(result.definedTerms[0].pairedTerm).toBe("agent de la paix");
    expect(result.definedTerms[0].language).toBe("en");
  });

  test("extracts paired term from Paragraph > Clause > Subclause nesting", () => {
    // Some definitions use Clause/Subclause instead of Subparagraph
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
      <Definition>
        <Text><DefinedTermEn>authorized person</DefinedTermEn> means</Text>
        <Paragraph>
          <Label>(a)</Label>
          <Text>any person who</Text>
          <Subparagraph>
            <Label>(i)</Label>
            <Text>is designated by the Minister</Text>
            <Clause>
              <Label>(A)</Label>
              <Text>in writing, or</Text>
            </Clause>
            <Clause>
              <Label>(B)</Label>
              <Text>by regulation; (<DefinedTermFr>personne autorisée</DefinedTermFr>)</Text>
            </Clause>
          </Subparagraph>
        </Paragraph>
      </Definition>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(1);
    expect(result.definedTerms[0].term).toBe("authorized person");
    expect(result.definedTerms[0].pairedTerm).toBe("personne autorisée");
  });

  test("extracts paired term from ContinuedParagraph", () => {
    // Some definitions use ContinuedParagraph for the concluding text
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
      <Definition>
        <Text><DefinedTermEn>pilot in command</DefinedTermEn> means the pilot of an aircraft</Text>
        <Paragraph>
          <Label>(a)</Label>
          <Text>registered in Canada, or</Text>
        </Paragraph>
        <Paragraph>
          <Label>(b)</Label>
          <Text>leased without crew and operated by a qualified person,</Text>
          <ContinuedParagraph>
            <Text>while the aircraft is in flight; (<DefinedTermFr>commandant de bord</DefinedTermFr>)</Text>
          </ContinuedParagraph>
        </Paragraph>
      </Definition>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(1);
    expect(result.definedTerms[0].term).toBe("pilot in command");
    expect(result.definedTerms[0].pairedTerm).toBe("commandant de bord");
  });

  test("extracts paired term from ContinuedDefinition element", () => {
    // ContinuedDefinition is used when a definition continues after list items
    // Found in A-10.7.xml, A-12.xml
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
      <Definition>
        <Text><DefinedTermEn>qualifying entity</DefinedTermEn> means</Text>
        <Paragraph>
          <Label>(a)</Label>
          <Text>a corporation;</Text>
        </Paragraph>
        <Paragraph>
          <Label>(b)</Label>
          <Text>a partnership;</Text>
        </Paragraph>
        <ContinuedDefinition>
          <Text>that meets the prescribed criteria; (<DefinedTermFr>entité admissible</DefinedTermFr>)</Text>
        </ContinuedDefinition>
      </Definition>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(1);
    expect(result.definedTerms[0].term).toBe("qualifying entity");
    expect(result.definedTerms[0].pairedTerm).toBe("entité admissible");
  });

  test("extracts paired term from ContinuedSectionSubsection element", () => {
    // ContinuedSectionSubsection is used for continued subsection text
    // Found in A-0.6.xml
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
      <Definition>
        <Text><DefinedTermEn>federal institution</DefinedTermEn> includes</Text>
        <Paragraph>
          <Label>(a)</Label>
          <Text>any department of the Government of Canada;</Text>
        </Paragraph>
        <Paragraph>
          <Label>(b)</Label>
          <Text>any body or office listed in Schedule I;</Text>
        </Paragraph>
        <ContinuedSectionSubsection>
          <Text>but does not include the Senate or House of Commons; (<DefinedTermFr>institution fédérale</DefinedTermFr>)</Text>
        </ContinuedSectionSubsection>
      </Definition>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(1);
    expect(result.definedTerms[0].term).toBe("federal institution");
    expect(result.definedTerms[0].pairedTerm).toBe("institution fédérale");
  });

  test("does not extract cross-references from Paragraph when Definition exists in same section", () => {
    // When a section has Definition elements, terms in Paragraph elements that are
    // NOT inside Definition should not be extracted - they're cross-references.
    // Only the terms inside the Definition wrapper should be extracted.
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
      <MarginalNote>Definitions and application</MarginalNote>
      <Label>1</Label>
      <Text>In this Act,</Text>
      <Definition>
        <Text><DefinedTermEn>Minister</DefinedTermEn> means the Minister of Justice. (<DefinedTermFr>ministre</DefinedTermFr>)</Text>
      </Definition>
      <Paragraph>
        <Label>(2)</Label>
        <Text>The <DefinedTermEn>Minister</DefinedTermEn> may delegate powers under this section.</Text>
      </Paragraph>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "en");

    // Should only extract "Minister" once from the Definition element,
    // not from the cross-reference in the Paragraph (which shares the section)
    expect(result.definedTerms.length).toBe(1);
    expect(result.definedTerms[0].term).toBe("Minister");
    expect(result.definedTerms[0].pairedTerm).toBe("ministre");
  });

  test("deduplicates paired terms appearing at multiple nesting levels", () => {
    // Edge case: same paired term appears in multiple nested locations
    // Should only be extracted once
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
      <Definition>
        <Text><DefinedTermEn>special term</DefinedTermEn> means</Text>
        <Paragraph>
          <Label>(a)</Label>
          <Text>first meaning (<DefinedTermFr>terme spécial</DefinedTermFr>);</Text>
        </Paragraph>
        <Paragraph>
          <Label>(b)</Label>
          <Text>second meaning (<DefinedTermFr>terme spécial</DefinedTermFr>);</Text>
        </Paragraph>
      </Definition>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "en");

    expect(result.definedTerms.length).toBe(1);
    expect(result.definedTerms[0].term).toBe("special term");
    // Should get one of the paired terms (deduplicated)
    expect(result.definedTerms[0].pairedTerm).toBe("terme spécial");
  });
});
