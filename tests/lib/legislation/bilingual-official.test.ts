/**
 * Tests for bilingual content handling and official title markers.
 *
 * Task 3: BilingualGroup/Language nodes are preserved with language attributes.
 * Task 4: ShortTitle status and ConsolidatedNumber official attributes are extracted.
 */

import { expect, test } from "@playwright/test";
import { parseActXml } from "@/lib/legislation/parser";

/**
 * Helper to create a minimal Act XML with content in a section
 */
function createActXmlWithContent(sectionContent: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Statute xml:lang="en">
  <Identification>
    <Chapter>
      <ConsolidatedNumber official="yes">T-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle status="official">Test Act</ShortTitle>
  </Identification>
  <Body>
    <Section>
      <Label>1</Label>
      ${sectionContent}
    </Section>
  </Body>
</Statute>`;
}

/**
 * Helper to create Act XML with specific identification attributes
 */
function createActXmlWithIdentification(
  shortTitleAttrs: string,
  consolidatedNumberAttrs: string
): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Statute xml:lang="en">
  <Identification>
    <Chapter>
      <ConsolidatedNumber ${consolidatedNumberAttrs}>T-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle ${shortTitleAttrs}>Test Act</ShortTitle>
  </Identification>
  <Body>
    <Section>
      <Label>1</Label>
      <Text>Content</Text>
    </Section>
  </Body>
</Statute>`;
}

test.describe("Bilingual content handling", () => {
  test("wraps BilingualGroup in div with class", () => {
    const xml = createActXmlWithContent(`
      <Text>
        <BilingualGroup>
          <BilingualItemEn>English text</BilingualItemEn>
          <BilingualItemFr>Texte français</BilingualItemFr>
        </BilingualGroup>
      </Text>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('<div class="bilingual-group">');
    expect(contentHtml).toContain("</div>");
  });

  test("wraps BilingualItemEn with lang=en", () => {
    const xml = createActXmlWithContent(`
      <Text>
        <BilingualGroup>
          <BilingualItemEn>Department of Finance</BilingualItemEn>
          <BilingualItemFr>Ministère des Finances</BilingualItemFr>
        </BilingualGroup>
      </Text>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('<span lang="en" class="bilingual-en">');
    expect(contentHtml).toContain("Department of Finance");
  });

  test("wraps BilingualItemFr with lang=fr", () => {
    const xml = createActXmlWithContent(`
      <Text>
        <BilingualGroup>
          <BilingualItemEn>Department of Finance</BilingualItemEn>
          <BilingualItemFr>Ministère des Finances</BilingualItemFr>
        </BilingualGroup>
      </Text>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('<span lang="fr" class="bilingual-fr">');
    expect(contentHtml).toContain("Ministère des Finances");
  });

  test("preserves Language element with xml:lang attribute", () => {
    const xml = createActXmlWithContent(`
      <Text>See <Language xml:lang="fr">Loi française</Language> for details.</Text>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('<span lang="fr">');
    expect(contentHtml).toContain("Loi française");
  });

  test("handles multiple bilingual items in sequence", () => {
    const xml = createActXmlWithContent(`
      <Text>
        <BilingualGroup>
          <BilingualItemEn>First English</BilingualItemEn>
          <BilingualItemFr>Premier français</BilingualItemFr>
          <BilingualItemEn>Second English</BilingualItemEn>
          <BilingualItemFr>Deuxième français</BilingualItemFr>
        </BilingualGroup>
      </Text>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain("First English");
    expect(contentHtml).toContain("Premier français");
    expect(contentHtml).toContain("Second English");
    expect(contentHtml).toContain("Deuxième français");

    // Count occurrences of bilingual spans
    const enMatches = contentHtml?.match(/class="bilingual-en"/g) || [];
    const frMatches = contentHtml?.match(/class="bilingual-fr"/g) || [];
    expect(enMatches.length).toBe(2);
    expect(frMatches.length).toBe(2);
  });

  test("sets hasBilingualGroup flag in content flags", () => {
    const xml = createActXmlWithContent(`
      <Text>
        <BilingualGroup>
          <BilingualItemEn>English</BilingualItemEn>
          <BilingualItemFr>Français</BilingualItemFr>
        </BilingualGroup>
      </Text>
    `);
    const result = parseActXml(xml, "en");

    expect(result.sections[0].contentFlags?.hasBilingualGroup).toBe(true);
  });
});

test.describe("Official title markers", () => {
  test("extracts shortTitleStatus=official", () => {
    const xml = createActXmlWithIdentification(
      'status="official"',
      'official="yes"'
    );
    const result = parseActXml(xml, "en");

    expect(result.act?.shortTitleStatus).toBe("official");
  });

  test("extracts shortTitleStatus=unofficial", () => {
    const xml = createActXmlWithIdentification(
      'status="unofficial"',
      'official="yes"'
    );
    const result = parseActXml(xml, "en");

    expect(result.act?.shortTitleStatus).toBe("unofficial");
  });

  test("extracts consolidatedNumberOfficial=yes", () => {
    const xml = createActXmlWithIdentification(
      'status="official"',
      'official="yes"'
    );
    const result = parseActXml(xml, "en");

    expect(result.act?.consolidatedNumberOfficial).toBe("yes");
  });

  test("extracts consolidatedNumberOfficial=no", () => {
    const xml = createActXmlWithIdentification(
      'status="official"',
      'official="no"'
    );
    const result = parseActXml(xml, "en");

    expect(result.act?.consolidatedNumberOfficial).toBe("no");
  });

  test("handles missing status attribute", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
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
      <Text>Content</Text>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "en");

    expect(result.act?.shortTitleStatus).toBeUndefined();
    expect(result.act?.consolidatedNumberOfficial).toBeUndefined();
  });

  test("handles LIMS attributes alongside status", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Statute xml:lang="en" xmlns:lims="http://justice.gc.ca/lims">
  <Identification>
    <Chapter>
      <ConsolidatedNumber official="yes">T-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle lims:inforce-start-date="2020-01-01" lims:fid="123" status="official">Test Act</ShortTitle>
  </Identification>
  <Body>
    <Section>
      <Label>1</Label>
      <Text>Content</Text>
    </Section>
  </Body>
</Statute>`;
    const result = parseActXml(xml, "en");

    expect(result.act?.shortTitleStatus).toBe("official");
    expect(result.act?.consolidatedNumberOfficial).toBe("yes");
  });
});

test.describe("Combined bilingual and table scenarios", () => {
  test("handles bilingual content inside table cells", () => {
    const xml = createActXmlWithContent(`
      <TableGroup>
        <table>
          <tgroup cols="2">
            <tbody>
              <row>
                <entry>
                  <BilingualGroup>
                    <BilingualItemEn>English Department</BilingualItemEn>
                    <BilingualItemFr>Ministère français</BilingualItemFr>
                  </BilingualGroup>
                </entry>
                <entry>Section 5</entry>
              </row>
            </tbody>
          </tgroup>
        </table>
      </TableGroup>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain("<table>");
    expect(contentHtml).toContain('<div class="bilingual-group">');
    expect(contentHtml).toContain("English Department");
    expect(contentHtml).toContain("Ministère français");
  });
});
