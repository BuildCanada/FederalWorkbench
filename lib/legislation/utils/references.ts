import type { InternalReference, ParsedCrossReference } from "../types";
import { extractTextContent } from "./text";

/**
 * Extract cross references from an element
 * Only captures references to other legislation (acts and regulations)
 */
export function extractCrossReferences(
  el: Record<string, unknown>,
  sourceActId?: string,
  sourceRegulationId?: string,
  sourceSectionLabel?: string
): ParsedCrossReference[] {
  const refs: ParsedCrossReference[] = [];

  const processElement = (obj: unknown) => {
    if (!obj || typeof obj !== "object") {
      return;
    }
    const o = obj as Record<string, unknown>;

    // Check for XRefExternal
    if (o.XRefExternal) {
      const xrefs = Array.isArray(o.XRefExternal)
        ? o.XRefExternal
        : [o.XRefExternal];
      for (const xref of xrefs) {
        if (!xref || typeof xref !== "object") {
          continue;
        }
        const xrefObj = xref as Record<string, unknown>;
        const refType = xrefObj["@_reference-type"];
        const link = xrefObj["@_link"];
        const text = extractTextContent(xrefObj);

        if (link && (refType === "act" || refType === "regulation")) {
          refs.push({
            sourceActId,
            sourceRegulationId,
            sourceSectionLabel,
            targetType: refType as "act" | "regulation",
            targetRef: String(link),
            referenceText: text || undefined,
          });
        }
      }
    }

    // Recursively check child elements
    for (const [key, value] of Object.entries(o)) {
      if (key.startsWith("@_") || key === "#text") {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          processElement(item);
        }
      } else {
        processElement(value);
      }
    }
  };

  processElement(el);
  return refs;
}

/**
 * Extract internal references (XRefInternal) from an element
 * Captures intra-document links so they can be preserved in storage
 */
export function extractInternalReferences(
  el: Record<string, unknown>
): InternalReference[] {
  const refs: InternalReference[] = [];

  const processElement = (obj: unknown) => {
    if (!obj || typeof obj !== "object") {
      return;
    }
    const o = obj as Record<string, unknown>;

    if (o.XRefInternal) {
      const xrefs = Array.isArray(o.XRefInternal)
        ? o.XRefInternal
        : [o.XRefInternal];

      for (const xref of xrefs) {
        if (!xref) {
          continue;
        }

        const xrefObj =
          typeof xref === "object"
            ? (xref as Record<string, unknown>)
            : undefined;
        const targetId =
          (xrefObj?.["@_id"] as string | undefined) ||
          (xrefObj?.["@_idref"] as string | undefined) ||
          (xrefObj?.["@_link"] as string | undefined) ||
          (xrefObj?.["@_target"] as string | undefined);

        const targetLabel = extractTextContent(xrefObj ?? xref).trim();
        const referenceText =
          targetLabel ||
          targetId ||
          (typeof xref === "string" ? xref.trim() : undefined);

        if (targetLabel || targetId) {
          refs.push({
            targetLabel: targetLabel || targetId || "",
            targetId: targetId || undefined,
            referenceText,
          });
        }
      }
    }

    for (const [key, value] of Object.entries(o)) {
      if (key.startsWith("@_") || key === "#text" || key === "XRefInternal") {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          processElement(item);
        }
      } else {
        processElement(value);
      }
    }
  };

  processElement(el);
  return refs;
}
