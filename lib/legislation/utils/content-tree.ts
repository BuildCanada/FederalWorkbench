/**
 * Content tree extraction for legislation XML.
 *
 * This module parses XML files with `preserveOrder=true` to extract
 * an ordered content tree that preserves document order. This is essential
 * for mixed content like:
 *   <Text>This Act may be cited as the <XRefExternal>Accessible Canada Act</XRefExternal>.</Text>
 *
 * The standard parser uses `preserveOrder=false` which loses the order of
 * text vs child elements. This module provides order-preserving extraction.
 *
 * IMPORTANT: The sectionLabel values produced here MUST match exactly what
 * the main parser (sections.ts, schedules.ts) produces, since that's the join key.
 */

import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import type { ContentNode } from "../types";

/**
 * Parser that preserves document order - essential for mixed content.
 * This is different from the main parser which uses preserveOrder=false.
 */
const preserveOrderParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  trimValues: false,
  textNodeName: "#text",
});

/**
 * Parsed XML data from preserveOrder parser.
 * This is an opaque type - callers should not inspect the structure directly.
 */
export type PreservedOrderData = unknown[];

/**
 * Parse an XML file with preserveOrder=true.
 * Call this once per file, then pass the result to extraction functions.
 *
 * This avoids re-parsing the same file multiple times when extracting
 * different content types (sections, definitions, preambles, treaties).
 */
export function parseFileWithPreservedOrder(
  filePath: string
): PreservedOrderData {
  const xmlContent = readFileSync(filePath, "utf-8");
  return preserveOrderParser.parse(xmlContent);
}

// =============================================================================
// COMBINED EXTRACTION (Single Tree Walk)
// =============================================================================

/**
 * Enabling authority order content extracted with preserved document order.
 * Contains the structured content tree for proper rendering.
 */
export type EnablingAuthorityOrderContent = {
  contentTree: ContentNode[];
  text: string;
};

/**
 * Result from combined extraction - all content types in one pass.
 * This is much faster than calling individual extraction functions.
 */
export type ExtractedContent = {
  contentTrees: SectionContentTree[];
  sectionContents: SectionContent[];
  definitionTexts: DefinitionText[];
  preamble: PreambleProvisionText[] | undefined;
  treaties: TreatyContentText[] | undefined;
  enablingAuthorityOrder: EnablingAuthorityOrderContent | undefined;
};

/**
 * Context for combined extraction walk - bundles all mutable state.
 */
type ExtractionContext = {
  result: ExtractedContent;
  state: ParserState;
  preambleProvisions: PreambleProvisionText[];
  treatyContents: TreatyContentText[];
};

/**
 * Detect document language from root element (Statute/Regulation) xml:lang attribute.
 * Returns "en" if not found or not recognized.
 */
function detectDocumentLanguage(parsed: PreservedOrderData): "en" | "fr" {
  if (!Array.isArray(parsed)) {
    return "en";
  }

  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    // Check for root elements (Statute for acts, Regulation for regulations)
    if (tag === "Statute" || tag === "Regulation") {
      const attrs = obj[":@"] as Record<string, unknown> | undefined;
      const lang = attrs?.["@_xml:lang"] as string | undefined;
      if (lang?.toLowerCase().startsWith("fr")) {
        return "fr";
      }
      return "en";
    }

    // Recurse into container elements
    const value = obj[tag];
    if (Array.isArray(value)) {
      const nested = detectDocumentLanguage(value);
      if (nested !== "en") {
        return nested;
      }
    }
  }

  return "en";
}

/**
 * Constant for Enacting Clause section order.
 * Must match the value used in parser.ts when creating the enacts section.
 */
const ENACTS_SECTION_ORDER = 0;

/**
 * Check if children contain a Definition element.
 */
function hasDefinitionChild(children: unknown[]): boolean {
  for (const child of children) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length > 0 && keys[0] === "Definition") {
      return true;
    }
  }
  return false;
}

/**
 * Extract inline definition text from Section/Subsection children.
 *
 * Inline definitions are DefinedTermEn/Fr directly in Text elements without
 * a Definition wrapper. This mirrors sections.ts lines 339-365.
 *
 * IMPORTANT: This function MUST stay synchronized with sections.ts inline
 * definition handling. Both must detect and process the same cases.
 *
 * KEY BEHAVIOR: sections.ts uses `sectionEl.Text` directly. When there are
 * multiple Text elements, fast-xml-parser returns an array, and checking
 * `textObj.DefinedTermEn` on an array returns undefined. So sections.ts
 * effectively SKIPS inline handling when there are multiple Text elements.
 * We must match this behavior to keep counters aligned.
 *
 * @returns The Text element content if inline definition found, null otherwise
 */
function extractInlineDefinitionText(children: unknown[]): string | null {
  // First, count Text elements - we only process if there's exactly one
  // (matches sections.ts behavior which fails on arrays)
  let textCount = 0;
  let singleTextObj: Record<string, unknown> | null = null;

  for (const child of children) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length > 0 && keys[0] === "Text") {
      textCount++;
      if (textCount === 1) {
        singleTextObj = obj;
      }
    }
  }

  // If not exactly one Text element, skip (matches sections.ts behavior)
  if (textCount !== 1 || !singleTextObj) {
    return null;
  }

  // Check the single Text element for DefinedTermEn or DefinedTermFr
  const textValue = singleTextObj.Text;
  const textChildren = Array.isArray(textValue) ? textValue : [];

  for (const textChild of textChildren) {
    if (!textChild || typeof textChild !== "object") {
      continue;
    }
    const textObj = textChild as Record<string, unknown>;
    const textKeys = Object.keys(textObj).filter((k) => k !== ":@");
    if (textKeys.length === 0) {
      continue;
    }

    if (textKeys[0] === "DefinedTermEn" || textKeys[0] === "DefinedTermFr") {
      // Found inline definition - return the full Text content
      return extractTextFromPreserved(textChildren).replace(/\s+/g, " ").trim();
    }
  }

  return null;
}

/**
 * Extract all content types from pre-parsed XML data in a single tree walk.
 * This is ~5x faster than calling individual extraction functions.
 *
 * @param parsed - Pre-parsed XML data from parseFileWithPreservedOrder()
 */
export function extractAllContent(
  parsed: PreservedOrderData
): ExtractedContent {
  const language = detectDocumentLanguage(parsed);
  const ctx: ExtractionContext = {
    result: {
      contentTrees: [],
      sectionContents: [],
      definitionTexts: [],
      preamble: undefined,
      treaties: undefined,
      enablingAuthorityOrder: undefined,
    },
    state: {
      globalSectionOrder: 0,
      globalDefinitionOrder: 0,
      currentHierarchy: [],
      language,
    },
    preambleProvisions: [],
    treatyContents: [],
  };

  walkForAllContent(parsed, ctx);

  if (ctx.preambleProvisions.length > 0) {
    ctx.result.preamble = ctx.preambleProvisions;
  }
  if (ctx.treatyContents.length > 0) {
    ctx.result.treaties = ctx.treatyContents;
  }

  return ctx.result;
}

/**
 * Extract marginal note text from preserved-order children.
 * Finds the MarginalNote element and extracts its text content.
 */
function extractMarginalNoteFromPreserved(
  children: unknown[]
): string | undefined {
  for (const child of children) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    if (tag === "MarginalNote") {
      const mnChildren = obj[tag];
      if (Array.isArray(mnChildren)) {
        const text = extractTextFromPreserved(mnChildren)
          .replace(/\s+/g, " ")
          .trim();
        return text || undefined;
      }
    }
  }
  return;
}

/**
 * Combined tree walk that extracts all content types simultaneously.
 */
function walkForAllContent(items: unknown[], ctx: ExtractionContext): void {
  if (!Array.isArray(items)) {
    return;
  }

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const children = Array.isArray(value) ? value : [];
    const attrs = obj[":@"] as Record<string, unknown> | undefined;

    // Handle Heading elements - update hierarchy and add as searchable content
    if (tag === "Heading") {
      updateHierarchyFromHeading(children, attrs, ctx.state);
      // Also add to content trees for searchability
      const contentChildren = convertPreservedToContentTree(children);
      const headingNode = convertTagToNode(tag, contentChildren, attrs || {});
      if (headingNode) {
        const headingLabel = ctx.state.currentHierarchy.at(-1) || "Heading";
        ctx.result.contentTrees.push({
          sectionLabel: headingLabel,
          contentTree: [headingNode],
          hierarchyPath: [...ctx.state.currentHierarchy],
          limsId: null,
        });
      }
      continue;
    }

    // Handle Order element (enabling authority order in regulations)
    // Extract as content tree, do NOT process nested Provisions as sections
    if (tag === "Order") {
      const rawContentTree = convertPreservedToContentTree(children);
      // Filter out Footnote nodes - they're extracted separately via extractEnablingAuthorityOrder
      const contentTree = filterOutFootnotes(rawContentTree);
      const text = extractTextFromPreserved(children)
        .replace(/\s+/g, " ")
        .trim();
      if (contentTree.length > 0 || text) {
        ctx.result.enablingAuthorityOrder = { contentTree, text };
      }
      // Don't recurse - Order Provisions are not sections
      continue;
    }

    // Handle Preamble
    if (tag === "Preamble") {
      extractPreambleProvisions(children, ctx.preambleProvisions);
      continue;
    }

    // Handle Treaties (multiple tag names used in legislation XML)
    if (
      tag === "TreatyAgreement" ||
      tag === "Convention" ||
      tag === "Agreement" ||
      tag === "ConventionAgreementTreaty"
    ) {
      const treaty = extractTreatyContent(children);
      if (treaty) {
        ctx.treatyContents.push(treaty);
      }
      continue;
    }

    // Handle Definition elements - use position-based joining
    if (tag === "Definition") {
      ctx.state.globalDefinitionOrder++;
      const definitionText = extractTextFromPreserved(children)
        .replace(/\s+/g, " ")
        .trim();
      if (definitionText) {
        ctx.result.definitionTexts.push({
          definitionOrder: ctx.state.globalDefinitionOrder,
          definitionText,
        });
      }
      continue;
    }

    // Handle Enacts element (enacting clause)
    // Enacts is assigned ENACTS_SECTION_ORDER (0) in the main parser
    if (tag === "Enacts") {
      const limsId = (attrs?.["@_lims:id"] as string) || null;

      // Content tree
      const contentChildren = filterContentChildren(children);
      const contentTree = convertPreservedToContentTree(contentChildren);
      if (contentTree.length > 0) {
        ctx.result.contentTrees.push({
          sectionLabel: "Enacting Clause",
          contentTree,
          hierarchyPath: [...ctx.state.currentHierarchy],
          limsId,
        });
      }

      // Section content (plain text) - uses ENACTS_SECTION_ORDER constant
      const content = extractTextFromPreserved(children)
        .replace(/\s+/g, " ")
        .trim();
      if (content) {
        ctx.result.sectionContents.push({
          sectionOrder: ENACTS_SECTION_ORDER,
          content,
        });
      }
      continue;
    }

    // Handle Schedule elements
    if (tag === "Schedule") {
      extractScheduleContentCombined(children, ctx.result, ctx.state);
      // Only look for treaties and definitions within schedules
      // (don't re-process Section/Provision - already handled by walkScheduleItemsCombined)
      walkScheduleForTreatiesAndDefinitions(children, ctx);
      continue;
    }

    // Handle Section elements
    // IMPORTANT: Definition counter logic must match sections.ts EXACTLY.
    // sections.ts order: (1) Subsection definitions+inline, (2) Section definitions, (3) Section inline.
    // We must process in this order, NOT document order, for position-based joining to work.
    if (tag === "Section") {
      const limsId = (attrs?.["@_lims:id"] as string) || null;
      const label = extractLabelFromPreserved(children);

      if (label) {
        ctx.state.globalSectionOrder++;

        // Content tree
        const contentChildren = filterContentChildren(children);
        const contentTree = convertPreservedToContentTree(contentChildren);
        if (contentTree.length > 0) {
          ctx.result.contentTrees.push({
            sectionLabel: label,
            contentTree,
            hierarchyPath: [...ctx.state.currentHierarchy],
            limsId,
          });
        }

        // Section content (plain text) and marginal note - always push with sectionOrder
        const content = extractTextFromPreserved(children)
          .replace(/\s+/g, " ")
          .trim();
        const marginalNote = extractMarginalNoteFromPreserved(children);
        if (content) {
          ctx.result.sectionContents.push({
            sectionOrder: ctx.state.globalSectionOrder,
            content,
            marginalNote,
          });
        }
      }

      // Step 1: Process Subsections FIRST (mirrors sections.ts lines 236-311)
      // This includes Subsection Definition children and Subsection inline definitions.
      for (const child of children) {
        if (!child || typeof child !== "object") {
          continue;
        }
        const childObj = child as Record<string, unknown>;
        const childKeys = Object.keys(childObj).filter((k) => k !== ":@");
        if (childKeys.length > 0 && childKeys[0] === "Subsection") {
          const subsecChildren = childObj.Subsection;
          const subsecArr = Array.isArray(subsecChildren)
            ? subsecChildren
            : [subsecChildren];
          // Recurse to find Definition elements in subsection
          walkForAllContent(subsecArr, ctx);
          // Check for Subsection inline definitions (only if no Definition children)
          if (!hasDefinitionChild(subsecArr)) {
            const inlineDefText = extractInlineDefinitionText(subsecArr);
            if (inlineDefText) {
              ctx.state.globalDefinitionOrder++;
              ctx.result.definitionTexts.push({
                definitionOrder: ctx.state.globalDefinitionOrder,
                definitionText: inlineDefText,
              });
            }
          }
        }
      }

      // Step 2: Process Section-level Definition children (mirrors sections.ts lines 314-332)
      // Handle Definition elements DIRECTLY here (don't rely on generic handler).
      // For other elements, recurse into their children (old behavior) to avoid
      // triggering Section/Provision/Schedule handlers for nested elements.
      for (const child of children) {
        if (!child || typeof child !== "object") {
          continue;
        }
        const childObj = child as Record<string, unknown>;
        const childKeys = Object.keys(childObj).filter((k) => k !== ":@");
        if (childKeys.length === 0) {
          continue;
        }

        const childTag = childKeys[0];
        if (childTag === "Subsection") {
          // Already handled in Step 1
          continue;
        }

        if (childTag === "Definition") {
          // Handle Definition directly - increment counter and extract text
          // This mirrors what the Definition handler does, but avoids passing
          // through walkForAllContent which could trigger other handlers.
          ctx.state.globalDefinitionOrder++;
          const defChildren = childObj.Definition;
          const defArr = Array.isArray(defChildren) ? defChildren : [];
          const definitionText = extractTextFromPreserved(defArr)
            .replace(/\s+/g, " ")
            .trim();
          if (definitionText) {
            ctx.result.definitionTexts.push({
              definitionOrder: ctx.state.globalDefinitionOrder,
              definitionText,
            });
          }
        } else {
          // For other elements, recurse into their CHILDREN (not the element itself)
          // to find nested Definitions. This avoids triggering Section/Provision/Schedule
          // handlers which would cause counter divergence with sections.ts.
          const childValue = childObj[childTag];
          const childArr = Array.isArray(childValue)
            ? childValue
            : [childValue];
          walkForAllContent(childArr, ctx);
        }
      }

      // Step 3: Handle Section-level inline definitions (mirrors sections.ts lines 339-365)
      // Only check if Section has NO direct Definition children.
      if (!hasDefinitionChild(children)) {
        const inlineDefText = extractInlineDefinitionText(children);
        if (inlineDefText) {
          ctx.state.globalDefinitionOrder++;
          ctx.result.definitionTexts.push({
            definitionOrder: ctx.state.globalDefinitionOrder,
            definitionText: inlineDefText,
          });
        }
      }
      continue;
    }

    // Subsection is handled within Section processing above to maintain correct order.
    // If we encounter Subsection outside of Section context (shouldn't happen), just recurse.
    if (tag === "Subsection") {
      walkForAllContent(children, ctx);
      continue;
    }

    // Handle Provision elements (in Order blocks - regulations)
    if (tag === "Provision") {
      const limsId = (attrs?.["@_lims:id"] as string) || null;
      ctx.state.globalSectionOrder++;

      const label = extractLabelFromPreserved(children);
      const provLabel = label || `order-${ctx.state.globalSectionOrder}`;

      // Content tree
      const contentChildren = filterContentChildren(children);
      const contentTree = convertPreservedToContentTree(contentChildren);
      if (contentTree.length > 0) {
        ctx.result.contentTrees.push({
          sectionLabel: provLabel,
          contentTree,
          hierarchyPath: [...ctx.state.currentHierarchy],
          limsId,
        });
      }

      // Section content (plain text) and marginal note - always push with sectionOrder
      const content = extractTextFromPreserved(children)
        .replace(/\s+/g, " ")
        .trim();
      const marginalNote = extractMarginalNoteFromPreserved(children);
      if (content) {
        ctx.result.sectionContents.push({
          sectionOrder: ctx.state.globalSectionOrder,
          content,
          marginalNote,
        });
      }

      // Recurse to find nested definitions
      walkForAllContent(children, ctx);
      continue;
    }

    // Recurse into container elements
    if (children.length > 0) {
      walkForAllContent(children, ctx);
    }
  }
}

/**
 * Walk schedule children looking ONLY for treaties and definitions.
 * This avoids re-processing Section/Provision which are already handled
 * by walkScheduleItemsCombined.
 */
function walkScheduleForTreatiesAndDefinitions(
  items: unknown[],
  ctx: ExtractionContext
): void {
  if (!Array.isArray(items)) {
    return;
  }

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const children = Array.isArray(value) ? value : [];
    const _attrs = obj[":@"] as Record<string, unknown> | undefined;

    // Handle Treaties within schedules (multiple tag names used in legislation XML)
    if (
      tag === "TreatyAgreement" ||
      tag === "Convention" ||
      tag === "Agreement" ||
      tag === "ConventionAgreementTreaty"
    ) {
      const treaty = extractTreatyContent(children);
      if (treaty) {
        ctx.treatyContents.push(treaty);
      }
      continue;
    }

    // Handle Definition elements within schedules - use position-based joining
    if (tag === "Definition") {
      ctx.state.globalDefinitionOrder++;
      const definitionText = extractTextFromPreserved(children)
        .replace(/\s+/g, " ")
        .trim();
      if (definitionText) {
        ctx.result.definitionTexts.push({
          definitionOrder: ctx.state.globalDefinitionOrder,
          definitionText,
        });
      }
      continue;
    }

    // Recurse into container elements (but skip Section/Provision/Item which are already handled)
    if (
      children.length > 0 &&
      tag !== "Section" &&
      tag !== "Provision" &&
      tag !== "Item" &&
      tag !== "FormGroup" &&
      tag !== "TableGroup"
    ) {
      walkScheduleForTreatiesAndDefinitions(children, ctx);
    }
  }
}

/**
 * Extract schedule content for combined walk.
 */
function extractScheduleContentCombined(
  scheduleChildren: unknown[],
  result: ExtractedContent,
  state: ParserState
): void {
  // Get schedule label (may be null for schedules without ScheduleFormHeading)
  // Use language-appropriate fallback: "Schedule" (en) or "Annexe" (fr)
  const fallbackLabel = state.language === "fr" ? "Annexe" : "Schedule";
  const scheduleLabel = extractScheduleLabel(scheduleChildren) ?? fallbackLabel;

  // Process all schedule item types
  walkScheduleItemsCombined(scheduleChildren, scheduleLabel, result, state);
}

/**
 * Walk schedule items and extract both content trees and section content.
 */
function walkScheduleItemsCombined(
  children: unknown[],
  scheduleLabel: string,
  result: ExtractedContent,
  state: ParserState
): void {
  for (const child of children) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const tagChildren = Array.isArray(value) ? value : [];
    const attrs = obj[":@"] as Record<string, unknown> | undefined;

    if (tag === "Item") {
      const limsId = (attrs?.["@_lims:id"] as string) || null;
      state.globalSectionOrder++;
      const itemLabel = extractLabelFromPreserved(tagChildren);
      const sectionLabel = itemLabel
        ? `${scheduleLabel} Item ${itemLabel}`
        : `${scheduleLabel} Item ${state.globalSectionOrder}`;

      // Content tree
      const contentChildren = filterContentChildren(tagChildren);
      const contentTree = convertPreservedToContentTree(contentChildren);
      if (contentTree.length > 0) {
        result.contentTrees.push({
          sectionLabel,
          contentTree,
          hierarchyPath: [scheduleLabel],
          limsId,
        });
      }

      // Section content - always push with sectionOrder
      const content = extractTextFromPreserved(tagChildren)
        .replace(/\s+/g, " ")
        .trim();
      if (content) {
        result.sectionContents.push({
          sectionOrder: state.globalSectionOrder,
          content,
        });
      }

      // Recurse for nested items
      walkScheduleItemsCombined(tagChildren, scheduleLabel, result, state);
    } else if (tag === "FormGroup") {
      const limsId = (attrs?.["@_lims:id"] as string) || null;
      state.globalSectionOrder++;

      const contentTree = convertPreservedToContentTree(tagChildren);
      if (contentTree.length > 0) {
        result.contentTrees.push({
          sectionLabel: `${scheduleLabel} Form`,
          contentTree,
          hierarchyPath: [scheduleLabel],
          limsId,
        });
      }

      const content = extractTextFromPreserved(tagChildren)
        .replace(/\s+/g, " ")
        .trim();
      if (content) {
        result.sectionContents.push({
          sectionOrder: state.globalSectionOrder,
          content,
        });
      }
    } else if (tag === "TableGroup") {
      const limsId = (attrs?.["@_lims:id"] as string) || null;
      state.globalSectionOrder++;

      const contentTree = convertPreservedToContentTree(tagChildren);
      if (contentTree.length > 0) {
        result.contentTrees.push({
          sectionLabel: `${scheduleLabel} Table`,
          contentTree,
          hierarchyPath: [scheduleLabel],
          limsId,
        });
      }

      const content = extractTextFromPreserved(tagChildren)
        .replace(/\s+/g, " ")
        .trim();
      if (content) {
        result.sectionContents.push({
          sectionOrder: state.globalSectionOrder,
          content,
        });
      }
    } else if (tag === "Provision") {
      const limsId = (attrs?.["@_lims:id"] as string) || null;
      state.globalSectionOrder++;
      const provLabel = extractLabelFromPreserved(tagChildren);
      const sectionLabel = provLabel
        ? `${scheduleLabel} ${provLabel}`.trim()
        : `${scheduleLabel} Provision ${state.globalSectionOrder}`.trim();

      const contentChildren = filterContentChildren(tagChildren);
      const contentTree = convertPreservedToContentTree(contentChildren);
      if (contentTree.length > 0) {
        result.contentTrees.push({
          sectionLabel,
          contentTree,
          hierarchyPath: [scheduleLabel],
          limsId,
        });
      }

      const content = extractTextFromPreserved(tagChildren)
        .replace(/\s+/g, " ")
        .trim();
      if (content) {
        result.sectionContents.push({
          sectionOrder: state.globalSectionOrder,
          content,
        });
      }

      // Extract definitions from schedule Provisions (mirrors sections.ts Provision handling)
      for (const provChild of tagChildren) {
        if (!provChild || typeof provChild !== "object") {
          continue;
        }
        const provChildObj = provChild as Record<string, unknown>;
        const provChildKeys = Object.keys(provChildObj).filter(
          (k) => k !== ":@"
        );
        if (provChildKeys.length > 0 && provChildKeys[0] === "Definition") {
          state.globalDefinitionOrder++;
          const defChildren = provChildObj.Definition;
          const defArr = Array.isArray(defChildren) ? defChildren : [];
          const definitionText = extractTextFromPreserved(defArr)
            .replace(/\s+/g, " ")
            .trim();
          if (definitionText) {
            result.definitionTexts.push({
              definitionOrder: state.globalDefinitionOrder,
              definitionText,
            });
          }
        }
      }
    } else if (tag === "Section") {
      // Sections within schedules (e.g., in BillPiece containers)
      const limsId = (attrs?.["@_lims:id"] as string) || null;
      state.globalSectionOrder++;
      const sectionLabelText = extractLabelFromPreserved(tagChildren);
      const sectionLabelFull = sectionLabelText
        ? `${scheduleLabel} ${sectionLabelText}`.trim()
        : `${scheduleLabel} Section ${state.globalSectionOrder}`.trim();

      const contentChildren = filterContentChildren(tagChildren);
      const contentTree = convertPreservedToContentTree(contentChildren);
      if (contentTree.length > 0) {
        result.contentTrees.push({
          sectionLabel: sectionLabelFull,
          contentTree,
          hierarchyPath: [scheduleLabel],
          limsId,
        });
      }

      const content = extractTextFromPreserved(tagChildren)
        .replace(/\s+/g, " ")
        .trim();
      if (content) {
        result.sectionContents.push({
          sectionOrder: state.globalSectionOrder,
          content,
        });
      }

      // Extract definitions from schedule sections (mirrors sections.ts logic)
      // Step 1: Process Subsections first (their definitions + inline)
      for (const sectionChild of tagChildren) {
        if (!sectionChild || typeof sectionChild !== "object") {
          continue;
        }
        const sectionChildObj = sectionChild as Record<string, unknown>;
        const sectionChildKeys = Object.keys(sectionChildObj).filter(
          (k) => k !== ":@"
        );
        if (
          sectionChildKeys.length > 0 &&
          sectionChildKeys[0] === "Subsection"
        ) {
          const subsecChildren = sectionChildObj.Subsection;
          const subsecArr = Array.isArray(subsecChildren)
            ? subsecChildren
            : [subsecChildren];

          // Find Definition elements in subsection
          for (const subsecChild of subsecArr) {
            if (!subsecChild || typeof subsecChild !== "object") {
              continue;
            }
            const subsecChildObj = subsecChild as Record<string, unknown>;
            const subsecChildKeys = Object.keys(subsecChildObj).filter(
              (k) => k !== ":@"
            );
            if (
              subsecChildKeys.length > 0 &&
              subsecChildKeys[0] === "Definition"
            ) {
              state.globalDefinitionOrder++;
              const defChildren = subsecChildObj.Definition;
              const defArr = Array.isArray(defChildren) ? defChildren : [];
              const definitionText = extractTextFromPreserved(defArr)
                .replace(/\s+/g, " ")
                .trim();
              if (definitionText) {
                result.definitionTexts.push({
                  definitionOrder: state.globalDefinitionOrder,
                  definitionText,
                });
              }
            }
          }

          // Check for Subsection inline definitions
          if (!hasDefinitionChild(subsecArr)) {
            const inlineDefText = extractInlineDefinitionText(subsecArr);
            if (inlineDefText) {
              state.globalDefinitionOrder++;
              result.definitionTexts.push({
                definitionOrder: state.globalDefinitionOrder,
                definitionText: inlineDefText,
              });
            }
          }
        }
      }

      // Step 2: Process Section-level Definition children
      for (const sectionChild of tagChildren) {
        if (!sectionChild || typeof sectionChild !== "object") {
          continue;
        }
        const sectionChildObj = sectionChild as Record<string, unknown>;
        const sectionChildKeys = Object.keys(sectionChildObj).filter(
          (k) => k !== ":@"
        );
        if (sectionChildKeys.length === 0) {
          continue;
        }
        const childTag = sectionChildKeys[0];
        if (childTag === "Subsection") {
          continue; // Already handled in Step 1
        }
        if (childTag === "Definition") {
          state.globalDefinitionOrder++;
          const defChildren = sectionChildObj.Definition;
          const defArr = Array.isArray(defChildren) ? defChildren : [];
          const definitionText = extractTextFromPreserved(defArr)
            .replace(/\s+/g, " ")
            .trim();
          if (definitionText) {
            result.definitionTexts.push({
              definitionOrder: state.globalDefinitionOrder,
              definitionText,
            });
          }
        }
      }

      // Step 3: Handle Section-level inline definitions
      if (!hasDefinitionChild(tagChildren)) {
        const inlineDefText = extractInlineDefinitionText(tagChildren);
        if (inlineDefText) {
          state.globalDefinitionOrder++;
          result.definitionTexts.push({
            definitionOrder: state.globalDefinitionOrder,
            definitionText: inlineDefText,
          });
        }
      }
    } else if (
      tag === "List" ||
      tag === "DocumentInternal" ||
      tag === "Group" ||
      tag === "BillPiece" ||
      tag === "RegulationPiece" ||
      tag === "RelatedOrNotInForce" ||
      tag === "SectionPiece" ||
      tag === "Order" ||
      tag === "Recommendation" ||
      tag === "Notice" ||
      tag === "AmendedText"
    ) {
      // Container elements - recurse into them (per LIMS2HTML.xsl patterns)
      walkScheduleItemsCombined(tagChildren, scheduleLabel, result, state);
    }
  }
}

/**
 * Result from content tree extraction for a single section.
 */
export type SectionContentTree = {
  sectionLabel: string;
  contentTree: ContentNode[];
  hierarchyPath: string[];
  /** Justice Canada's unique element ID (lims:id attribute). Used as primary join key. */
  limsId: string | null;
};

/**
 * State for tracking position during parsing.
 *
 * CRITICAL: The counter logic in this file MUST exactly match sections.ts.
 * Position-based joining (sectionOrder, definitionOrder) is the PRIMARY join key.
 * Both passes (structure extraction in sections.ts, content extraction here) must
 * increment counters for the same elements in the same order.
 *
 * Key synchronization points:
 * - globalSectionOrder: Increments for Section, Provision, schedule items
 * - globalDefinitionOrder: Increments for Definition tags AND inline definitions
 * - Section processing order: Subsections first, then Section-level content (mirrors sections.ts)
 */
type ParserState = {
  /**
   * Global section order that matches the main parser's sectionOrder.
   * Increments for ALL section types in document order.
   */
  globalSectionOrder: number;
  /**
   * Global definition order for position-based joining.
   * Increments for each Definition element in document order.
   */
  globalDefinitionOrder: number;
  /**
   * Current hierarchy path (Part, Division, etc).
   * Updated when Heading elements are encountered.
   */
  currentHierarchy: string[];
  /**
   * Document language from xml:lang attribute on root element.
   * Used for language-appropriate fallback labels (e.g., "Schedule" vs "Annexe").
   */
  language: "en" | "fr";
};

/**
 * Extract content trees for all sections from pre-parsed XML data.
 * Returns an array of { sectionLabel, contentTree } for joining with
 * the main parser's canonicalSectionId.
 *
 * @param parsed - Pre-parsed XML data from parseFileWithPreservedOrder()
 */
export function extractContentTrees(
  parsed: PreservedOrderData
): SectionContentTree[] {
  const results: SectionContentTree[] = [];
  const language = detectDocumentLanguage(parsed);
  const state: ParserState = {
    globalSectionOrder: 0,
    globalDefinitionOrder: 0,
    currentHierarchy: [],
    language,
  };

  // Walk the preserved structure to find sections
  walkPreservedStructure(parsed, results, state);

  return results;
}

/**
 * Walk preserved-order structure to find Section, Schedule, Provision, and Enacts elements.
 * Adds results directly to the results array.
 */
function walkPreservedStructure(
  items: unknown[],
  results: SectionContentTree[],
  state: ParserState
): void {
  if (!Array.isArray(items)) {
    return;
  }

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const children = Array.isArray(value) ? value : [];

    // Handle Heading elements - update hierarchy and add as searchable content
    if (tag === "Heading") {
      // Pass attributes from parent object - level is on the Heading element itself
      const attrs = obj[":@"] as Record<string, unknown> | undefined;
      updateHierarchyFromHeading(children, attrs, state);
      // Also add to results for searchability
      const contentChildren = convertPreservedToContentTree(children);
      const headingNode = convertTagToNode(tag, contentChildren, attrs || {});
      if (headingNode) {
        const headingLabel = state.currentHierarchy.at(-1) || "Heading";
        results.push({
          sectionLabel: headingLabel,
          contentTree: [headingNode],
          hierarchyPath: [...state.currentHierarchy],
          limsId: null,
        });
      }
      continue;
    }

    // Handle Enacts element (enacting clause)
    if (tag === "Enacts") {
      const attrs = obj[":@"] as Record<string, unknown> | undefined;
      const limsId = (attrs?.["@_lims:id"] as string) || null;
      const contentChildren = filterContentChildren(children);
      const contentTree = convertPreservedToContentTree(contentChildren);
      if (contentTree.length > 0) {
        results.push({
          sectionLabel: "Enacting Clause",
          contentTree,
          hierarchyPath: [...state.currentHierarchy],
          limsId,
        });
      }
      continue;
    }

    // Handle Schedule elements - extract individual items, not whole schedule
    if (tag === "Schedule") {
      extractScheduleContent(children, results, state);
      // Don't recurse - schedule content is handled by extractScheduleContent
      continue;
    }

    // Handle Section elements (main sections with numbered labels)
    if (tag === "Section") {
      const attrs = obj[":@"] as Record<string, unknown> | undefined;
      const limsId = (attrs?.["@_lims:id"] as string) || null;
      const label = extractLabelFromPreserved(children);
      if (label) {
        // Increment counter for fallback labels (used when limsId is unavailable)
        state.globalSectionOrder++;

        const contentChildren = filterContentChildren(children);
        const contentTree = convertPreservedToContentTree(contentChildren);
        if (contentTree.length > 0) {
          results.push({
            sectionLabel: label,
            contentTree,
            hierarchyPath: [...state.currentHierarchy],
            limsId,
          });
        }
      }
      // Don't recurse into sections - their content is already captured
      continue;
    }

    // Handle Provision elements (in Order blocks - regulations)
    // Main parser (sections.ts) labels these as "order-{sectionOrder}"
    if (tag === "Provision") {
      const attrs = obj[":@"] as Record<string, unknown> | undefined;
      const limsId = (attrs?.["@_lims:id"] as string) || null;
      // Increment counter for fallback labels (used when limsId is unavailable)
      state.globalSectionOrder++;

      const label = extractLabelFromPreserved(children);
      // Match main parser's fallback label format: "order-{sectionOrder}"
      const provLabel = label || `order-${state.globalSectionOrder}`;

      const contentChildren = filterContentChildren(children);
      const contentTree = convertPreservedToContentTree(contentChildren);
      if (contentTree.length > 0) {
        results.push({
          sectionLabel: provLabel,
          contentTree,
          hierarchyPath: [...state.currentHierarchy],
          limsId,
        });
      }
      continue;
    }

    // Recurse into container elements (Body, Introduction, Preamble, etc.)
    if (children.length > 0) {
      walkPreservedStructure(children, results, state);
    }
  }
}

/**
 * Update hierarchy from a Heading element.
 * Headings have @level attribute that determines their depth in the hierarchy.
 * Level 1 = Part, Level 2 = Division, etc.
 *
 * With preserveOrder=true, the level attribute is on the Heading element itself
 * (passed via headingAttrs), while Label/TitleText are in headingChildren.
 */
function updateHierarchyFromHeading(
  headingChildren: unknown[],
  headingAttrs: Record<string, unknown> | undefined,
  state: ParserState
): void {
  // Extract level from the Heading element's attributes (not from children)
  let level = 1;
  if (headingAttrs?.["@_level"]) {
    level = Number.parseInt(String(headingAttrs["@_level"]), 10) || 1;
  }

  // Extract Label and TitleText from children
  let labelText = "";
  let titleText = "";

  for (const child of headingChildren) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];

    if (tag === "Label") {
      labelText = extractTextFromPreserved(value);
    } else if (tag === "TitleText") {
      titleText = extractTextFromPreserved(value);
    }
  }

  // Build heading text
  const headingText = [labelText, titleText].filter(Boolean).join(" ");

  // Adjust hierarchy based on level
  // Pop entries until we're at the right level (level 1 clears all, level 2 keeps level 1, etc.)
  while (state.currentHierarchy.length >= level) {
    state.currentHierarchy.pop();
  }

  // Push this heading
  if (headingText) {
    state.currentHierarchy.push(headingText);
  }
}

/**
 * Extract text content from a preserveOrder structure.
 * Used for extracting Label/TitleText from Heading elements.
 * Recursively descends into child elements.
 *
 * Adds trailing spaces after certain elements (Label, Subsection, Paragraph)
 * to ensure proper spacing in plain text output.
 */
function extractTextFromPreserved(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }

  let text = "";
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const obj = item as Record<string, unknown>;
    // Handle both string and numeric text values (fast-xml-parser parses "1" as number 1)
    if (obj["#text"] !== undefined) {
      text += String(obj["#text"]);
    }
    // Recurse into child elements
    for (const key of Object.keys(obj)) {
      if (key !== ":@" && key !== "#text") {
        // Skip elements that are metadata/supplementary, not main content:
        // - Footnote: reference citations (e.g., "S.C. 1994, c. 44, s. 35")
        // - MarginalNote: side headings extracted separately
        // - HistoricalNote/HistoricalNoteSubItem: amendment history citations
        // FootnoteRef markers (superscript a, b, c) are still included inline.
        if (
          key === "Footnote" ||
          key === "MarginalNote" ||
          key === "HistoricalNote" ||
          key === "HistoricalNoteSubItem"
        ) {
          continue;
        }
        const children = obj[key];
        if (Array.isArray(children)) {
          const childText = extractTextFromPreserved(children);
          text += childText;
          // Add trailing space after Label elements and block-level elements
          // to ensure proper spacing (e.g., "355 A person..." not "355A person...")
          if (
            childText &&
            (key === "Label" ||
              key === "Subsection" ||
              key === "Paragraph" ||
              key === "Subparagraph" ||
              key === "Clause")
          ) {
            text += " ";
          }
        }
      }
    }
  }
  return text.trim();
}

/**
 * Extract content from a Schedule element into individual sections.
 * Matches the labeling logic from schedules.ts:
 * - List/Item → "${scheduleLabel} Item ${itemLabel}"
 * - FormGroup → "${scheduleLabel} Form"
 * - TableGroup → "${scheduleLabel} Table"
 * - DocumentInternal/Provision → "${scheduleLabel} ${groupPath} ${provLabel}"
 */
function extractScheduleContent(
  scheduleChildren: unknown[],
  results: SectionContentTree[],
  state: ParserState
): void {
  // Get schedule label (may be null for schedules without ScheduleFormHeading)
  // Use language-appropriate fallback: "Schedule" (en) or "Annexe" (fr)
  const fallbackLabel = state.language === "fr" ? "Annexe" : "Schedule";
  const scheduleLabel = extractScheduleLabel(scheduleChildren) ?? fallbackLabel;

  // Process List elements (schedule items)
  extractScheduleListItems(scheduleChildren, scheduleLabel, results, state);

  // Process FormGroup elements
  extractScheduleFormGroups(scheduleChildren, scheduleLabel, results, state);

  // Process TableGroup elements
  extractScheduleTableGroups(scheduleChildren, scheduleLabel, results, state);

  // Process DocumentInternal elements (treaties, agreements with nested provisions)
  extractScheduleDocumentInternal(
    scheduleChildren,
    scheduleLabel,
    results,
    state
  );
}

/**
 * Extract List/Item elements from schedule.
 * Creates sections with labels like "Schedule I Item 1" or "Schedule I Item (a)".
 */
function extractScheduleListItems(
  children: unknown[],
  scheduleLabel: string,
  results: SectionContentTree[],
  state: ParserState
): void {
  for (const child of children) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const tagChildren = Array.isArray(value) ? value : [];

    if (tag === "List") {
      // Process items in this list
      processListItems(tagChildren, scheduleLabel, results, state);
    }
  }
}

/**
 * Process Item elements within a List.
 */
function processListItems(
  listChildren: unknown[],
  scheduleLabel: string,
  results: SectionContentTree[],
  state: ParserState
): void {
  for (const child of listChildren) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const tagChildren = Array.isArray(value) ? value : [];

    if (tag === "Item") {
      const attrs = obj[":@"] as Record<string, unknown> | undefined;
      const limsId = (attrs?.["@_lims:id"] as string) || null;
      // Increment counter for fallback labels (used when limsId is unavailable)
      state.globalSectionOrder++;
      const itemLabel = extractLabelFromPreserved(tagChildren);

      // Match schedules.ts labeling: "${scheduleLabel} Item ${itemLabel}" or "${scheduleLabel} Item ${sectionOrder}"
      const sectionLabel = itemLabel
        ? `${scheduleLabel} Item ${itemLabel}`
        : `${scheduleLabel} Item ${state.globalSectionOrder}`;

      const contentChildren = filterContentChildren(tagChildren);
      const contentTree = convertPreservedToContentTree(contentChildren);
      if (contentTree.length > 0) {
        results.push({
          sectionLabel,
          contentTree,
          hierarchyPath: [scheduleLabel],
          limsId,
        });
      }

      // Process nested lists within this item
      for (const itemChild of tagChildren) {
        if (!itemChild || typeof itemChild !== "object") {
          continue;
        }
        const itemChildObj = itemChild as Record<string, unknown>;
        const itemChildKeys = Object.keys(itemChildObj).filter(
          (k) => k !== ":@"
        );
        if (itemChildKeys.length > 0 && itemChildKeys[0] === "List") {
          const nestedListChildren = Array.isArray(itemChildObj.List)
            ? itemChildObj.List
            : [];
          processListItems(nestedListChildren, scheduleLabel, results, state);
        }
      }
    }
  }
}

/**
 * Extract FormGroup elements from schedule.
 * Creates sections with label "${scheduleLabel} Form".
 */
function extractScheduleFormGroups(
  children: unknown[],
  scheduleLabel: string,
  results: SectionContentTree[],
  state: ParserState
): void {
  for (const child of children) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const tagChildren = Array.isArray(value) ? value : [];

    if (tag === "FormGroup") {
      const attrs = obj[":@"] as Record<string, unknown> | undefined;
      const limsId = (attrs?.["@_lims:id"] as string) || null;
      // Increment counter for fallback labels (used when limsId is unavailable)
      state.globalSectionOrder++;
      const contentTree = convertPreservedToContentTree(tagChildren);
      if (contentTree.length > 0) {
        results.push({
          sectionLabel: `${scheduleLabel} Form`,
          contentTree,
          hierarchyPath: [scheduleLabel],
          limsId,
        });
      }
    }
  }
}

/**
 * Extract TableGroup elements from schedule.
 * Creates sections with label "${scheduleLabel} Table".
 */
function extractScheduleTableGroups(
  children: unknown[],
  scheduleLabel: string,
  results: SectionContentTree[],
  state: ParserState
): void {
  for (const child of children) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const tagChildren = Array.isArray(value) ? value : [];

    if (tag === "TableGroup") {
      const attrs = obj[":@"] as Record<string, unknown> | undefined;
      const limsId = (attrs?.["@_lims:id"] as string) || null;
      // Increment counter for fallback labels (used when limsId is unavailable)
      state.globalSectionOrder++;
      const contentTree = convertPreservedToContentTree(tagChildren);
      if (contentTree.length > 0) {
        results.push({
          sectionLabel: `${scheduleLabel} Table`,
          contentTree,
          hierarchyPath: [scheduleLabel],
          limsId,
        });
      }
    }
  }
}

/**
 * Extract DocumentInternal/Provision elements from schedule.
 * Creates sections with labels like "${scheduleLabel} Article 1" or "${scheduleLabel} PART I Section 2".
 */
function extractScheduleDocumentInternal(
  children: unknown[],
  scheduleLabel: string,
  results: SectionContentTree[],
  state: ParserState
): void {
  for (const child of children) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const tagChildren = Array.isArray(value) ? value : [];

    if (tag === "DocumentInternal") {
      // Process provisions within DocumentInternal, building group path
      processDocumentInternalContent({
        children: tagChildren,
        scheduleLabel,
        groupPath: [],
        results,
        state,
      });
    }
  }
}

type DocumentInternalContext = {
  children: unknown[];
  scheduleLabel: string;
  groupPath: string[];
  results: SectionContentTree[];
  state: ParserState;
};

/**
 * Process content within DocumentInternal, tracking group hierarchy for labels.
 */
function processDocumentInternalContent(ctx: DocumentInternalContext): void {
  const { children, scheduleLabel, groupPath, results, state } = ctx;
  for (const child of children) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const tagChildren = Array.isArray(value) ? value : [];

    if (tag === "Provision") {
      const attrs = obj[":@"] as Record<string, unknown> | undefined;
      const limsId = (attrs?.["@_lims:id"] as string) || null;
      // Increment counter for fallback labels (used when limsId is unavailable)
      state.globalSectionOrder++;
      const provLabel = extractLabelFromPreserved(tagChildren);

      // Match schedules.ts labeling: "${scheduleLabel} ${groupPath} ${provLabel}"
      const pathStr = groupPath.join(" ");
      const sectionLabel = provLabel
        ? `${scheduleLabel} ${pathStr} ${provLabel}`.trim()
        : `${scheduleLabel} ${pathStr} Provision ${state.globalSectionOrder}`.trim();

      const contentChildren = filterContentChildren(tagChildren);
      const contentTree = convertPreservedToContentTree(contentChildren);
      if (contentTree.length > 0) {
        // Build hierarchy: schedule label + group path
        const hierarchyPath = [scheduleLabel, ...groupPath].filter(Boolean);
        results.push({ sectionLabel, contentTree, hierarchyPath, limsId });
      }
    } else if (tag === "Group") {
      // Extract group heading for hierarchy path
      const groupHeading = extractGroupHeading(tagChildren);
      const newPath = groupHeading ? [...groupPath, groupHeading] : groupPath;
      processDocumentInternalContent({
        children: tagChildren,
        scheduleLabel,
        groupPath: newPath,
        results,
        state,
      });
    } else if (tagChildren.length > 0) {
      // Recurse into other container elements
      processDocumentInternalContent({
        children: tagChildren,
        scheduleLabel,
        groupPath,
        results,
        state,
      });
    }
  }
}

/**
 * Extract group heading text from Group element's GroupHeading child.
 * Returns combined Label and TitleText.
 */
function extractGroupHeading(groupChildren: unknown[]): string | null {
  for (const child of groupChildren) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const tagChildren = Array.isArray(value) ? value : [];

    if (tag === "GroupHeading") {
      const label = extractLabelFromPreserved(tagChildren);
      const title = extractTitleTextFromPreserved(tagChildren);
      const heading = [label, title].filter(Boolean).join(" ");
      return heading || null;
    }
  }
  return null;
}

/**
 * Extract TitleText content from preserved-order children.
 */
function extractTitleTextFromPreserved(children: unknown[]): string | null {
  for (const child of children) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];

    if (tag === "TitleText") {
      const tagChildren = Array.isArray(value) ? value : [];
      return extractTextFromPreserved(tagChildren);
    }
  }
  return null;
}

/**
 * Extract the label from a Schedule element.
 * Looks for <ScheduleFormHeading><Label>Schedule I</Label></ScheduleFormHeading>
 * or falls back to @id attribute.
 *
 * With preserveOrder=true, structure is:
 * [{ "ScheduleFormHeading": [...], ":@": {} }, { "Label": [...], ":@": {} }, ...]
 */
function extractScheduleLabel(children: unknown[]): string | null {
  for (const child of children) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const tagChildren = Array.isArray(value) ? value : [];

    // Check for ScheduleFormHeading - look for Label inside it
    if (tag === "ScheduleFormHeading") {
      const label = extractLabelFromPreserved(tagChildren);
      if (label) {
        return label;
      }
    }

    // Check for direct Label
    if (tag === "Label") {
      return extractTextFromPreserved(tagChildren);
    }
  }
  return null;
}

/**
 * Extract Label text from preserved-order children.
 *
 * With preserveOrder=true, structure is:
 * [{ "Label": [...], ":@": {} }, { "#text": "..." }, ...]
 */
function extractLabelFromPreserved(children: unknown[]): string | null {
  for (const child of children) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];

    if (tag === "Label") {
      const tagChildren = Array.isArray(value) ? value : [];
      return extractTextFromPreserved(tagChildren);
    }
  }
  return null;
}

/**
 * Filter out metadata elements from section children.
 * Keep only content elements (Text, Subsection, Paragraph, Definition, etc.)
 */
function filterContentChildren(children: unknown[]): unknown[] {
  const skipTags = new Set([
    "Label",
    "MarginalNote",
    "HistoricalNote",
    "HistoricalNoteSubItem",
  ]);

  return children.filter((child) => {
    if (!child || typeof child !== "object") {
      return false;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      return false;
    }
    const tag = keys[0];
    return !skipTags.has(tag);
  });
}

/**
 * Serialize preserved-order XML structure back to XML string.
 * Used for MathML which needs to be preserved as raw XML for browser rendering.
 */
function serializePreservedToXml(items: unknown[]): string {
  let xml = "";

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const attrs = (obj[":@"] as Record<string, unknown>) || {};

    // Handle text nodes
    if (tag === "#text") {
      const textValue = typeof value === "string" ? value : String(value);
      // Escape XML special characters
      xml += textValue
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      continue;
    }

    // Build attributes string
    const attrStr = Object.entries(attrs)
      .filter(([k]) => k.startsWith("@_"))
      .map(([k, v]) => `${k.slice(2)}="${String(v)}"`)
      .join(" ");

    const children = Array.isArray(value) ? value : [];
    if (children.length === 0) {
      // Self-closing tag
      xml += attrStr ? `<${tag} ${attrStr}/>` : `<${tag}/>`;
    } else {
      // Tag with children
      xml += attrStr ? `<${tag} ${attrStr}>` : `<${tag}>`;
      xml += serializePreservedToXml(children);
      xml += `</${tag}>`;
    }
  }

  return xml;
}

/**
 * Check if a node is a Footnote (either type "Footnote" or Unknown with tag "Footnote").
 */
function isFootnoteNode(node: ContentNode): boolean {
  if (node.type === "Footnote") {
    return true;
  }
  if (node.type === "Unknown" && "tag" in node && node.tag === "Footnote") {
    return true;
  }
  return false;
}

/**
 * Filter out Footnote nodes from a ContentNode tree.
 * Used for Order contentTree where footnotes are extracted separately.
 */
function filterOutFootnotes(nodes: ContentNode[]): ContentNode[] {
  return nodes
    .filter((node) => !isFootnoteNode(node))
    .map((node) => {
      if ("children" in node && Array.isArray(node.children)) {
        return { ...node, children: filterOutFootnotes(node.children) };
      }
      return node;
    });
}

/**
 * Convert fast-xml-parser's preserveOrder structure to ContentNode[].
 */
function convertPreservedToContentTree(items: unknown[]): ContentNode[] {
  const result: ContentNode[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const attrs = (obj[":@"] as Record<string, unknown>) || {};

    // Handle text nodes
    if (tag === "#text") {
      const textValue = typeof value === "string" ? value : String(value);
      if (textValue) {
        result.push({ type: "text", value: textValue });
      }
      continue;
    }

    // Handle MathML specially - serialize to raw XML for browser rendering
    if (tag === "math" || tag === "MathML") {
      const children = Array.isArray(value) ? value : [];
      const innerXml = serializePreservedToXml(children);
      const display = attrs["@_display"] as "block" | "inline" | undefined;
      // Always use <math> tag with MathML namespace for browser compatibility
      const displayAttr = display ? ` display="${display}"` : "";
      const raw = `<math xmlns="http://www.w3.org/1998/Math/MathML"${displayAttr}>${innerXml}</math>`;
      result.push({ type: "MathML", raw, display });
      continue;
    }

    // Get children recursively
    const children = Array.isArray(value)
      ? convertPreservedToContentTree(value)
      : [];

    // Convert to ContentNode based on tag
    const node = convertTagToNode(tag, children, attrs);
    if (node) {
      result.push(node);
    }
  }

  return result;
}

/**
 * Convert an XML tag to a ContentNode.
 */
function convertTagToNode(
  tag: string,
  children: ContentNode[],
  attrs: Record<string, unknown>
): ContentNode | null {
  switch (tag) {
    // Defined terms and references
    case "DefinedTermEn":
      return { type: "DefinedTermEn", children };
    case "DefinedTermFr":
      return { type: "DefinedTermFr", children };
    case "DefinitionRef":
      return { type: "DefinitionRef", children };

    // Cross-references
    case "XRefExternal":
      return {
        type: "XRefExternal",
        link: attrs["@_link"] as string | undefined,
        refType: attrs["@_reference-type"] as string | undefined,
        children,
      };
    case "XRefInternal":
      return {
        type: "XRefInternal",
        target: (attrs["@_target"] || attrs["@_idref"] || attrs["@_link"]) as
          | string
          | undefined,
        children,
      };

    // Text formatting
    case "Emphasis":
      return {
        type: "Emphasis",
        style: attrs["@_style"] as "italic" | "bold" | "smallcaps" | undefined,
        children,
      };
    case "Language":
      return {
        type: "Language",
        lang: attrs["@_xml:lang"] as string | undefined,
        children,
      };
    case "Repealed":
      return { type: "Repealed", children };
    case "FootnoteRef":
      return {
        type: "FootnoteRef",
        id: attrs["@_idref"] as string | undefined,
        children,
      };
    case "Sup":
      return { type: "Sup", children };
    case "Sub":
      return { type: "Sub", children };
    // Additional inline formatting (MathML and formula related)
    case "Superscript":
      return { type: "Superscript", children };
    case "Subscript":
      return { type: "Subscript", children };
    case "Base":
      return { type: "Base", children };

    // Inline formatting elements (self-closing)
    case "LineBreak":
      return { type: "LineBreak" };
    case "PageBreak":
      return { type: "PageBreak" };
    case "FormBlank":
      return {
        type: "FormBlank",
        width: attrs["@_width"] as string | undefined,
        ...(children.length > 0 && { children }),
      };
    case "Fraction":
      return { type: "Fraction", children };
    case "Numerator":
      return { type: "Numerator", children };
    case "Denominator":
      return { type: "Denominator", children };
    case "Leader": {
      // Style can be in @_leader or @_leader-pattern attribute
      const style = (attrs["@_leader"] || attrs["@_leader-pattern"]) as
        | "solid"
        | "dot"
        | "dash"
        | "none"
        | undefined;
      const length = attrs["@_length"] as string | undefined;
      return {
        type: "Leader",
        ...(style && { style }),
        ...(length && { length }),
      };
    }
    case "Separator":
      return { type: "Separator" };

    // Structure elements
    case "Label":
      return { type: "Label", children };
    case "Text":
      return { type: "Text", children };
    case "Subsection":
      return { type: "Subsection", children };
    case "Paragraph":
      return { type: "Paragraph", children };
    case "Subparagraph":
      return { type: "Subparagraph", children };
    case "Clause":
      return { type: "Clause", children };
    case "Subclause":
      return { type: "Subclause", children };
    case "Subsubclause":
      return { type: "Subsubclause", children };
    case "Definition":
      return { type: "Definition", children };
    case "DefinitionEnOnly":
      return { type: "DefinitionEnOnly", children };
    case "DefinitionFrOnly":
      return { type: "DefinitionFrOnly", children };
    case "Continued":
      return { type: "Continued", children };
    case "ContinuedSubparagraph":
      return { type: "ContinuedSubparagraph", children };
    case "ContinuedClause":
      return { type: "ContinuedClause", children };
    case "ContinuedSubclause":
      return { type: "ContinuedSubclause", children };
    case "ContinuedFormulaParagraph":
      return { type: "ContinuedFormulaParagraph", children };
    case "ContinuedSectionSubsection":
      return { type: "ContinuedSectionSubsection", children };
    case "ContinuedParagraph":
      return { type: "ContinuedParagraph", children };
    case "ContinuedDefinition":
      return { type: "ContinuedDefinition", children };

    // Lists
    case "List":
      return {
        type: "List",
        style: attrs["@_style"] as string | undefined,
        children,
      };
    case "Item":
      return { type: "Item", children };

    // Tables (CALS)
    case "TableGroup":
      return { type: "TableGroup", children };
    case "table":
    case "Table":
      return {
        type: "Table",
        attrs: extractTableAttrs(attrs),
        children,
      };
    case "tgroup":
    case "TGroup":
      return {
        type: "TGroup",
        cols: attrs["@_cols"]
          ? Number.parseInt(attrs["@_cols"] as string, 10)
          : undefined,
        children,
      };
    case "colspec":
    case "ColSpec":
      return {
        type: "ColSpec",
        colName: attrs["@_colname"] as string | undefined,
        colWidth: attrs["@_colwidth"] as string | undefined,
      };
    case "thead":
    case "THead":
      return { type: "THead", children };
    case "tbody":
    case "TBody":
      return { type: "TBody", children };
    case "tfoot":
    case "TFoot":
      return { type: "TFoot", children };
    case "row":
    case "Row":
      return { type: "Row", children };
    case "entry":
    case "Entry":
      return {
        type: "Entry",
        attrs: extractEntryAttrs(attrs),
        children,
      };

    // Formulas
    case "FormulaGroup":
      return { type: "FormulaGroup", children };
    case "Formula":
      return { type: "Formula", children };
    case "FormulaText":
      return { type: "FormulaText", children };
    case "FormulaConnector":
      return { type: "FormulaConnector", children };
    case "FormulaDefinition":
      return { type: "FormulaDefinition", children };
    case "FormulaTerm":
      return { type: "FormulaTerm", children };
    case "FormulaParagraph":
      return { type: "FormulaParagraph", children };

    // Images
    case "ImageGroup":
      return { type: "ImageGroup", children };
    case "Image":
      return {
        type: "Image",
        source: attrs["@_source"] as string | undefined,
      };
    case "Caption":
      return { type: "Caption", children };

    // Bilingual content
    case "BilingualGroup":
      return { type: "BilingualGroup", children };
    case "BilingualItemEn":
      return { type: "BilingualItemEn", children };
    case "BilingualItemFr":
      return { type: "BilingualItemFr", children };

    // Special content
    case "QuotedText":
      return { type: "QuotedText", children };
    case "CenteredText":
      return { type: "CenteredText", children };
    case "FormGroup":
      return { type: "FormGroup", children };
    case "Oath":
      return { type: "Oath", children };
    case "ReadAsText":
      return { type: "ReadAsText", children };
    case "ScheduleFormHeading":
      return { type: "ScheduleFormHeading", children };
    case "Heading":
      return {
        type: "Heading",
        level: attrs["@_level"]
          ? Number.parseInt(attrs["@_level"] as string, 10)
          : undefined,
        children,
      };
    case "LeaderRightJustified":
      return { type: "LeaderRightJustified", children };

    // Amending and container elements
    case "SectionPiece":
      return { type: "SectionPiece", children };
    case "AmendedText":
      return { type: "AmendedText", children };
    case "AmendedContent":
      return { type: "AmendedContent", children };
    case "Reserved":
      return { type: "Reserved", children };
    case "Order":
      return { type: "Order", children };
    case "Recommendation":
      return { type: "Recommendation", children };
    case "Notice":
      return { type: "Notice", children };

    // Metadata elements (rendered separately in UI as expandable sections)
    case "MarginalNote":
      return { type: "MarginalNote", children };
    case "HistoricalNote":
      return { type: "HistoricalNote", children };
    case "HistoricalNoteSubItem":
      return { type: "HistoricalNoteSubItem", children };
    case "Footnote":
      return {
        type: "Footnote",
        id: attrs["@_id"] as string | undefined,
        placement: attrs["@_placement"] as string | undefined,
        children,
      };

    default:
      // For unhandled elements, preserve with Unknown type (even if no children)
      return { type: "Unknown", tag, children };
  }
}

/**
 * Extract relevant table attributes.
 */
function extractTableAttrs(
  attrs: Record<string, unknown>
): Record<string, string> {
  const result: Record<string, string> = {};
  if (attrs["@_frame"]) {
    result.frame = String(attrs["@_frame"]);
  }
  if (attrs["@_pgwide"]) {
    result.pgwide = String(attrs["@_pgwide"]);
  }
  if (attrs["@_tabstyle"]) {
    result.tabstyle = String(attrs["@_tabstyle"]);
  }
  return result;
}

/**
 * Extract relevant entry (table cell) attributes.
 */
function extractEntryAttrs(
  attrs: Record<string, unknown>
): Record<string, string> {
  const result: Record<string, string> = {};
  if (attrs["@_colname"]) {
    result.colname = String(attrs["@_colname"]);
  }
  if (attrs["@_namest"]) {
    result.namest = String(attrs["@_namest"]);
  }
  if (attrs["@_nameend"]) {
    result.nameend = String(attrs["@_nameend"]);
  }
  if (attrs["@_morerows"]) {
    result.morerows = String(attrs["@_morerows"]);
  }
  if (attrs["@_align"]) {
    result.align = String(attrs["@_align"]);
  }
  if (attrs["@_valign"]) {
    result.valign = String(attrs["@_valign"]);
  }
  return result;
}

// =============================================================================
// DEFINITION TEXT EXTRACTION
// =============================================================================

/**
 * Result from definition text extraction.
 */
export type DefinitionText = {
  /** Document position for position-based joining */
  definitionOrder: number;
  /** Full definition text with proper document order */
  definitionText: string;
};

/**
 * Extract definition text for all Definition elements from pre-parsed XML data.
 * Uses preserveOrder=true to maintain correct text order in mixed content.
 *
 * Returns definitions with their position for joining with database records.
 *
 * @param parsed - Pre-parsed XML data from parseFileWithPreservedOrder()
 */
export function extractDefinitionTexts(
  parsed: PreservedOrderData
): DefinitionText[] {
  const results: DefinitionText[] = [];
  const counter = { definitionOrder: 0 };
  walkForDefinitions(parsed, results, counter);

  return results;
}

/**
 * Walk preserved-order structure to find Definition elements and extract text.
 */
function walkForDefinitions(
  items: unknown[],
  results: DefinitionText[],
  counter: { definitionOrder: number }
): void {
  if (!Array.isArray(items)) {
    return;
  }

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const children = Array.isArray(value) ? value : [];

    if (tag === "Definition") {
      counter.definitionOrder++;
      // Extract text from all children, preserving order
      const definitionText = extractTextFromPreserved(children)
        .replace(/\s+/g, " ")
        .trim();

      if (definitionText) {
        results.push({
          definitionOrder: counter.definitionOrder,
          definitionText,
        });
      }
      // Don't recurse into Definition - its content is already captured
      continue;
    }

    // Recurse into container elements
    if (children.length > 0) {
      walkForDefinitions(children, results, counter);
    }
  }
}

// =============================================================================
// SECTION CONTENT EXTRACTION
// =============================================================================

/**
 * Result from section content extraction.
 */
export type SectionContent = {
  /** Document position for position-based joining */
  sectionOrder: number;
  /** Full section content as plain text with proper document order */
  content: string;
  /** Marginal note (side heading) with proper document order */
  marginalNote?: string;
};

/**
 * Extract plain text content for all Section elements from pre-parsed XML data.
 * Uses preserveOrder=true to maintain correct text order in mixed content.
 *
 * Returns sections with their position for joining with database records.
 *
 * @param parsed - Pre-parsed XML data from parseFileWithPreservedOrder()
 */
export function extractSectionContents(
  parsed: PreservedOrderData
): SectionContent[] {
  const results: SectionContent[] = [];
  const counter = { sectionOrder: 0 };
  walkForSectionContent(parsed, results, counter);

  return results;
}

/**
 * Walk preserved-order structure to find Section/Provision elements and extract text.
 */
function walkForSectionContent(
  items: unknown[],
  results: SectionContent[],
  counter: { sectionOrder: number }
): void {
  if (!Array.isArray(items)) {
    return;
  }

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const children = Array.isArray(value) ? value : [];

    // Handle Section elements (acts)
    if (tag === "Section") {
      counter.sectionOrder++;
      // Extract text from all children, preserving order
      const content = extractTextFromPreserved(children)
        .replace(/\s+/g, " ")
        .trim();

      if (content) {
        results.push({ sectionOrder: counter.sectionOrder, content });
      }
      // Don't recurse into Section - its content is already captured
      continue;
    }

    // Handle Provision elements (regulations)
    if (tag === "Provision") {
      counter.sectionOrder++;
      const content = extractTextFromPreserved(children)
        .replace(/\s+/g, " ")
        .trim();

      if (content) {
        results.push({ sectionOrder: counter.sectionOrder, content });
      }
      continue;
    }

    // Handle Enacts element (enacting clause) - uses sectionOrder 0
    if (tag === "Enacts") {
      const content = extractTextFromPreserved(children)
        .replace(/\s+/g, " ")
        .trim();

      if (content) {
        results.push({ sectionOrder: 0, content });
      }
      continue;
    }

    // Handle Schedule elements - extract Item content
    if (tag === "Schedule") {
      walkScheduleForContent(children, results, counter);
      continue;
    }

    // Recurse into container elements
    if (children.length > 0) {
      walkForSectionContent(children, results, counter);
    }
  }
}

/**
 * Walk Schedule children to extract content from Items, FormGroups, TableGroups, etc.
 */
function walkScheduleForContent(
  children: unknown[],
  results: SectionContent[],
  counter: { sectionOrder: number }
): void {
  for (const child of children) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const tagChildren = Array.isArray(value) ? value : [];

    if (tag === "Item") {
      counter.sectionOrder++;
      const content = extractTextFromPreserved(tagChildren)
        .replace(/\s+/g, " ")
        .trim();

      if (content) {
        results.push({ sectionOrder: counter.sectionOrder, content });
      }
      // Process nested items
      walkScheduleForContent(tagChildren, results, counter);
    } else if (tag === "FormGroup" || tag === "TableGroup") {
      counter.sectionOrder++;
      const content = extractTextFromPreserved(tagChildren)
        .replace(/\s+/g, " ")
        .trim();

      if (content) {
        results.push({ sectionOrder: counter.sectionOrder, content });
      }
    } else if (tag === "Provision") {
      // DocumentInternal provisions
      counter.sectionOrder++;
      const content = extractTextFromPreserved(tagChildren)
        .replace(/\s+/g, " ")
        .trim();

      if (content) {
        results.push({ sectionOrder: counter.sectionOrder, content });
      }
    } else if (tagChildren.length > 0) {
      // Recurse into containers (List, DocumentInternal, Group, etc.)
      walkScheduleForContent(tagChildren, results, counter);
    }
  }
}

// =============================================================================
// PREAMBLE TEXT EXTRACTION
// =============================================================================

/**
 * Preamble provision with corrected text order.
 */
export type PreambleProvisionText = {
  /** Full provision text with proper document order */
  text: string;
  /** Marginal note (plain text, not affected by order issues) */
  marginalNote?: string;
};

/**
 * Extract preamble provisions with correct text order from pre-parsed XML data.
 * Uses preserveOrder=true to maintain correct text order in mixed content.
 *
 * Returns preamble provisions for the document, or undefined if no preamble.
 *
 * @param parsed - Pre-parsed XML data from parseFileWithPreservedOrder()
 */
export function extractPreamble(
  parsed: PreservedOrderData
): PreambleProvisionText[] | undefined {
  const results: PreambleProvisionText[] = [];
  walkForPreamble(parsed, results);

  return results.length > 0 ? results : undefined;
}

/**
 * Walk preserved-order structure to find Preamble and extract provision text.
 */
function walkForPreamble(
  items: unknown[],
  results: PreambleProvisionText[]
): void {
  if (!Array.isArray(items)) {
    return;
  }

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const children = Array.isArray(value) ? value : [];

    if (tag === "Preamble") {
      // Found the Preamble element - extract its Provision children
      extractPreambleProvisions(children, results);
      return; // Only one preamble per document
    }

    // Recurse into container elements (Statute, Introduction, etc.)
    if (children.length > 0) {
      walkForPreamble(children, results);
    }
  }
}

/**
 * Extract text from Provision elements within a Preamble.
 */
function extractPreambleProvisions(
  children: unknown[],
  results: PreambleProvisionText[]
): void {
  for (const child of children) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const tagChildren = Array.isArray(value) ? value : [];

    if (tag === "Provision") {
      // Extract text from this provision, excluding MarginalNote
      let marginalNote: string | undefined;
      const textParts: string[] = [];

      for (const provChild of tagChildren) {
        if (!provChild || typeof provChild !== "object") {
          continue;
        }
        const provObj = provChild as Record<string, unknown>;
        const provKeys = Object.keys(provObj).filter((k) => k !== ":@");
        if (provKeys.length === 0) {
          continue;
        }

        const provTag = provKeys[0];
        const provValue = provObj[provTag];
        const provChildren = Array.isArray(provValue) ? provValue : [];

        if (provTag === "MarginalNote") {
          // Extract marginal note text (plain text, order doesn't matter)
          marginalNote = extractTextFromPreserved(provChildren)
            .replace(/\s+/g, " ")
            .trim();
        } else if (provTag === "Text") {
          // Extract text content with preserved order
          const text = extractTextFromPreserved(provChildren)
            .replace(/\s+/g, " ")
            .trim();
          if (text) {
            textParts.push(text);
          }
        }
      }

      const fullText = textParts.join(" ").trim();
      if (fullText) {
        results.push({
          text: fullText,
          marginalNote: marginalNote || undefined,
        });
      }
    }
  }
}

// =============================================================================
// TREATY TEXT EXTRACTION
// =============================================================================

/**
 * Treaty definition with corrected text order.
 */
export type TreatyDefinitionText = {
  term: string;
  definition: string;
};

/**
 * Treaty content with corrected text order.
 * Matches the TreatyContent type from schema but with corrected text.
 */
export type TreatyContentText = {
  title?: string;
  text: string;
  definitions?: TreatyDefinitionText[];
};

/**
 * Extract treaty content with correct text order from pre-parsed XML data.
 * Uses preserveOrder=true to maintain correct text order in mixed content.
 *
 * Returns treaty content array for the document, or undefined if no treaties.
 *
 * @param parsed - Pre-parsed XML data from parseFileWithPreservedOrder()
 */
export function extractTreaties(
  parsed: PreservedOrderData
): TreatyContentText[] | undefined {
  const results: TreatyContentText[] = [];
  walkForTreaties(parsed, results);

  return results.length > 0 ? results : undefined;
}

/**
 * Walk preserved-order structure to find Treaty/Convention elements.
 */
function walkForTreaties(items: unknown[], results: TreatyContentText[]): void {
  if (!Array.isArray(items)) {
    return;
  }

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const children = Array.isArray(value) ? value : [];

    // Treaties can be nested in Schedule elements
    if (tag === "Schedule") {
      walkForTreaties(children, results);
      continue;
    }

    // Look for treaty-like content (multiple tag names used in legislation XML)
    if (
      tag === "TreatyAgreement" ||
      tag === "Convention" ||
      tag === "Agreement" ||
      tag === "ConventionAgreementTreaty"
    ) {
      const treaty = extractTreatyContent(children);
      if (treaty) {
        results.push(treaty);
      }
      continue;
    }

    // Recurse into container elements
    if (children.length > 0) {
      walkForTreaties(children, results);
    }
  }
}

/**
 * Extract content from a treaty/convention element.
 */
function extractTreatyContent(children: unknown[]): TreatyContentText | null {
  let title: string | undefined;
  const textParts: string[] = [];
  const definitions: TreatyDefinitionText[] = [];

  for (const child of children) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const tagChildren = Array.isArray(value) ? value : [];

    if (tag === "Heading") {
      // Extract title from first heading
      if (!title) {
        title = extractTextFromPreserved(tagChildren)
          .replace(/\s+/g, " ")
          .trim();
      }
    } else if (tag === "Definition") {
      // Extract definition with preserved order
      const def = extractTreatyDefinition(tagChildren);
      if (def) {
        definitions.push(def);
      }
    } else if (tag === "Text" || tag === "Provision" || tag === "Article") {
      // Extract text content
      const text = extractTextFromPreserved(tagChildren)
        .replace(/\s+/g, " ")
        .trim();
      if (text) {
        textParts.push(text);
      }
    } else if (tagChildren.length > 0) {
      // Recurse to find nested content
      const nested = extractTreatyContent(tagChildren);
      if (nested) {
        if (!title && nested.title) {
          title = nested.title;
        }
        if (nested.text) {
          textParts.push(nested.text);
        }
        if (nested.definitions) {
          definitions.push(...nested.definitions);
        }
      }
    }
  }

  const fullText = textParts.join(" ").trim();
  if (!fullText && definitions.length === 0) {
    return null;
  }

  return {
    title,
    text: fullText,
    definitions: definitions.length > 0 ? definitions : undefined,
  };
}

/**
 * Extract a single treaty definition.
 */
function extractTreatyDefinition(
  children: unknown[]
): TreatyDefinitionText | null {
  let term = "";
  let definition = "";

  for (const child of children) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const obj = child as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const tag = keys[0];
    const value = obj[tag];
    const tagChildren = Array.isArray(value) ? value : [];

    if (tag === "Text") {
      // Look for DefinedTermEn/Fr within Text
      for (const textChild of tagChildren) {
        if (!textChild || typeof textChild !== "object") {
          continue;
        }
        const textObj = textChild as Record<string, unknown>;
        const textKeys = Object.keys(textObj).filter((k) => k !== ":@");
        if (textKeys.length === 0) {
          continue;
        }

        const textTag = textKeys[0];
        const textValue = textObj[textTag];
        const textTagChildren = Array.isArray(textValue) ? textValue : [];

        if (textTag === "DefinedTermEn" || textTag === "DefinedTermFr") {
          term = extractTextFromPreserved(textTagChildren)
            .replace(/\s+/g, " ")
            .trim();
        }
      }

      // Full definition text
      definition = extractTextFromPreserved(tagChildren)
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  if (!term || !definition) {
    return null;
  }

  return { term, definition };
}
