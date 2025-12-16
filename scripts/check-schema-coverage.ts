/**
 * Schema Coverage Report Script
 *
 * Compares our content-tree.ts handlers against the official
 * XSLT (LIMS2HTML.xsl) and DTD (regulation_web.dtd) schemas.
 *
 * Usage: npx tsx scripts/check-schema-coverage.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data/legislation");
const LIB_DIR = join(process.cwd(), "lib/legislation/utils");

// Regex patterns at module level
const XSLT_TEMPLATE_REGEX = /<xsl:template\s+match="([^"]+)"/g;
const ELEMENT_NAME_REGEX = /^([A-Za-z][A-Za-z0-9_-]*)/;
const DTD_ELEMENT_REGEX = /<!ELEMENT\s+([A-Za-z][A-Za-z0-9_-]*)/g;

// Patterns to find tag handling in code
const TAG_EQUALS_REGEX = /tag === "([A-Za-z][A-Za-z0-9_-]*)"/g;
const CASE_REGEX = /case "([A-Za-z][A-Za-z0-9_-]*)"/g;
// Match property access on any variable: obj.ElementName, doc.Identification, etc.
const OBJ_PROPERTY_REGEX = /\b\w+\.([A-Z][A-Za-z]+)\b/g;
const OBJ_BRACKET_REGEX = /\w+\["([A-Z][A-Za-z]+)"\]/g;
const KEY_EQUALS_REGEX = /key === "([A-Z][A-Za-z]+)"/g;
// Pattern for hasElement(el, "ElementName") in content-flags.ts
const HAS_ELEMENT_REGEX = /hasElement\(\w+,\s*"([A-Za-z][A-Za-z0-9_-]*)"\)/g;
// Pattern for string literals in arrays like CONTINUATION_ELEMENTS = ["ContinuedDefinition", ...]
const STRING_ARRAY_REGEX = /"(Continued[A-Za-z]+)"/g;

/**
 * Documentation for elements handled via specialized extraction functions.
 * NOTE: This is DOCUMENTATION ONLY - elements are NOT auto-marked as handled.
 * Elements must actually appear in code to be counted as handled.
 */
const SPECIALIZED_HANDLERS: Record<string, string> = {
  // These elements are detected via code patterns but have special handling notes
  TitleText:
    "Extracted via extractTitleText(), extractTitleTextFromPreserved(), and heading.ts utilities",
  Footnote: "Extracted via extractFootnotes() as FootnoteInfo[] metadata",
  HistoricalNote:
    "Extracted via extractHistoricalNotes() as HistoricalNoteInfo[]",
  Ins: "Change tracking via hasElement() in content-flags.ts",
  Del: "Change tracking via hasElement() in content-flags.ts",
  // Document metadata - extracted via parser.ts and document-metadata.ts
  Identification: "Container element - children extracted as document metadata",
  LongTitle: "Extracted to longTitle field in acts/regulations table",
  ShortTitle: "Extracted to title and shortTitleStatus fields",
  Chapter: "Container for ConsolidatedNumber and AnnualStatuteId",
  ConsolidatedNumber:
    "Extracted to consolidatedNumber and consolidatedNumberOfficial fields",
  InstrumentNumber: "Extracted to instrumentNumber field for regulations",
  AnnualStatuteId:
    "Extracted to annualStatuteYear and annualStatuteChapter fields",
  EnablingAuthority:
    "Extracted via extractEnablingAuthorities() to enablingAuthorities JSON",
  BillHistory: "Extracted via extractBillHistory() to billHistory JSON",
  RegulationMakerOrder:
    "Extracted via extractRegulationMakerOrder() to regulationMaker JSON",
  RegistrationDate: "Extracted to registrationDate field for regulations",
  ConsolidationDate: "Extracted to consolidationDate field",
  LastAmendedDate:
    "NOT IN DATA as element - uses lims:lastAmendedDate attribute instead",
  LastModifiedDate:
    "NOT IN DATA as element - LIMS metadata via attributes only",
  // Date components - parsed via dates.ts
  Date: "Container for YYYY/MM/DD - parsed via parseDateElement()",
  YYYY: "Year component - extracted as part of date parsing",
  MM: "Month component - extracted as part of date parsing",
  DD: "Day component - extracted as part of date parsing",
  // Document structure containers
  Body: "Container element - children walked for sections",
  Introduction: "Container for Preamble and Enacts - extracted separately",
  Schedules: "Container element - children processed as schedules",
  Schedule: "Processed via extractSchedules() in schedules.ts",
  Part: "Structure container - tracked in hierarchyPath",
  Division: "Structure container - tracked in hierarchyPath",
  Subdivision: "Structure container - tracked in hierarchyPath",
  // Historical note components
  HistoricalNoteSubItem:
    "Extracted via extractHistoricalNotes() as part of HistoricalNote",
  OriginatingRef: "Extracted as scheduleOriginatingRef in schedule metadata",
  // Regulation publication - also handled as ContentNodes
  Recommendation:
    "Extracted via extractPublicationItems() AND handled as ContentNode",
  Notice: "Extracted via extractPublicationItems() AND handled as ContentNode",
  // Additional content
  Note: "Editorial note in Identification section - metadata only",
  ReaderNote: "Container for Note elements in Identification - metadata only",
  Preamble: "Extracted via extractPreamble() as PreambleProvision[]",
  Enacts: "Extracted via extractEnactingClause() as EnactingClauseInfo",
  RelatedProvisions:
    "Extracted via extractRelatedProvisions() as RelatedProvisionInfo[]",
  RecentAmendments:
    "Extracted via extractRecentAmendments() as AmendmentInfo[]",
  Amendment: "Child of RecentAmendments - extracted as AmendmentInfo",
  SignatureLine: "Extracted as part of SignatureBlock processing",
  TableOfProvisions:
    "Extracted via extractTableOfProvisions() as TableOfProvisionsEntry[]",
  TitleProvision: "Child of TableOfProvisions - extracted for TOC navigation",
  // Amendment details
  AmendmentCitation: "Child of Amendment - extracted as part of AmendmentInfo",
  AmendmentDate: "Child of Amendment - extracted as part of AmendmentInfo",
  // Elements not present in Acts/Regulations XML data (verified 0 occurrences)
  ul: "NOT IN DATA - HTML list element (0 occurrences in XML)",
  li: "NOT IN DATA - HTML list item (0 occurrences in XML)",
  ProvisionHeading: "NOT IN DATA (0 occurrences in XML)",
  ExplanatoryNote: "NOT IN DATA - Bills only (0 occurrences in XML)",
  GazetteHeader: "NOT IN DATA - gazette publication metadata",
  GazetteDate: "NOT IN DATA - gazette publication metadata",
  GazetteNotice: "NOT IN DATA - gazette publication metadata",
  NoticeTitle: "NOT IN DATA - gazette publication metadata",
  StatuteYear: "Part of AnnualStatuteId - extracted as annualStatuteYear",
  RunningHead: "Extracted to runningHead field in parser.ts",
  // Math and formatting elements - handled via hasElement() or ContentNode
  MathML: "Rendered via MathMLRenderer component",
  math: "MathML root element - passed through to browser",
  FormBlank: "Detected via hasElement() in content-flags.ts",
  LineBreak: "Detected via hasElement() in content-flags.ts",
  PageBreak: "Detected via hasElement() in content-flags.ts",
  Language: "Language wrapper - sets lang attribute",
  ScheduleFormHeading: "Schedule form heading - rendered with special styling",
  GroupHeading: "Group heading - rendered in schedules",
  // Continuation elements - detected via definitions.ts
  Continued: "Continuation marker - rendered as content wrapper",
  ContinuedSectionSubsection: "Continuation of section/subsection",
  ContinuedParagraph: "Continuation of paragraph",
  ContinuedSubparagraph: "Continuation of subparagraph",
  ContinuedClause: "Continuation of clause",
  ContinuedSubclause: "Continuation of subclause",
  ContinuedDefinition: "Detected via definitions.ts CONTINUATION_ELEMENTS",
  ContinuedFormulaParagraph: "Continuation of formula paragraph",
  // Sup/Sub handled in content-tree.ts (NOT Superscript/Subscript)
  Sup: "Rendered as <sup> element in content-tree.ts",
  Sub: "Rendered as <sub> element in content-tree.ts",
  // Other content elements - detected via hasElement() or ContentNode
  Repealed: "Detected via hasElement() in content-flags.ts",
  Leader: "Detected via hasElement() in content-flags.ts",
  Separator: "Detected via hasElement() in content-flags.ts",
  CenteredText: "Center-aligned text block",
  Oath: "Detected via hasElement() in content-flags.ts",
  FormGroup: "Detected via hasElement() in content-flags.ts",
  FormulaConnector: "Formula connector text (e.g., 'where')",
  LeaderRightJustified: "Detected via hasElement() in content-flags.ts",
  DefinitionRef: "Reference to defined term",
  Summary: "Summary content block",
  AlternateText: "Detected via hasElement() in content-flags.ts",
  Header: "Header content block",
  Footer: "Footer content block",
  FormHeading: "Form heading element",
  FigureGroup: "Figure/image group container",
  // Root elements
  Regulation: "Root element for regulation documents",
  Act: "Root element for act documents",
  BillInternal: "Internal bill reference container",
  // Lowercase variants (XSLT case-insensitive matching)
  text: "Lowercase text node - generic content",
  title: "Lowercase title element",
  a: "Anchor/link element",
  // XSLT hierarchy templates - these are XSLT constructs, not XML elements
  "Group1-Part": "XSLT template for Part-level grouping (not an XML element)",
  "Group2-Division":
    "XSLT template for Division-level grouping (not an XML element)",
  "Group3-Subdivision":
    "XSLT template for Subdivision-level grouping (not an XML element)",
  Group4: "XSLT template for 4th-level grouping (not an XML element)",
  // Signature components
  SignatureName: "Name in signature block",
  SignatureTitle: "Title in signature block",
  // Definition variants - detected via o.DefinitionEnOnly pattern
  DefinitionEnOnly: "English-only definition",
  DefinitionFrOnly: "French-only definition",
  // Reference elements - detected in references.ts
  XRefSection: "Section cross-reference",
  Citation: "Citation element",
  Source: "Source reference element",
  RelatedProvision: "Child of RelatedProvisions - extracted as array",
  // Regulation metadata components
  LimsAuthority: "LIMS authority metadata",
  Alpha: "Alpha identifier in regulation metadata",
  AuthorityTitle: "Authority title in regulation metadata",
  OrderDate: "Order date in regulation metadata",
  OtherAuthority: "Other authority reference",
  Organisation: "Organisation name in metadata",
  OrderNumber: "Order number - extracted in regulationMakerOrder",
  RegulationMaker: "Regulation maker - extracted in regulationMakerOrder",
  AmendedContent: "Amended content container",
};

/**
 * Extract all xsl:template match="..." patterns from XSLT
 */
function extractXsltTemplates(xsltPath: string): Set<string> {
  const content = readFileSync(xsltPath, "utf-8");
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
 * Extract all <!ELEMENT ...> definitions from DTD
 */
function extractDtdElements(dtdPath: string): Set<string> {
  const content = readFileSync(dtdPath, "utf-8");
  const elements = new Set<string>();

  const elementRegex = new RegExp(DTD_ELEMENT_REGEX.source, "g");
  let match = elementRegex.exec(content);

  while (match !== null) {
    elements.add(match[1]);
    match = elementRegex.exec(content);
  }

  return elements;
}

/**
 * Extract all handled tags from a TypeScript file using multiple patterns
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

  // Pattern 3: obj.ElementName (property access on parsed XML)
  const objPropRegex = new RegExp(OBJ_PROPERTY_REGEX.source, "g");
  match = objPropRegex.exec(content);
  while (match !== null) {
    // Filter out common non-element properties and JS/TS builtins
    const prop = match[1];
    const excluded = [
      // JS/TS builtins (NOT including Date - it's a valid XML element!)
      "Array",
      "Object",
      "String",
      "Number",
      "Boolean",
      "Set",
      "Map",
      "Promise",
      "Error",
      // "Date" is intentionally NOT excluded - it's a real XML element
      "RegExp",
      "JSON",
      "Math",
      "Record",
      "Partial",
      "Required",
      "Function",
      // Common method/property names that aren't XML elements
      "length",
      "push",
      "pop",
      "shift",
      "slice",
      "filter",
      "map",
      "reduce",
      "find",
      "keys",
      "values",
      "entries",
      "flat",
      "join",
      "trim",
      "split",
      "startsWith",
      "endsWith",
      "includes",
      "replace",
      "match",
      "test",
      "exec",
      "toString",
      "valueOf",
      "type",
      "Type",
      "Props",
    ];
    if (!excluded.includes(prop)) {
      handlers.add(prop);
    }
    match = objPropRegex.exec(content);
  }

  // Pattern 4: obj["ElementName"] (bracket access)
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

  // Pattern 6: hasElement(el, "ElementName") - used in content-flags.ts
  const hasElementRegex = new RegExp(HAS_ELEMENT_REGEX.source, "g");
  match = hasElementRegex.exec(content);
  while (match !== null) {
    handlers.add(match[1]);
    match = hasElementRegex.exec(content);
  }

  // Pattern 7: "ContinuedXxx" strings in arrays - used in definitions.ts
  const stringArrayRegex = new RegExp(STRING_ARRAY_REGEX.source, "g");
  match = stringArrayRegex.exec(content);
  while (match !== null) {
    handlers.add(match[1]);
    match = stringArrayRegex.exec(content);
  }

  return handlers;
}

/**
 * Categorize elements by type
 */
const ELEMENT_CATEGORIES: Record<string, string[]> = {
  "Schedule Containers": [
    "BillPiece",
    "RegulationPiece",
    "DocumentInternal",
    "Group",
    "SectionPiece",
    "RelatedOrNotInForce",
    "Order",
    "Recommendation",
    "Notice",
    "ConventionAgreementTreaty",
  ],
  "Structure Elements": [
    "Section",
    "Subsection",
    "Paragraph",
    "Subparagraph",
    "Clause",
    "Subclause",
    "Provision",
    "Definition",
    "Item",
    "List",
  ],
  "Content Elements": [
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
  ],
  "Table Elements": [
    "TableGroup",
    "Table",
    "table",
    "tgroup",
    "thead",
    "tbody",
    "row",
    "entry",
    "colspec",
  ],
  "Formula Elements": [
    "Formula",
    "FormulaGroup",
    "FormulaText",
    "FormulaTerm",
    "FormulaDefinition",
    "FormulaParagraph",
    "Numerator",
    "Denominator",
    "Fraction",
  ],
  "Image Elements": ["ImageGroup", "Image", "Caption"],
  "Bilingual Elements": [
    "BilingualGroup",
    "BilingualItemEn",
    "BilingualItemFr",
  ],
  "Special Content": [
    "SignatureBlock",
    "Reserved",
    "AmendedText",
    "ReadAsText",
    "QuotedText",
    "HistoricalNote",
  ],
  "Change Tracking": ["Ins", "Del", "Off", "Alt"],
  // Metadata categories - these are extracted at document level, not as ContentNodes
  "Document Metadata": [
    "Identification",
    "LongTitle",
    "ShortTitle",
    "Chapter",
    "ConsolidatedNumber",
    "InstrumentNumber",
    "AnnualStatuteId",
    "EnablingAuthority",
    "BillHistory",
    "RegulationMakerOrder",
    "RegistrationDate",
    "ConsolidationDate",
    "Note",
    "ReaderNote", // Container for Note elements - 364 files
    "RunningHead",
  ],
  "Date Components": ["Date", "YYYY", "MM", "DD", "StatuteYear"],
  "Document Structure": [
    "Body",
    "Introduction",
    "Schedules",
    "Schedule",
    "Part",
    "Division",
    "Subdivision",
    "Preamble",
    "Enacts",
    "RelatedProvisions",
    "RecentAmendments",
    "Amendment",
    "AmendmentCitation",
    "AmendmentDate",
  ],
  "Signature Elements": ["SignatureLine", "Signatory", "ConsentingMinister"],
  "Navigation Elements": ["TableOfProvisions", "TitleProvision"],
  "Historical Notes": ["HistoricalNoteSubItem", "OriginatingRef"],
  "Not in Data": [
    "ul",
    "li",
    "ProvisionHeading",
    "ExplanatoryNote", // Bills only, not in Acts/Regulations
    "GazetteHeader",
    "GazetteDate",
    "GazetteNotice",
    "NoticeTitle",
    "LastAmendedDate", // 0 occurrences in XML (data uses lims:lastAmendedDate attribute instead)
    "LastModifiedDate", // 0 occurrences in XML (metadata only via LIMS attributes)
  ],
  "Inline Formatting": [
    "LineBreak",
    "PageBreak",
    "FormBlank",
    "Leader",
    "Separator",
    "LeaderRightJustified",
    "Language",
  ],
  "Math Elements": ["MathML", "math", "Sup", "Sub"],
  // Elements in schema but NOT handled in code - need handlers added
  "Needs Handler (In Data)": [
    "Superscript", // In XML data, not in code
    "superscript", // In XML data, not in code
    "Subscript", // In XML data, not in code
    "subscript", // In XML data, not in code
    "Base", // In schema, not in code
    "base", // In schema, not in code
    "Subsubclause", // In DTD, not in code
    "MSup", // MathML element in data, not in code
    "MSub", // MathML element in data, not in code
  ],
  "Continuation Elements": [
    "Continued",
    "ContinuedSectionSubsection",
    "ContinuedParagraph",
    "ContinuedSubparagraph",
    "ContinuedClause",
    "ContinuedSubclause",
    "ContinuedDefinition",
    "ContinuedFormulaParagraph",
  ],
  "Other Content": [
    "CenteredText",
    "Oath",
    "FormGroup",
    "FormulaConnector",
    "ScheduleFormHeading",
    "GroupHeading",
    "Repealed",
    "DefinitionRef",
    "Summary",
    "AlternateText",
    "Header",
    "Footer",
    "FormHeading",
    "FigureGroup",
  ],
  "Root Elements": ["Regulation", "Act", "BillInternal"],
  "Lowercase Variants": ["text", "title", "a"],
  "XSLT Hierarchy Templates": [
    "Group1-Part",
    "Group2-Division",
    "Group3-Subdivision",
    "Group4",
  ],
  "Signature Components": ["SignatureName", "SignatureTitle"],
  "Definition Variants": ["DefinitionEnOnly", "DefinitionFrOnly"],
  "Reference Elements": [
    "XRefSection",
    "Citation",
    "Source",
    "RelatedProvision",
  ],
  "Regulation Metadata Components": [
    "LimsAuthority",
    "Alpha",
    "AuthorityTitle",
    "OrderDate",
    "OtherAuthority",
    "Organisation",
    "OrderNumber",
    "RegulationMaker",
    "AmendedContent",
  ],
  // Elements in schema but likely not in data and not handled
  "Needs Investigation": [
    "MathMLBlock", // In XSLT, unclear if in data
    "CommentInline", // In schema, unclear if in data
    "CommentBlock", // In schema, unclear if in data
    "InlineFont", // In schema, unclear if in data
  ],
};

function main() {
  console.log("=== XSLT/DTD Schema Coverage Report ===\n");

  // Load schemas
  const xsltPath = join(DATA_DIR, "xslt/LIMS2HTML.xsl");
  const dtdPath = join(DATA_DIR, "regulation_web.dtd");

  console.log("Loading schemas...");
  const xsltTemplates = extractXsltTemplates(xsltPath);
  const dtdElements = extractDtdElements(dtdPath);

  console.log(`  XSLT templates: ${xsltTemplates.size}`);
  console.log(`  DTD elements: ${dtdElements.size}`);

  // Scan all utility files for handlers
  const utilFiles = [
    "content-tree.ts",
    "sections.ts",
    "schedules.ts",
    "document-metadata.ts",
    "treaties.ts",
    "heading.ts",
    "text.ts",
    // Added: files that were missing from original scan
    "content-flags.ts", // hasElement() checks for many elements
    "references.ts", // XRefExternal, XRefInternal handling
    "definitions.ts", // DefinedTermEn, DefinedTermFr, ContinuedDefinition
    "dates.ts", // Date parsing utilities
    "metadata.ts", // LIMS metadata extraction
  ];

  const allHandlers = new Set<string>();
  for (const file of utilFiles) {
    const filePath = join(LIB_DIR, file);
    try {
      const handlers = extractHandledTags(filePath);
      for (const h of handlers) {
        allHandlers.add(h);
      }
    } catch {
      // File may not exist
    }
  }

  // Also scan parser.ts which is in parent directory (handles document-level elements)
  const parserPath = join(process.cwd(), "lib/legislation/parser.ts");
  try {
    const parserHandlers = extractHandledTags(parserPath);
    for (const h of parserHandlers) {
      allHandlers.add(h);
    }
  } catch {
    // File may not exist
  }

  // NOTE: SPECIALIZED_HANDLERS is documentation only - elements are NOT auto-added
  // Elements must be detected via actual code patterns to be counted as handled

  console.log(`  Handlers found across utils: ${allHandlers.size}`);
  console.log();

  // Combined schema elements
  const allSchemaElements = new Set([...xsltTemplates, ...dtdElements]);

  // Report by category
  let totalInSchema = 0;
  let totalHandled = 0;
  const gaps: string[] = [];

  for (const [category, elements] of Object.entries(ELEMENT_CATEGORIES)) {
    console.log(`--- ${category} ---`);

    for (const element of elements) {
      const inXslt = xsltTemplates.has(element);
      const inDtd = dtdElements.has(element);
      const inSchema = inXslt || inDtd;
      const handled = allHandlers.has(element);
      const specializedNote = SPECIALIZED_HANDLERS[element];

      if (inSchema) {
        totalInSchema++;
        if (handled) {
          totalHandled++;
          if (specializedNote) {
            console.log(`  ✓ ${element} (specialized: ${specializedNote})`);
          } else {
            console.log(`  ✓ ${element}`);
          }
        } else {
          gaps.push(element);
          const sources: string[] = [];
          if (inXslt) {
            sources.push("XSLT");
          }
          if (inDtd) {
            sources.push("DTD");
          }
          console.log(`  ✗ ${element} (MISSING - in ${sources.join(", ")})`);
        }
      } else if (handled) {
        // Not in schema, but we handle it anyway
        console.log(`  ○ ${element} (handled, not in schemas)`);
      }
    }
    console.log();
  }

  // Check for any uncategorized elements (should be none)
  const categorizedElements = new Set(Object.values(ELEMENT_CATEGORIES).flat());
  const uncategorized = [...allSchemaElements].filter(
    (e) => !categorizedElements.has(e)
  );

  if (uncategorized.length > 0) {
    console.log("--- ⚠️ Uncategorized Schema Elements (need to be added) ---");
    for (const element of uncategorized) {
      const handled = allHandlers.has(element);
      console.log(`  ${handled ? "✓" : "○"} ${element}`);
    }
    console.log();
  }

  // Summary
  console.log("=== Summary ===");
  console.log(`Categorized elements in schema: ${totalInSchema}`);
  console.log(`Categorized elements handled: ${totalHandled}`);
  console.log(
    `Coverage: ${((totalHandled / totalInSchema) * 100).toFixed(1)}%`
  );
  console.log();

  if (gaps.length > 0) {
    console.log("=== Gaps to Fix ===");
    for (const gap of gaps) {
      console.log(`  - ${gap}`);
    }
  } else {
    console.log("No gaps found in categorized elements!");
  }

  // Exit code based on critical gaps
  const criticalGaps = gaps.filter((g) =>
    ELEMENT_CATEGORIES["Schedule Containers"].includes(g)
  );
  if (criticalGaps.length > 0) {
    console.log(`\n⚠️  ${criticalGaps.length} critical gap(s) found`);
    process.exit(1);
  }
}

main();
