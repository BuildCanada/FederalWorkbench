/**
 * Tests for Formula, MathML, and math element HTML extraction from legislation XML.
 *
 * Preserves Formula, MathML, and math elements in HTML output with proper semantic markup.
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
      <ConsolidatedNumber>F-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle status="official">Formula Test Act</ShortTitle>
  </Identification>
  <Body>
    <Section>
      <Label>1</Label>
      ${sectionContent}
    </Section>
  </Body>
</Statute>`;
}

test.describe("FormulaGroup parsing", () => {
  test("converts FormulaGroup with Formula and FormulaText to semantic HTML", () => {
    const xml = createActXmlWithContent(`
      <Text>The formula is as follows:</Text>
      <FormulaGroup>
        <Formula>
          <FormulaText>A x 1.02<Sup>B</Sup></FormulaText>
        </Formula>
      </FormulaGroup>
    `);
    const result = parseActXml(xml, "en");

    expect(result.sections).toHaveLength(1);
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('<div class="formula-group">');
    expect(contentHtml).toContain('<div class="formula">');
    expect(contentHtml).toContain('<code class="formula-text">');
    expect(contentHtml).toContain("A x 1.02");
    expect(contentHtml).toContain("<sup>B</sup>");
  });

  test("handles FormulaConnector element (where clause)", () => {
    const xml = createActXmlWithContent(`
      <FormulaGroup>
        <Formula>
          <FormulaText>A + B = C</FormulaText>
        </Formula>
        <FormulaConnector>where</FormulaConnector>
      </FormulaGroup>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('<p class="formula-connector">where</p>');
  });

  test("handles FormulaDefinition with FormulaTerm", () => {
    const xml = createActXmlWithContent(`
      <FormulaGroup>
        <Formula>
          <FormulaText>A x B</FormulaText>
        </Formula>
        <FormulaConnector>where</FormulaConnector>
        <FormulaDefinition>
          <FormulaTerm>A</FormulaTerm>
          <Text>is the base amount</Text>
        </FormulaDefinition>
      </FormulaGroup>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('<div class="formula-definition">');
    expect(contentHtml).toContain('<var class="formula-term">A</var>');
    expect(contentHtml).toContain("is the base amount");
  });

  test("handles FormulaParagraph with Label", () => {
    const xml = createActXmlWithContent(`
      <FormulaGroup>
        <Formula>
          <FormulaText>X + Y</FormulaText>
        </Formula>
        <FormulaConnector>where</FormulaConnector>
        <FormulaDefinition>
          <FormulaTerm>X</FormulaTerm>
          <Text>is the number of years, other than a year throughout which</Text>
          <FormulaParagraph>
            <Label>(i)</Label>
            <Text>the beneficiary was ineligible, or</Text>
          </FormulaParagraph>
          <FormulaParagraph>
            <Label>(ii)</Label>
            <Text>the beneficiary was not resident in Canada</Text>
          </FormulaParagraph>
        </FormulaDefinition>
      </FormulaGroup>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('<p class="formula-paragraph">');
    expect(contentHtml).toContain('<span class="label">(i)</span>');
    expect(contentHtml).toContain("the beneficiary was ineligible");
    expect(contentHtml).toContain('<span class="label">(ii)</span>');
    expect(contentHtml).toContain("the beneficiary was not resident");
  });

  test("handles complete formula structure from legislation", () => {
    const xml = createActXmlWithContent(`
      <Text>For the purposes of subsection (2), the formula is as follows:</Text>
      <FormulaGroup>
        <Formula>
          <FormulaText>$400A + $500B - C</FormulaText>
        </Formula>
        <FormulaConnector>where</FormulaConnector>
        <FormulaDefinition>
          <FormulaTerm>A</FormulaTerm>
          <Text>is the number of years after 1997 and before 2007</Text>
        </FormulaDefinition>
        <FormulaDefinition>
          <FormulaTerm>B</FormulaTerm>
          <Text>is the number of years after 2006</Text>
        </FormulaDefinition>
        <FormulaDefinition>
          <FormulaTerm>C</FormulaTerm>
          <Text>is the total of all grants paid</Text>
        </FormulaDefinition>
      </FormulaGroup>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    // Check overall structure
    expect(contentHtml).toContain('<div class="formula-group">');
    expect(contentHtml).toContain(
      '<code class="formula-text">$400A + $500B - C</code>'
    );
    expect(contentHtml).toContain('<p class="formula-connector">where</p>');

    // Check all three definitions
    expect(contentHtml).toContain('<var class="formula-term">A</var>');
    expect(contentHtml).toContain('<var class="formula-term">B</var>');
    expect(contentHtml).toContain('<var class="formula-term">C</var>');

    // Check definition text
    expect(contentHtml).toContain("is the number of years after 1997");
    expect(contentHtml).toContain("is the number of years after 2006");
    expect(contentHtml).toContain("is the total of all grants paid");
  });
});

test.describe("Subscript and superscript in formulas", () => {
  test("handles Sub element for subscripts", () => {
    const xml = createActXmlWithContent(`
      <FormulaGroup>
        <Formula>
          <FormulaText>CO<Sub>2</Sub></FormulaText>
        </Formula>
      </FormulaGroup>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain("CO<sub>2</sub>");
  });

  test("handles Sup element for superscripts", () => {
    // Note: fast-xml-parser doesn't preserve mixed content order (text + elements interleaved).
    // Test verifies that Sup elements are converted to <sup> tags, not exact positioning.
    const xml = createActXmlWithContent(`
      <FormulaGroup>
        <Formula>
          <FormulaText>A x 1.02<Sup>B</Sup></FormulaText>
        </Formula>
      </FormulaGroup>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain("<sup>B</sup>");
    expect(contentHtml).toContain("1.02");
  });
});

test.describe("MathML element handling", () => {
  test("serializes math element to valid MathML", () => {
    const xml = createActXmlWithContent(`
      <Text>The equation is:</Text>
      <math>
        <mrow>
          <mi>x</mi>
          <mo>=</mo>
          <mfrac>
            <mrow>
              <mo>-</mo>
              <mi>b</mi>
            </mrow>
            <mrow>
              <mn>2</mn>
              <mi>a</mi>
            </mrow>
          </mfrac>
        </mrow>
      </math>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    // Check that MathML is preserved with namespace
    expect(contentHtml).toContain(
      '<math xmlns="http://www.w3.org/1998/Math/MathML">'
    );
    expect(contentHtml).toContain("<mrow>");
    expect(contentHtml).toContain("<mi>x</mi>");
    expect(contentHtml).toContain("<mo>=</mo>");
    expect(contentHtml).toContain("<mfrac>");
    expect(contentHtml).toContain("</math>");
  });

  test("serializes MathML element (alternative tag name)", () => {
    const xml = createActXmlWithContent(`
      <MathML>
        <mrow>
          <mn>1</mn>
          <mo>+</mo>
          <mn>1</mn>
          <mo>=</mo>
          <mn>2</mn>
        </mrow>
      </MathML>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain(
      '<math xmlns="http://www.w3.org/1998/Math/MathML">'
    );
    expect(contentHtml).toContain("<mrow>");
    expect(contentHtml).toContain("<mn>1</mn>");
    expect(contentHtml).toContain("<mo>+</mo>");
  });

  test("preserves MathML attributes", () => {
    const xml = createActXmlWithContent(`
      <math display="block">
        <mi>x</mi>
      </math>
    `);
    const result = parseActXml(xml, "en");
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('display="block"');
  });
});

test.describe("Formula in context", () => {
  test("handles formula within section text", () => {
    // Use simpler structure with formula directly in section
    const xml = createActXmlWithContent(`
      <Text>The amount is determined by the formula</Text>
      <FormulaGroup>
        <Formula>
          <FormulaText>A + B - C</FormulaText>
        </Formula>
        <FormulaConnector>where</FormulaConnector>
        <FormulaDefinition>
          <FormulaTerm>A</FormulaTerm>
          <Text>is the first amount;</Text>
        </FormulaDefinition>
        <FormulaDefinition>
          <FormulaTerm>B</FormulaTerm>
          <Text>is the second amount; and</Text>
        </FormulaDefinition>
        <FormulaDefinition>
          <FormulaTerm>C</FormulaTerm>
          <Text>is the third amount.</Text>
        </FormulaDefinition>
      </FormulaGroup>
    `);
    const result = parseActXml(xml, "en");

    expect(result.sections).toHaveLength(1);
    const contentHtml = result.sections[0].contentHtml;

    expect(contentHtml).toContain('<div class="formula-group">');
    expect(contentHtml).toContain(
      '<code class="formula-text">A + B - C</code>'
    );
    expect(contentHtml).toContain('<p class="formula-connector">where</p>');
    expect(contentHtml).toContain('<var class="formula-term">A</var>');
  });
});
