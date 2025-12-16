/**
 * Text extraction helpers for legislation XML content.
 */

import { XMLBuilder, XMLParser } from "fast-xml-parser";

/**
 * Parser for text extraction with preserveOrder=true.
 * This preserves document order for mixed content (text interspersed with elements).
 */
const textPreserveOrderParser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  trimValues: false,
});

/**
 * Builder to serialize parsed objects back to XML.
 * Used to convert objects parsed with preserveOrder=false back to XML
 * so we can re-parse with preserveOrder=true.
 */
const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  preserveOrder: false,
  suppressEmptyNode: false,
  format: false,
});

/**
 * Extract text content from a complex XML element.
 * Collects all text parts and joins them with spaces, then normalizes whitespace.
 *
 * For elements parsed with stopNodes (like DefinedTermEn/Fr), the value will be
 * a raw XML string which is handled by stripping tags.
 */
export function extractTextContent(el: unknown): string {
  if (typeof el === "string") {
    // Check if this is raw XML from stopNodes (contains < and >)
    // This happens for DefinedTermEn/Fr which are parsed with stopNodes
    if (el.includes("<") && el.includes(">")) {
      // Strip XML tags and normalize whitespace - preserves document order!
      return el
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    return el.trim();
  }
  if (typeof el === "number") {
    return String(el);
  }
  if (!el || typeof el !== "object") {
    return "";
  }

  const obj = el as Record<string, unknown>;
  const parts: string[] = [];

  // Process all entries in their natural order
  for (const [key, value] of Object.entries(obj)) {
    // Skip attributes
    if (key.startsWith("@_")) {
      continue;
    }

    // Handle direct text content
    if (key === "#text") {
      if (typeof value === "string" && value.trim()) {
        parts.push(value);
      }
      continue;
    }

    // Handle child elements
    if (Array.isArray(value)) {
      for (const v of value) {
        const childText = extractTextContent(v);
        if (childText) {
          parts.push(childText);
        }
      }
    } else {
      const childText = extractTextContent(value);
      if (childText) {
        parts.push(childText);
      }
    }
  }

  // Join with spaces and normalize whitespace (collapse multiple spaces)
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Extract plain text from preserved-order parsed structure.
 * Outputs plain text without any HTML tags.
 */
function extractTextFromPreserved(items: unknown): string {
  if (!items) {
    return "";
  }

  if (typeof items === "string") {
    return items;
  }

  if (typeof items === "number") {
    return String(items);
  }

  if (!Array.isArray(items)) {
    return "";
  }

  const parts: string[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const itemObj = item as Record<string, unknown>;

    // Get the element name (first key that's not ":@")
    const keys = Object.keys(itemObj).filter((k) => k !== ":@");
    if (keys.length === 0) {
      continue;
    }

    const key = keys[0];
    const value = itemObj[key];

    // Handle text nodes
    if (key === "#text") {
      if (typeof value === "string") {
        parts.push(value);
      }
      continue;
    }

    // Skip elements we don't want in plain text output
    if (key === "MarginalNote" || key === "HistoricalNote") {
      continue;
    }

    // Recursively extract text from child elements
    const children = Array.isArray(value) ? value : [];
    const childText = extractTextFromPreserved(children);
    if (childText) {
      parts.push(childText);
    }
  }

  // Join with spaces and normalize whitespace
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Extract plain text content from an XML element with preserved document order.
 *
 * Unlike extractTextContent which uses Object.entries() iteration (losing order),
 * this function re-parses with preserveOrder=true to correctly handle mixed content
 * (text interspersed with child elements like XRefExternal).
 *
 * Use this for definition text extraction where document order matters.
 */
export function extractTextContentPreserved(el: unknown): string {
  if (typeof el === "string") {
    // Check if this is raw XML from stopNodes (contains < and >)
    if (el.includes("<") && el.includes(">")) {
      // Strip XML tags and normalize whitespace - preserves document order!
      return el
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    return el.trim();
  }
  if (typeof el === "number") {
    return String(el);
  }
  if (!el || typeof el !== "object") {
    return "";
  }

  // Serialize the parsed object back to XML
  const xml = xmlBuilder.build({ root: el });

  // Re-parse with preserveOrder=true to get correct document order
  const preserved = textPreserveOrderParser.parse(xml);

  // Extract plain text from the preserved-order structure
  if (Array.isArray(preserved) && preserved.length > 0) {
    const rootObj = preserved[0] as Record<string, unknown>;
    if (rootObj.root && Array.isArray(rootObj.root)) {
      return extractTextFromPreserved(rootObj.root);
    }
  }

  return "";
}
