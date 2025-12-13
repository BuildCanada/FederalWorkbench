/**
 * Text extraction and HTML helpers for legislation XML content.
 */

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Serialize a MathML element back to XML string for browser rendering.
 * MathML elements should be passed through as-is since browsers can render them natively.
 */
function serializeMathML(el: unknown): string {
  if (!el || typeof el !== "object") {
    return "";
  }

  const obj = el as Record<string, unknown>;

  // Build the opening tag with namespace for proper browser support
  let html = '<math xmlns="http://www.w3.org/1998/Math/MathML"';

  // Add any attributes from the original element
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("@_") && typeof value === "string") {
      const attrName = key.slice(2); // Remove @_ prefix
      html += ` ${attrName}="${escapeHtml(value)}"`;
    }
  }
  html += ">";

  // Recursively serialize child elements
  html += serializeMathMLContent(obj);

  html += "</math>";
  return html;
}

/**
 * Recursively serialize MathML content elements.
 */
function serializeMathMLContent(el: unknown): string {
  if (typeof el === "string") {
    return escapeHtml(el);
  }
  if (typeof el === "number") {
    return String(el);
  }
  if (!el || typeof el !== "object") {
    return "";
  }

  const obj = el as Record<string, unknown>;
  let html = "";

  // Handle direct text content
  if (typeof obj["#text"] === "string") {
    html += escapeHtml(obj["#text"]);
  }

  // Process child elements
  for (const [key, value] of Object.entries(obj)) {
    // Skip attributes and direct text
    if (key.startsWith("@_") || key === "#text") {
      continue;
    }

    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      // Handle string values directly (e.g., <mn>1</mn> parsed as { mn: "1" })
      if (typeof item === "string") {
        html += `<${key}>${escapeHtml(item)}</${key}>`;
        continue;
      }
      if (typeof item === "number") {
        html += `<${key}>${item}</${key}>`;
        continue;
      }
      if (!item || typeof item !== "object") {
        continue;
      }

      const itemObj = item as Record<string, unknown>;

      // Build opening tag
      let tag = `<${key}`;
      for (const [attrKey, attrValue] of Object.entries(itemObj)) {
        if (attrKey.startsWith("@_") && typeof attrValue === "string") {
          const attrName = attrKey.slice(2);
          tag += ` ${attrName}="${escapeHtml(attrValue)}"`;
        }
      }
      tag += ">";

      // Add content
      tag += serializeMathMLContent(item);

      // Close tag
      tag += `</${key}>`;

      html += tag;
    }
  }

  return html;
}

/**
 * Extract content from a FormulaParagraph element, excluding the Label
 * to avoid duplication when Label is rendered separately.
 */
function extractFormulaParagraphContent(obj: Record<string, unknown>): string {
  let html = "";

  // Handle direct text content
  if (typeof obj["#text"] === "string") {
    html += escapeHtml(obj["#text"]);
  }

  // Process child elements, skipping Label
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("@_") || key === "#text" || key === "Label") {
      continue;
    }

    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      html += extractHtmlContent(item);
    }
  }

  return html;
}

/**
 * Normalize image source paths for proper resolution.
 * Justice Canada XML uses relative filenames like "2007c-25_ef001.jpg"
 * which need to be converted to resolvable paths.
 */
function normalizeImageSource(source: string): string {
  // If already a full URL or absolute path, return as-is
  if (
    source.startsWith("http://") ||
    source.startsWith("https://") ||
    source.startsWith("/")
  ) {
    return source;
  }

  // Convert relative filename to a path that can be resolved
  // The images are typically stored alongside the XML files or in an images directory
  // Using a relative path prefix that can be configured at render time
  return `/legislation/images/${source}`;
}

/**
 * Convert XML element to simple HTML (preserving structure)
 */
export function extractHtmlContent(el: unknown): string {
  if (typeof el === "string") {
    return escapeHtml(el);
  }
  if (typeof el === "number") {
    return String(el);
  }
  if (!el || typeof el !== "object") {
    return "";
  }

  const obj = el as Record<string, unknown>;
  let html = "";

  // Handle text content
  if (typeof obj["#text"] === "string") {
    html += escapeHtml(obj["#text"]);
  }

  // Process child elements with basic HTML mapping
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("@_") || key === "#text") {
      continue;
    }

    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      switch (key) {
        case "Emphasis": {
          const itemObj = item as Record<string, unknown>;
          const style = itemObj?.["@_style"] as string | undefined;
          if (style === "italic") {
            html += `<em>${extractHtmlContent(item)}</em>`;
          } else if (style === "smallcaps") {
            html += `<span class="smallcaps">${extractHtmlContent(item)}</span>`;
          } else {
            html += `<strong>${extractHtmlContent(item)}</strong>`;
          }
          break;
        }
        case "Sup":
          html += `<sup>${extractHtmlContent(item)}</sup>`;
          break;
        case "Language": {
          const itemObj = item as Record<string, unknown>;
          const lang = itemObj?.["@_xml:lang"] as string | undefined;
          html += `<span lang="${lang || ""}">${extractHtmlContent(item)}</span>`;
          break;
        }
        // Bilingual content elements - keep EN/FR separated
        case "BilingualGroup": {
          // Container for bilingual content - wrap in a div with class
          html += `<div class="bilingual-group">${extractHtmlContent(item)}</div>`;
          break;
        }
        case "BilingualItemEn": {
          // English content within bilingual group
          html += `<span lang="en" class="bilingual-en">${extractHtmlContent(item)}</span>`;
          break;
        }
        case "BilingualItemFr": {
          // French content within bilingual group
          html += `<span lang="fr" class="bilingual-fr">${extractHtmlContent(item)}</span>`;
          break;
        }
        case "XRefExternal":
        case "XRefInternal":
          html += `<a class="xref">${extractHtmlContent(item)}</a>`;
          break;
        case "DefinedTermEn":
        case "DefinedTermFr":
        case "DefinitionRef":
          html += `<dfn>${extractHtmlContent(item)}</dfn>`;
          break;
        case "FootnoteRef":
          html += `<sup class="footnote-ref">${extractHtmlContent(item)}</sup>`;
          break;
        case "Repealed":
          html += `<span class="repealed">${extractHtmlContent(item)}</span>`;
          break;
        // CALS Table elements
        case "TableGroup": {
          // TableGroup is a wrapper that may have attributes to pass to the table
          const tgObj = item as Record<string, unknown>;
          const tgAttrs: string[] = [];
          if (tgObj["@_bilingual"]) {
            tgAttrs.push(
              `data-bilingual="${escapeHtml(String(tgObj["@_bilingual"]))}"`
            );
          }
          if (tgAttrs.length > 0) {
            // Wrap in div with attributes if needed
            html += `<div class="table-group" ${tgAttrs.join(" ")}>${extractHtmlContent(item)}</div>`;
          } else {
            // Just process children directly
            html += extractHtmlContent(item);
          }
          break;
        }
        case "table": {
          const itemObj = item as Record<string, unknown>;
          const attrs: string[] = [];
          // Carry over CALS attributes
          if (itemObj["@_frame"]) {
            attrs.push(
              `data-frame="${escapeHtml(String(itemObj["@_frame"]))}"`
            );
          }
          if (itemObj["@_colsep"]) {
            attrs.push(
              `data-colsep="${escapeHtml(String(itemObj["@_colsep"]))}"`
            );
          }
          if (itemObj["@_rowsep"]) {
            attrs.push(
              `data-rowsep="${escapeHtml(String(itemObj["@_rowsep"]))}"`
            );
          }
          if (itemObj["@_bilingual"]) {
            attrs.push(
              `data-bilingual="${escapeHtml(String(itemObj["@_bilingual"]))}"`
            );
          }
          const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
          html += `<table${attrStr}>${extractHtmlContent(item)}</table>`;
          break;
        }
        case "tgroup": {
          // tgroup contains colspec, thead, tbody - process children directly
          html += extractHtmlContent(item);
          break;
        }
        case "colspec": {
          // colspec defines column widths - skip in HTML but could add data attributes if needed
          break;
        }
        case "thead": {
          const itemObj = item as Record<string, unknown>;
          const attrs: string[] = [];
          if (itemObj["@_valign"]) {
            attrs.push(
              `data-valign="${escapeHtml(String(itemObj["@_valign"]))}"`
            );
          }
          const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
          html += `<thead${attrStr}>${extractTableRows(item, true)}</thead>`;
          break;
        }
        case "tbody": {
          const itemObj = item as Record<string, unknown>;
          const attrs: string[] = [];
          if (itemObj["@_valign"]) {
            attrs.push(
              `data-valign="${escapeHtml(String(itemObj["@_valign"]))}"`
            );
          }
          const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
          html += `<tbody${attrStr}>${extractTableRows(item, false)}</tbody>`;
          break;
        }
        case "row": {
          html += extractTableRow(item, false);
          break;
        }
        case "entry": {
          html += extractTableCell(item, false);
          break;
        }
        // List elements
        case "List": {
          const listObj = item as Record<string, unknown>;
          const style =
            (listObj["@_style"] as string | undefined) || "unordered";
          // Map legislation list styles to HTML list types
          let listTag = "ul";
          let listAttr = "";
          switch (style) {
            case "arabic":
            case "decimal":
              listTag = "ol";
              listAttr = ' type="1"';
              break;
            case "lower-roman":
            case "roman":
              listTag = "ol";
              listAttr = ' type="i"';
              break;
            case "upper-roman":
              listTag = "ol";
              listAttr = ' type="I"';
              break;
            case "lower-alpha":
              listTag = "ol";
              listAttr = ' type="a"';
              break;
            case "upper-alpha":
              listTag = "ol";
              listAttr = ' type="A"';
              break;
            default:
              // unordered or unknown style → ul with no type
              break;
          }
          html += `<${listTag}${listAttr}>${extractListItems(item)}</${listTag}>`;
          break;
        }
        case "Item": {
          html += `<li>${extractHtmlContent(item)}</li>`;
          break;
        }
        // DocumentInternal elements - preserve internal document structure
        // These are containers for groups of articles in agreements, treaties, etc.
        case "DocumentInternal": {
          // Wrap in a section with class for styling/identification
          html += `<section class="document-internal">${extractHtmlContent(item)}</section>`;
          break;
        }
        // Group elements within DocumentInternal
        case "Group": {
          html += `<div class="group">${extractHtmlContent(item)}</div>`;
          break;
        }
        case "GroupHeading": {
          html += `<h4 class="group-heading">${extractHtmlContent(item)}</h4>`;
          break;
        }
        // Provision elements (text blocks within agreements)
        case "Provision": {
          html += `<p class="provision">${extractHtmlContent(item)}</p>`;
          break;
        }
        // SectionPiece - sub-section content
        case "SectionPiece": {
          html += `<div class="section-piece">${extractHtmlContent(item)}</div>`;
          break;
        }
        // Image elements - render as HTML figure/img elements
        case "ImageGroup": {
          const itemObj = item as Record<string, unknown>;
          const position = itemObj?.["@_position"] as string | undefined;
          const positionClass = position
            ? ` data-position="${escapeHtml(position)}"`
            : "";
          html += `<figure class="image-group"${positionClass}>${extractHtmlContent(item)}</figure>`;
          break;
        }
        case "Image": {
          const itemObj = item as Record<string, unknown>;
          const source = itemObj?.["@_source"] as string | undefined;
          if (source) {
            // Normalize the image source path for proper resolution
            const normalizedSource = normalizeImageSource(source);
            html += `<img src="${escapeHtml(normalizedSource)}" alt="" class="legislation-image" loading="lazy" />`;
          }
          break;
        }
        case "Caption": {
          html += `<figcaption class="image-caption">${extractHtmlContent(item)}</figcaption>`;
          break;
        }
        // Formula elements - wrap for readability and semantic HTML
        case "FormulaGroup": {
          html += `<div class="formula-group">${extractHtmlContent(item)}</div>`;
          break;
        }
        case "Formula": {
          html += `<div class="formula">${extractHtmlContent(item)}</div>`;
          break;
        }
        case "FormulaText": {
          html += `<code class="formula-text">${extractHtmlContent(item)}</code>`;
          break;
        }
        case "FormulaConnector": {
          // Usually "where" connecting formula to definitions
          html += `<p class="formula-connector">${extractHtmlContent(item)}</p>`;
          break;
        }
        case "FormulaDefinition": {
          html += `<div class="formula-definition">${extractHtmlContent(item)}</div>`;
          break;
        }
        case "FormulaTerm": {
          html += `<var class="formula-term">${extractHtmlContent(item)}</var>`;
          break;
        }
        case "FormulaParagraph": {
          const itemObj = item as Record<string, unknown>;
          const label = itemObj.Label
            ? `<span class="label">${extractHtmlContent(itemObj.Label)}</span>`
            : "";
          // Extract content excluding the Label to avoid duplication
          const paragraphContent = extractFormulaParagraphContent(itemObj);
          html += `<p class="formula-paragraph">${label}${paragraphContent}</p>`;
          break;
        }
        // MathML elements - preserve as-is for proper rendering
        // MathML can appear in three forms: <math>, <MathML>, or with mml: namespace prefix
        case "math":
        case "MathML": {
          html += serializeMathML(item);
          break;
        }
        // Handle subscript/superscript commonly used in formulas
        case "Sub": {
          html += `<sub>${extractHtmlContent(item)}</sub>`;
          break;
        }
        default:
          html += extractHtmlContent(item);
      }
    }
  }

  return html;
}

/**
 * Extract table rows from thead or tbody element
 */
function extractTableRows(el: unknown, isHeader: boolean): string {
  if (!el || typeof el !== "object") {
    return "";
  }
  const obj = el as Record<string, unknown>;
  let html = "";

  if (obj.row) {
    const rows = Array.isArray(obj.row) ? obj.row : [obj.row];
    for (const row of rows) {
      html += extractTableRow(row, isHeader);
    }
  }

  return html;
}

/**
 * Extract a single table row
 */
function extractTableRow(el: unknown, isHeader: boolean): string {
  if (!el || typeof el !== "object") {
    return "";
  }
  const obj = el as Record<string, unknown>;
  let html = "<tr>";

  if (obj.entry) {
    const entries = Array.isArray(obj.entry) ? obj.entry : [obj.entry];
    for (const entry of entries) {
      html += extractTableCell(entry, isHeader);
    }
  }

  html += "</tr>";
  return html;
}

/**
 * Extract a single table cell (td or th)
 */
function extractTableCell(el: unknown, isHeader: boolean): string {
  const tag = isHeader ? "th" : "td";

  // Handle simple text content (no attributes or children)
  if (typeof el === "string") {
    return `<${tag}>${escapeHtml(el)}</${tag}>`;
  }
  if (typeof el === "number") {
    return `<${tag}>${el}</${tag}>`;
  }
  if (!el || typeof el !== "object") {
    return "";
  }
  const obj = el as Record<string, unknown>;
  const attrs: string[] = [];

  // Handle colspan via namest/nameend or morerows
  if (obj["@_namest"] && obj["@_nameend"]) {
    // CALS uses column names; we'd need colspec info to calculate colspan
    // For now, store as data attributes
    attrs.push(`data-namest="${escapeHtml(String(obj["@_namest"]))}"`);
    attrs.push(`data-nameend="${escapeHtml(String(obj["@_nameend"]))}"`);
  }
  if (obj["@_morerows"]) {
    const morerows = Number.parseInt(String(obj["@_morerows"]), 10);
    if (!Number.isNaN(morerows) && morerows > 0) {
      attrs.push(`rowspan="${morerows + 1}"`);
    }
  }
  if (obj["@_align"]) {
    attrs.push(`style="text-align: ${escapeHtml(String(obj["@_align"]))}"`);
  }
  if (obj["@_valign"]) {
    attrs.push(
      `style="vertical-align: ${escapeHtml(String(obj["@_valign"]))}"`
    );
  }
  if (obj["@_colsep"]) {
    attrs.push(`data-colsep="${escapeHtml(String(obj["@_colsep"]))}"`);
  }
  if (obj["@_rowsep"]) {
    attrs.push(`data-rowsep="${escapeHtml(String(obj["@_rowsep"]))}"`);
  }

  const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
  return `<${tag}${attrStr}>${extractHtmlContent(el)}</${tag}>`;
}

/**
 * Extract list items from a List element
 */
function extractListItems(el: unknown): string {
  if (!el || typeof el !== "object") {
    return "";
  }
  const obj = el as Record<string, unknown>;
  let html = "";

  if (obj.Item) {
    const items = Array.isArray(obj.Item) ? obj.Item : [obj.Item];
    for (const item of items) {
      html += `<li>${extractHtmlContent(item)}</li>`;
    }
  }

  return html;
}
