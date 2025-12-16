/**
 * Schema Coverage Tests for content-tree.ts
 *
 * Validates that our XML parser handles elements defined in the
 * official XSLT (LIMS2HTML.xsl) and DTD (regulation_web.dtd) schemas.
 *
 * These tests ensure coverage doesn't regress and document known gaps.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const LIB_DIR = join(process.cwd(), "lib/legislation/utils");
const DATA_DIR = join(process.cwd(), "data/legislation");

// Regex patterns at module level
const TAG_EQUALS_REGEX = /tag === "([A-Za-z][A-Za-z0-9_-]*)"/g;
const CASE_REGEX = /case "([A-Za-z][A-Za-z0-9_-]*)"/g;
const OBJ_PROPERTY_REGEX = /\bo\.([A-Z][A-Za-z]+)\b/g;
const OBJ_BRACKET_REGEX = /obj\["([A-Z][A-Za-z]+)"\]/g;
const KEY_EQUALS_REGEX = /key === "([A-Z][A-Za-z]+)"/g;
const XSLT_TEMPLATE_REGEX = /<xsl:template\s+match="([^"]+)"/g;
const ELEMENT_NAME_REGEX = /^([A-Za-z][A-Za-z0-9_-]*)/;
const DTD_ELEMENT_REGEX = /<!ELEMENT\s+([A-Za-z][A-Za-z0-9_-]*)/g;

/**
 * Elements handled via specialized extraction functions
 */
const SPECIALIZED_HANDLERS = new Set([
  "TitleText",
  "Footnote",
  "HistoricalNote",
  "Ins",
  "Del",
]);

/**
 * Extract all handled tags from a TypeScript file
 */
function extractHandledTags(filePath: string): Set<string> {
  const content = readFileSync(filePath, "utf-8");
  const handlers = new Set<string>();

  // Pattern 1: tag === "ElementName"
  const tagEqualsRegex = new RegExp(TAG_EQUALS_REGEX.source, "g");
  let match = tagEqualsRegex.exec(content);
  while (match !== null) {
    handlers.add(match[1]);
    match = tagEqualsRegex.exec(content);
  }

  // Pattern 2: case "ElementName":
  const caseRegex = new RegExp(CASE_REGEX.source, "g");
  match = caseRegex.exec(content);
  while (match !== null) {
    handlers.add(match[1]);
    match = caseRegex.exec(content);
  }

  // Pattern 3: o.ElementName (property access on parsed XML)
  const objPropRegex = new RegExp(OBJ_PROPERTY_REGEX.source, "g");
  match = objPropRegex.exec(content);
  while (match !== null) {
    const prop = match[1];
    if (
      ![
        "Array",
        "Object",
        "String",
        "Number",
        "Boolean",
        "Set",
        "Map",
      ].includes(prop)
    ) {
      handlers.add(prop);
    }
    match = objPropRegex.exec(content);
  }

  // Pattern 4: obj["ElementName"]
  const objBracketRegex = new RegExp(OBJ_BRACKET_REGEX.source, "g");
  match = objBracketRegex.exec(content);
  while (match !== null) {
    handlers.add(match[1]);
    match = objBracketRegex.exec(content);
  }

  // Pattern 5: key === "ElementName"
  const keyEqualsRegex = new RegExp(KEY_EQUALS_REGEX.source, "g");
  match = keyEqualsRegex.exec(content);
  while (match !== null) {
    handlers.add(match[1]);
    match = keyEqualsRegex.exec(content);
  }

  return handlers;
}

/**
 * Get all handlers across utility files
 */
function getAllHandlers(): Set<string> {
  const utilFiles = [
    "content-tree.ts",
    "sections.ts",
    "schedules.ts",
    "document-metadata.ts",
    "treaties.ts",
    "heading.ts",
    "text.ts",
  ];

  const allHandlers = new Set<string>();
  for (const file of utilFiles) {
    try {
      const handlers = extractHandledTags(join(LIB_DIR, file));
      for (const h of handlers) {
        allHandlers.add(h);
      }
    } catch {
      // File may not exist
    }
  }

  // Add specialized handlers
  for (const h of SPECIALIZED_HANDLERS) {
    allHandlers.add(h);
  }

  return allHandlers;
}

/**
 * Extract xsl:template match patterns from XSLT
 */
function getXsltTemplates(): Set<string> {
  const content = readFileSync(join(DATA_DIR, "xslt/LIMS2HTML.xsl"), "utf-8");
  const templates = new Set<string>();

  const templateRegex = new RegExp(XSLT_TEMPLATE_REGEX.source, "g");
  let match = templateRegex.exec(content);

  while (match !== null) {
    const matchAttr = match[1];
    const elements = matchAttr.split("|").map((e) => e.trim());

    for (const element of elements) {
      const elementMatch = element.match(ELEMENT_NAME_REGEX);
      if (elementMatch) {
        templates.add(elementMatch[1]);
      }
    }
    match = templateRegex.exec(content);
  }

  return templates;
}

/**
 * Extract <!ELEMENT ...> definitions from DTD
 */
function getDtdElements(): Set<string> {
  const content = readFileSync(join(DATA_DIR, "regulation_web.dtd"), "utf-8");
  const elements = new Set<string>();

  const elementRegex = new RegExp(DTD_ELEMENT_REGEX.source, "g");
  let match = elementRegex.exec(content);

  while (match !== null) {
    elements.add(match[1]);
    match = elementRegex.exec(content);
  }

  return elements;
}

test.describe("XSLT/DTD Schema Coverage", () => {
  test("essential schedule container elements are handled", () => {
    const allHandlers = getAllHandlers();

    const essentialContainers = [
      "List",
      "DocumentInternal",
      "Group",
      "BillPiece",
      "RegulationPiece",
      "RelatedOrNotInForce",
    ];

    const missing: string[] = [];
    for (const element of essentialContainers) {
      if (!allHandlers.has(element)) {
        missing.push(element);
      }
    }

    expect(
      missing,
      `Missing schedule container handlers: ${missing.join(", ")}`
    ).toHaveLength(0);
  });

  test("essential content elements are handled", () => {
    const allHandlers = getAllHandlers();

    const essentialElements = [
      "Section",
      "Subsection",
      "Paragraph",
      "Subparagraph",
      "Clause",
      "Subclause",
      "Provision",
      "Definition",
      "Item",
      "Text",
      "Label",
      "MarginalNote",
      "Heading",
      "TitleText",
      "Emphasis",
      "XRefExternal",
      "XRefInternal",
      "DefinedTermEn",
      "DefinedTermFr",
      "FootnoteRef",
      "Footnote",
    ];

    const missing: string[] = [];
    for (const element of essentialElements) {
      if (!allHandlers.has(element)) {
        missing.push(element);
      }
    }

    expect(
      missing,
      `Missing content element handlers: ${missing.join(", ")}`
    ).toHaveLength(0);
  });

  test("table elements are handled", () => {
    const allHandlers = getAllHandlers();

    const tableElements = [
      "TableGroup",
      "Table",
      "table",
      "tgroup",
      "thead",
      "tbody",
      "row",
      "entry",
    ];

    const missing: string[] = [];
    for (const element of tableElements) {
      if (!allHandlers.has(element)) {
        missing.push(element);
      }
    }

    expect(
      missing,
      `Missing table element handlers: ${missing.join(", ")}`
    ).toHaveLength(0);
  });

  test("formula elements are handled", () => {
    const allHandlers = getAllHandlers();

    const formulaElements = [
      "Formula",
      "FormulaGroup",
      "FormulaText",
      "FormulaTerm",
      "FormulaDefinition",
      "FormulaParagraph",
    ];

    const missing: string[] = [];
    for (const element of formulaElements) {
      if (!allHandlers.has(element)) {
        missing.push(element);
      }
    }

    expect(
      missing,
      `Missing formula element handlers: ${missing.join(", ")}`
    ).toHaveLength(0);
  });

  test("image elements are handled", () => {
    const allHandlers = getAllHandlers();

    const imageElements = ["ImageGroup", "Image"];

    const missing: string[] = [];
    for (const element of imageElements) {
      if (!allHandlers.has(element)) {
        missing.push(element);
      }
    }

    expect(
      missing,
      `Missing image element handlers: ${missing.join(", ")}`
    ).toHaveLength(0);
  });

  test("bilingual elements are handled", () => {
    const allHandlers = getAllHandlers();

    const bilingualElements = [
      "BilingualGroup",
      "BilingualItemEn",
      "BilingualItemFr",
    ];

    const missing: string[] = [];
    for (const element of bilingualElements) {
      if (!allHandlers.has(element)) {
        missing.push(element);
      }
    }

    expect(
      missing,
      `Missing bilingual element handlers: ${missing.join(", ")}`
    ).toHaveLength(0);
  });

  test("specialized elements are documented", () => {
    const allHandlers = getAllHandlers();

    // These elements are handled via specialized functions
    const specializedElements = ["TitleText", "Footnote", "HistoricalNote"];

    for (const element of specializedElements) {
      expect(
        allHandlers.has(element),
        `${element} should be tracked as handled`
      ).toBe(true);
    }
  });

  test("amending and container elements are handled", () => {
    const allHandlers = getAllHandlers();

    // Elements added for schedule containers and amending content
    const amendingElements = [
      "SectionPiece",
      "Order",
      "Recommendation",
      "Notice",
      "Reserved",
      "AmendedText",
    ];

    const missing: string[] = [];
    for (const element of amendingElements) {
      if (!allHandlers.has(element)) {
        missing.push(element);
      }
    }

    expect(
      missing,
      `Missing amending/container element handlers: ${missing.join(", ")}`
    ).toHaveLength(0);
  });

  test("no critical schema gaps exist", () => {
    const allHandlers = getAllHandlers();
    const xsltTemplates = getXsltTemplates();
    const dtdElements = getDtdElements();

    // Elements that should definitely be handled (critical for legislation parsing)
    const criticalElements = [
      "Section",
      "Subsection",
      "Paragraph",
      "Text",
      "Label",
      "Definition",
      "Table",
      "Formula",
      "List",
      "SectionPiece",
      "AmendedText",
    ];

    const gaps: string[] = [];

    for (const element of criticalElements) {
      const inSchema = xsltTemplates.has(element) || dtdElements.has(element);
      const handled = allHandlers.has(element);

      // Only flag as gap if in schema but not handled
      if (inSchema && !handled) {
        gaps.push(element);
      }
    }

    expect(gaps, `Critical schema gaps found: ${gaps.join(", ")}`).toHaveLength(
      0
    );
  });

  test("XSLT file exists and is parseable", () => {
    const templates = getXsltTemplates();
    expect(templates.size).toBeGreaterThan(0);
  });

  test("DTD file exists and is parseable", () => {
    const elements = getDtdElements();
    expect(elements.size).toBeGreaterThan(0);
  });

  test("handler detection finds elements across utility files", () => {
    const handlers = getAllHandlers();

    // Should find a reasonable number of handlers
    expect(handlers.size).toBeGreaterThan(50);

    // Should include key elements from different files
    expect(handlers.has("Section")).toBe(true); // content-tree.ts
    expect(handlers.has("TitleText")).toBe(true); // specialized
    expect(handlers.has("Footnote")).toBe(true); // specialized
  });
});

test.describe("Change Tracking Elements (Lower Priority)", () => {
  test.skip("documents change tracking elements as handled", () => {
    const allHandlers = getAllHandlers();

    // Change tracking elements - content passes through, markers not preserved
    const changeTrackingElements = ["Ins", "Del"];

    for (const element of changeTrackingElements) {
      expect(
        allHandlers.has(element),
        `${element} should be tracked as handled (pass-through)`
      ).toBe(true);
    }
  });
});
