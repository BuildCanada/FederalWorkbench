import type {
  ContentFlags,
  FormattingAttributes,
  InlineFormattingFlags,
  LeaderType,
  ProvisionHeadingInfo,
  TableAttributes,
  TableHeaderInfo,
} from "../types";
import { extractLimsMetadata } from "./metadata";
import { extractTextContent } from "./text";

/**
 * Recursively check if an element contains a specific tag name
 */
function hasElement(el: Record<string, unknown>, tagName: string): boolean {
  const search = (obj: unknown): boolean => {
    if (!obj || typeof obj !== "object") {
      return false;
    }
    const o = obj as Record<string, unknown>;

    if (o[tagName]) {
      return true;
    }

    for (const value of Object.values(o)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (search(item)) {
            return true;
          }
        }
      } else if (search(value)) {
        return true;
      }
    }
    return false;
  };

  return search(el);
}

/**
 * Extract image source URLs from an element
 */
function extractImageSources(el: Record<string, unknown>): string[] {
  const sources: string[] = [];

  const findImages = (obj: unknown) => {
    if (!obj || typeof obj !== "object") {
      return;
    }
    const o = obj as Record<string, unknown>;

    // Check for Image element with source attribute
    if (o.Image) {
      const images = Array.isArray(o.Image) ? o.Image : [o.Image];
      for (const img of images) {
        if (img && typeof img === "object") {
          const source = (img as Record<string, unknown>)["@_source"] as string;
          if (source) {
            sources.push(source);
          }
        }
      }
    }

    // Recurse into child elements
    for (const value of Object.values(o)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          findImages(item);
        }
      } else {
        findImages(value);
      }
    }
  };

  findImages(el);
  return sources;
}

/**
 * Detect editorial or unofficial notes in an element
 * Returns true if element contains <Note status="editorial"> or <Note status="unofficial">
 */
function hasEditorialNote(el: Record<string, unknown>): boolean {
  const findEditorialNote = (obj: unknown): boolean => {
    if (!obj || typeof obj !== "object") {
      return false;
    }
    const o = obj as Record<string, unknown>;

    if (o.Note) {
      const notes = Array.isArray(o.Note) ? o.Note : [o.Note];
      for (const note of notes) {
        if (note && typeof note === "object") {
          const status = (note as Record<string, unknown>)[
            "@_status"
          ] as string;
          if (status === "editorial" || status === "unofficial") {
            return true;
          }
        }
      }
    }

    for (const value of Object.values(o)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (findEditorialNote(item)) {
            return true;
          }
        }
      } else if (findEditorialNote(value)) {
        return true;
      }
    }
    return false;
  };

  return findEditorialNote(el);
}

/**
 * Extract alternate text content from an element
 * AlternateText provides accessibility descriptions for images/tables
 */
export function extractAlternateTextContent(
  el: Record<string, unknown>
): string[] {
  const altTexts: string[] = [];

  const findAlternateText = (obj: unknown) => {
    if (!obj || typeof obj !== "object") {
      return;
    }
    const o = obj as Record<string, unknown>;

    if (o.AlternateText) {
      const altText = extractTextContent(o.AlternateText);
      if (altText) {
        altTexts.push(altText);
      }
    }

    // Recurse into child elements
    for (const [key, value] of Object.entries(o)) {
      if (key.startsWith("@_") || key === "#text" || key === "AlternateText") {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          findAlternateText(item);
        }
      } else {
        findAlternateText(value);
      }
    }
  };

  findAlternateText(el);
  return altTexts;
}

/**
 * Extract inline formatting flags from an element
 * Lower Priority (Presentation/formatting)
 */
export function extractInlineFormattingFlags(
  el: Record<string, unknown>
): InlineFormattingFlags | undefined {
  const flags: InlineFormattingFlags = {};

  // Detect Leader elements
  if (hasElement(el, "Leader")) {
    flags.hasLeader = true;
    // Extract leader types
    const leaderTypes: LeaderType[] = [];
    const findLeaders = (obj: unknown) => {
      if (!obj || typeof obj !== "object") {
        return;
      }
      const o = obj as Record<string, unknown>;
      if (o.Leader) {
        const leaders = Array.isArray(o.Leader) ? o.Leader : [o.Leader];
        for (const leader of leaders) {
          if (leader && typeof leader === "object") {
            const style = (leader as Record<string, unknown>)[
              "@_style"
            ] as string;
            if (
              style &&
              ["solid", "dot", "dash"].includes(style) &&
              !leaderTypes.includes(style as LeaderType)
            ) {
              leaderTypes.push(style as LeaderType);
            }
          }
        }
      }
      for (const value of Object.values(o)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            findLeaders(item);
          }
        } else {
          findLeaders(value);
        }
      }
    };
    findLeaders(el);
    if (leaderTypes.length > 0) {
      flags.leaderTypes = leaderTypes;
    }
  }

  // Detect other inline elements
  if (hasElement(el, "LeaderRightJustified")) {
    flags.hasLeaderRightJustified = true;
  }
  if (hasElement(el, "LineBreak")) {
    flags.hasLineBreak = true;
  }
  if (hasElement(el, "PageBreak")) {
    flags.hasPageBreak = true;
  }
  if (hasElement(el, "Separator")) {
    flags.hasSeparator = true;
  }
  if (hasElement(el, "Fraction")) {
    flags.hasFraction = true;
  }
  if (hasElement(el, "Ins")) {
    flags.hasIns = true;
  }
  if (hasElement(el, "Del")) {
    flags.hasDel = true;
  }

  // Detect FormBlank and extract widths
  if (hasElement(el, "FormBlank")) {
    flags.hasFormBlank = true;
    const widths: string[] = [];
    const findFormBlanks = (obj: unknown) => {
      if (!obj || typeof obj !== "object") {
        return;
      }
      const o = obj as Record<string, unknown>;
      if (o.FormBlank) {
        const blanks = Array.isArray(o.FormBlank) ? o.FormBlank : [o.FormBlank];
        for (const blank of blanks) {
          if (blank && typeof blank === "object") {
            const width = (blank as Record<string, unknown>)[
              "@_width"
            ] as string;
            if (width) {
              widths.push(width);
            }
          }
        }
      }
      for (const value of Object.values(o)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            findFormBlanks(item);
          }
        } else {
          findFormBlanks(value);
        }
      }
    };
    findFormBlanks(el);
    if (widths.length > 0) {
      flags.formBlankWidths = widths;
    }
  }

  return Object.keys(flags).length > 0 ? flags : undefined;
}

/**
 * Extract CALS table attributes from an element
 * Lower Priority (Presentation/formatting)
 */
export function extractTableAttributes(
  el: Record<string, unknown>
): TableAttributes | undefined {
  const attrs: TableAttributes = {};

  const findTableAttrs = (obj: unknown) => {
    if (!obj || typeof obj !== "object") {
      return;
    }
    const o = obj as Record<string, unknown>;

    // Check for table or TableGroup element
    if (o.table || o.TableGroup) {
      const table = (o.table || o.TableGroup) as Record<string, unknown>;

      if (table["@_tabstyle"]) {
        attrs.tabStyle = String(table["@_tabstyle"]);
      }
      if (table["@_frame"]) {
        const frame = String(table["@_frame"]).toLowerCase();
        if (
          ["all", "bottom", "none", "sides", "top", "topbot"].includes(frame)
        ) {
          attrs.frame = frame as
            | "all"
            | "bottom"
            | "none"
            | "sides"
            | "top"
            | "topbot";
        }
      }
      if (table["@_pgwide"]) {
        attrs.pgWide = table["@_pgwide"] === "1" || table["@_pgwide"] === "yes";
      }
      if (table["@_orientation"]) {
        const orient = String(table["@_orientation"]).toLowerCase();
        if (orient === "portrait" || orient === "landscape") {
          attrs.orientation = orient;
        }
      }
      if (table["@_rowbreak"]) {
        attrs.rowBreak = String(table["@_rowbreak"]);
      }

      // Check tgroup for keep-together
      if (table.tgroup) {
        const tgroups = Array.isArray(table.tgroup)
          ? table.tgroup
          : [table.tgroup];
        for (const tg of tgroups) {
          if (tg && typeof tg === "object") {
            const tgObj = tg as Record<string, unknown>;
            if (tgObj["@_keep-together"]) {
              attrs.keepTogether = tgObj["@_keep-together"] === "yes";
            }
          }
        }
      }
    }
  };

  findTableAttrs(el);
  return Object.keys(attrs).length > 0 ? attrs : undefined;
}

/**
 * Extract table header information for accessibility
 * Lower Priority (Presentation/formatting)
 */
export function extractTableHeaderInfo(
  el: Record<string, unknown>
): TableHeaderInfo[] | undefined {
  const headers: TableHeaderInfo[] = [];

  const findHeaderInfo = (obj: unknown) => {
    if (!obj || typeof obj !== "object") {
      return;
    }
    const o = obj as Record<string, unknown>;

    // Check for entry elements with header attributes
    if (o.entry) {
      const entries = Array.isArray(o.entry) ? o.entry : [o.entry];
      for (const entry of entries) {
        if (entry && typeof entry === "object") {
          const entryObj = entry as Record<string, unknown>;
          const info: TableHeaderInfo = {};

          if (entryObj["@_rowheader"]) {
            info.rowHeader = entryObj["@_rowheader"] === "yes";
          }
          if (entryObj["@_th-id"]) {
            info.thId = String(entryObj["@_th-id"]);
          }
          if (entryObj["@_th-headers"]) {
            info.thHeaders = String(entryObj["@_th-headers"]);
          }

          if (Object.keys(info).length > 0) {
            headers.push(info);
          }
        }
      }
    }

    // Recurse
    for (const [key, value] of Object.entries(o)) {
      if (key.startsWith("@_") || key === "#text") {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          findHeaderInfo(item);
        }
      } else {
        findHeaderInfo(value);
      }
    }
  };

  findHeaderInfo(el);
  return headers.length > 0 ? headers : undefined;
}

/**
 * Extract formatting attributes from an element
 * Lower Priority (Presentation/formatting)
 */
export function extractFormattingAttributes(
  el: Record<string, unknown>
): FormattingAttributes | undefined {
  const attrs: FormattingAttributes = {};

  // Indent attributes
  if (el["@_indent-level"] !== undefined) {
    const level = Number.parseInt(String(el["@_indent-level"]), 10);
    if (!Number.isNaN(level)) {
      attrs.indentLevel = level;
    }
  }
  if (el["@_first-line-indent"]) {
    attrs.firstLineIndent = String(el["@_first-line-indent"]);
  }
  if (el["@_subsequent-line-indent"]) {
    attrs.subsequentLineIndent = String(el["@_subsequent-line-indent"]);
  }

  // Text formatting
  if (el["@_justification"]) {
    const just = String(el["@_justification"]).toLowerCase();
    if (["left", "right", "center", "justified"].includes(just)) {
      attrs.justification = just as "left" | "right" | "center" | "justified";
    }
  }
  if (el["@_hyphenation"]) {
    attrs.hyphenation = el["@_hyphenation"] === "yes";
  }
  if (el["@_pointsize"] !== undefined) {
    const size = Number.parseInt(String(el["@_pointsize"]), 10);
    if (!Number.isNaN(size)) {
      attrs.pointSize = size;
    }
  }

  // Keep-together attributes
  if (el["@_keep-with-next"]) {
    attrs.keepWithNext = el["@_keep-with-next"] === "yes";
  }
  if (el["@_keep-with-previous"]) {
    attrs.keepWithPrevious = el["@_keep-with-previous"] === "yes";
  }

  // Margins
  if (el["@_topmarginspacing"]) {
    attrs.topMarginSpacing = String(el["@_topmarginspacing"]);
  }
  if (el["@_bottommarginspacing"]) {
    attrs.bottomMarginSpacing = String(el["@_bottommarginspacing"]);
  }

  // Other
  if (el["@_format-ref"]) {
    attrs.formatRef = String(el["@_format-ref"]);
  }
  if (el["@_list-item"]) {
    attrs.listItem = el["@_list-item"] === "yes";
  }
  if (el["@_language-align"]) {
    attrs.languageAlign = el["@_language-align"] === "yes";
  }
  if (el["@_font-style"]) {
    attrs.fontStyle = String(el["@_font-style"]);
  }

  return Object.keys(attrs).length > 0 ? attrs : undefined;
}

/**
 * Extract ProvisionHeading from a Provision element
 * ProvisionHeading contains subsection/topic titles in schedules/forms (e.g., treaty articles)
 * Per DTD, ProvisionHeading has a required format-ref attribute and contains inline content
 */
export function extractProvisionHeading(
  provEl: Record<string, unknown>
): ProvisionHeadingInfo | undefined {
  if (!provEl.ProvisionHeading) {
    return;
  }

  const phEl = provEl.ProvisionHeading as Record<string, unknown>;
  const text = extractTextContent(phEl);

  if (!text || text.trim().length === 0) {
    return;
  }

  const info: ProvisionHeadingInfo = {
    text: text.trim(),
  };

  // Extract format-ref attribute (required per DTD)
  if (phEl["@_format-ref"]) {
    info.formatRef = String(phEl["@_format-ref"]);
  }

  // Extract LIMS metadata if present
  const limsMetadata = extractLimsMetadata(phEl);
  if (limsMetadata && Object.keys(limsMetadata).length > 0) {
    info.limsMetadata = limsMetadata;
  }

  return info;
}

/**
 * Extract content flags from a section element
 */
export function extractContentFlags(
  sectionEl: Record<string, unknown>
): ContentFlags | undefined {
  const flags: ContentFlags = {};

  // Detect tables
  if (hasElement(sectionEl, "TableGroup")) {
    flags.hasTable = true;
  }

  // Detect formulas (FormulaGroup or MathML)
  if (
    hasElement(sectionEl, "FormulaGroup") ||
    hasElement(sectionEl, "MathML")
  ) {
    flags.hasFormula = true;
  }

  // Detect images and extract source URLs
  const imageSources = extractImageSources(sectionEl);
  if (imageSources.length > 0) {
    flags.hasImage = true;
    flags.imageSources = imageSources;
  }

  // Detect partial repeals (nested Repealed elements)
  if (hasElement(sectionEl, "Repealed")) {
    flags.hasRepealed = true;
  }

  // Detect editorial/unofficial notes
  if (hasEditorialNote(sectionEl)) {
    flags.hasEditorialNote = true;
  }

  // Detect reserved placeholder sections
  if (hasElement(sectionEl, "Reserved")) {
    flags.hasReserved = true;
  }

  // Detect explanatory notes (not part of authoritative text)
  if (hasElement(sectionEl, "ExplanatoryNote")) {
    flags.hasExplanatoryNote = true;
  }

  // Medium Priority: Content completeness flags
  // Detect signature blocks (official signatures)
  if (hasElement(sectionEl, "SignatureBlock")) {
    flags.hasSignatureBlock = true;
  }

  // Detect bilingual groups (paired EN/FR content)
  if (hasElement(sectionEl, "BilingualGroup")) {
    flags.hasBilingualGroup = true;
  }

  // Detect quoted text (quoted legislative text)
  if (hasElement(sectionEl, "QuotedText")) {
    flags.hasQuotedText = true;
  }

  // Detect read-as text (amendment provisions)
  if (hasElement(sectionEl, "ReadAsText")) {
    flags.hasReadAsText = true;
  }

  // Detect amended text (text being amended)
  if (hasElement(sectionEl, "AmendedText")) {
    flags.hasAmendedText = true;
  }

  // Detect alternate text (accessibility text for images/tables)
  if (hasElement(sectionEl, "AlternateText")) {
    flags.hasAlternateText = true;
    // Extract the actual alternate text content for accessibility
    const altTexts = extractAlternateTextContent(sectionEl);
    if (altTexts.length > 0) {
      flags.alternateTextContent = altTexts;
    }
  }

  // Lower Priority: Presentation/formatting flags
  // Detect form groups
  if (hasElement(sectionEl, "FormGroup")) {
    flags.hasFormGroup = true;
  }

  // Detect oaths
  if (hasElement(sectionEl, "Oath")) {
    flags.hasOath = true;
  }

  // Detect captions for tables/images
  if (hasElement(sectionEl, "Caption")) {
    flags.hasCaption = true;
  }

  // Extract inline formatting flags
  const inlineFormatting = extractInlineFormattingFlags(sectionEl);
  if (inlineFormatting) {
    flags.inlineFormatting = inlineFormatting;
  }

  // Extract table attributes if table present
  if (flags.hasTable) {
    const tableAttrs = extractTableAttributes(sectionEl);
    if (tableAttrs) {
      flags.tableAttributes = tableAttrs;
    }

    // Extract table header info for accessibility
    const headerInfo = extractTableHeaderInfo(sectionEl);
    if (headerInfo) {
      flags.tableHeaderInfo = headerInfo;
    }
  }

  // Only return if any flags were set
  return Object.keys(flags).length > 0 ? flags : undefined;
}
