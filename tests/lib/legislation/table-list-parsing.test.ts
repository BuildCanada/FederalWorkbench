/**
 * Tests for table and list HTML extraction from legislation XML.
 *
 * Task 1: CALS tables (TableGroup/table/tgroup/row/entry) are converted to HTML tables.
 * Task 2: Lists (List/Item) are converted to ul/ol/li elements with style support.
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
      <ConsolidatedNumber>T-1</ConsolidatedNumber>
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

test.describe("CALS Table parsing", () => {
  test("converts basic table structure to HTML", () => {
    const xml = createActXmlWithContent(`
      <TableGroup>
        <table>
          <tgroup cols="2">
            <thead>
              <row>
                <entry>Header 1</entry>
                <entry>Header 2</entry>
              </row>
            </thead>
            <tbody>
              <row>
                <entry>Cell 1</entry>
                <entry>Cell 2</entry>
              </row>
            </tbody>
          </tgroup>
        </table>
      </TableGroup>
    `);
    const result = parseActXml(xml, "en");

    expect(result.sections).toHaveLength(1);
    const contentHtml = result.sections[0].contentHtml;

    // Check for table elements
    expect(contentHtml).toContain("<table>");
    expect(contentHtml).toContain("</table>");
    expect(contentHtml).toContain("<thead>");
    expect(contentHtml).toContain("<tbody>");
    expect(contentHtml).toContain("<tr>");
    expect(contentHtml).toContain("<th>");
    expect(contentHtml).toContain("<td>");
    expect(contentHtml).toContain("Header 1");
    expect(contentHtml).toContain("Cell 1");
  });

  test("preserves table frame attribute as data attribute", () => {
    const xml = createActXmlWithContent(`
      <TableGroup>
        <table frame="topbot">
          <tgroup cols="1">
            <tbody>
              <row>
                <entry>Content</entry>
              </row>
            </tbody>
          </tgroup>
        </table>
      </TableGroup>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('data-frame="topbot"');
  });

  test("preserves colsep and rowsep attributes", () => {
    const xml = createActXmlWithContent(`
      <TableGroup>
        <table colsep="1" rowsep="0">
          <tgroup cols="1">
            <tbody>
              <row>
                <entry>Content</entry>
              </row>
            </tbody>
          </tgroup>
        </table>
      </TableGroup>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('data-colsep="1"');
    expect(contentHtml).toContain('data-rowsep="0"');
  });

  test("handles cell alignment attributes", () => {
    const xml = createActXmlWithContent(`
      <TableGroup>
        <table>
          <tgroup cols="1">
            <tbody>
              <row>
                <entry align="center">Centered</entry>
              </row>
            </tbody>
          </tgroup>
        </table>
      </TableGroup>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('style="text-align: center"');
  });

  test("handles rowspan via morerows attribute", () => {
    const xml = createActXmlWithContent(`
      <TableGroup>
        <table>
          <tgroup cols="2">
            <tbody>
              <row>
                <entry morerows="1">Spans 2 rows</entry>
                <entry>Row 1 Col 2</entry>
              </row>
              <row>
                <entry>Row 2 Col 2</entry>
              </row>
            </tbody>
          </tgroup>
        </table>
      </TableGroup>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('rowspan="2"');
  });

  test("handles bilingual attribute on TableGroup", () => {
    const xml = createActXmlWithContent(`
      <TableGroup bilingual="yes">
        <table>
          <tgroup cols="1">
            <tbody>
              <row>
                <entry>Content</entry>
              </row>
            </tbody>
          </tgroup>
        </table>
      </TableGroup>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('data-bilingual="yes"');
  });

  test("handles vertical alignment on thead", () => {
    const xml = createActXmlWithContent(`
      <TableGroup>
        <table>
          <tgroup cols="1">
            <thead valign="bottom">
              <row>
                <entry>Header</entry>
              </row>
            </thead>
            <tbody>
              <row>
                <entry>Content</entry>
              </row>
            </tbody>
          </tgroup>
        </table>
      </TableGroup>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('style="vertical-align: bottom"');
  });
});

test.describe("List parsing", () => {
  test("converts basic List with Items to ul/li", () => {
    const xml = createActXmlWithContent(`
      <List>
        <Item><Text>Item 1</Text></Item>
        <Item><Text>Item 2</Text></Item>
        <Item><Text>Item 3</Text></Item>
      </List>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain("<ul>");
    expect(contentHtml).toContain("</ul>");
    expect(contentHtml).toContain("<li>");
    expect(contentHtml).toContain("Item 1");
    expect(contentHtml).toContain("Item 2");
    expect(contentHtml).toContain("Item 3");
  });

  test("converts arabic style List to ordered list", () => {
    const xml = createActXmlWithContent(`
      <List style="arabic">
        <Item><Text>First</Text></Item>
        <Item><Text>Second</Text></Item>
      </List>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('<ol type="1">');
    expect(contentHtml).toContain("</ol>");
    expect(contentHtml).toContain("<li>");
  });

  test("converts decimal style List to ordered list", () => {
    const xml = createActXmlWithContent(`
      <List style="decimal">
        <Item><Text>One</Text></Item>
      </List>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('<ol type="1">');
  });

  test("converts lower-roman style List to ordered list with roman numerals", () => {
    const xml = createActXmlWithContent(`
      <List style="lower-roman">
        <Item><Text>First</Text></Item>
      </List>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('<ol type="i">');
  });

  test("converts upper-roman style List to ordered list", () => {
    const xml = createActXmlWithContent(`
      <List style="upper-roman">
        <Item><Text>First</Text></Item>
      </List>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('<ol type="I">');
  });

  test("converts lower-alpha style List to ordered list with letters", () => {
    const xml = createActXmlWithContent(`
      <List style="lower-alpha">
        <Item><Text>Alpha</Text></Item>
      </List>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('<ol type="a">');
  });

  test("converts upper-alpha style List to ordered list with uppercase letters", () => {
    const xml = createActXmlWithContent(`
      <List style="upper-alpha">
        <Item><Text>Alpha</Text></Item>
      </List>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('<ol type="A">');
  });

  test("handles nested content in list items", () => {
    const xml = createActXmlWithContent(`
      <List>
        <Item>
          <Text>See <XRefExternal reference-type="act" link="C-46">Criminal Code</XRefExternal>.</Text>
        </Item>
      </List>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain("<ul>");
    expect(contentHtml).toContain("<li>");
    expect(contentHtml).toContain("Criminal Code");
    expect(contentHtml).toContain('<a class="xref">');
  });

  test("handles Language elements in list items", () => {
    const xml = createActXmlWithContent(`
      <List>
        <Item>
          <Text><Language xml:lang="fr">Loi française</Language></Text>
        </Item>
      </List>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain("<li>");
    expect(contentHtml).toContain('lang="fr"');
    expect(contentHtml).toContain("Loi française");
  });
});

test.describe("Combined table and list scenarios", () => {
  test("handles table within list item", () => {
    const xml = createActXmlWithContent(`
      <List>
        <Item>
          <Text>Introduction</Text>
          <TableGroup>
            <table>
              <tgroup cols="1">
                <tbody>
                  <row>
                    <entry>Table content</entry>
                  </row>
                </tbody>
              </tgroup>
            </table>
          </TableGroup>
        </Item>
      </List>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain("<ul>");
    expect(contentHtml).toContain("<li>");
    expect(contentHtml).toContain("<table>");
    expect(contentHtml).toContain("Table content");
  });

  test("handles list within table cell", () => {
    const xml = createActXmlWithContent(`
      <TableGroup>
        <table>
          <tgroup cols="1">
            <tbody>
              <row>
                <entry>
                  <List>
                    <Item><Text>List in cell</Text></Item>
                  </List>
                </entry>
              </row>
            </tbody>
          </tgroup>
        </table>
      </TableGroup>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain("<table>");
    expect(contentHtml).toContain("<td>");
    expect(contentHtml).toContain("<ul>");
    expect(contentHtml).toContain("<li>");
    expect(contentHtml).toContain("List in cell");
  });
});
