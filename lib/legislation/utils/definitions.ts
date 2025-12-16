import type {
  DefinitionScopeType,
  Language,
  LegislationType,
  ParsedDefinedTerm,
} from "../types";
import { extractLimsMetadata } from "./metadata";
import { normalizeTermForMatching } from "./normalization";
import { extractTextContentPreserved as extractTextContent } from "./text";

const AND_SECTIONS_REGEX =
  /in this section and (?:in )?sections?\s+(.+?)(?:\.|$)/i;
const AND_ARTICLES_REGEX =
  /au présent article et aux articles?\s*(?:à\.?)?\s*([\d\s.,àto-]+)/i;
const SECTIONS_APPLY_REGEX =
  /(?:apply|definitions apply) in sections?\s*(?:to\.?)?\s*([\d\s.,to-]+)/i;
const ARTICLES_APPLY_REGEX =
  /(?:s'appliquent|appliquent)\s*(?:aux|au)\s*articles?\s*(?:à\.?)?\s*([\d\s.,àto-]+)/i;

// Patterns for filtering emphasis text that is NOT a paired term
const STATUTE_REF_PATTERN = /^[A-Z]\.\d/; // "S.C. 2004", "R.S. 1985"
const YEAR_PATTERN = /^\d{4}/; // "2004", "1985"

/**
 * Information about definition scope parsed from XML
 */
export type DefinitionScope = {
  scopeType: DefinitionScopeType;
  scopeSections?: string[];
  scopeRawText?: string;
};

/**
 * Parse section ranges from scope text like "sections 17 to 19 and 21 to 28"
 * Also handles concatenated XML text like "sectionsto.73 80" (from XRefInternal elements)
 * Handles both integer sections (17, 18, 19) and decimal sections (90.02, 90.03, etc.)
 */
export function parseSectionRange(text: string): string[] {
  const sections: string[] = [];

  // Normalize text: handle concatenated XML output like "sectionsto.73 80"
  // by adding spaces around numbers and "to"
  const normalized = text
    .replace(/sections?\s*to\.?/gi, "sections ") // "sectionsto." -> "sections "
    .replace(/(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/g, "$1 to $2"); // "73 80" -> "73 to 80"

  // Match patterns like "17 to 19" or "17-19" or "90.02 to 90.24"
  const rangePattern = /(\d+(?:\.\d+)?)\s*(?:to|-)\s*(\d+(?:\.\d+)?)/g;
  const singlePattern = /\b(\d+(?:\.\d+)?)\b/g;

  // First extract ranges
  let match: RegExpExecArray | null;
  const processedIndices = new Set<number>();

  // biome-ignore lint/suspicious/noAssignInExpressions: Standard regex exec pattern
  while ((match = rangePattern.exec(normalized)) !== null) {
    const startStr = match[1];
    const endStr = match[2];
    processedIndices.add(match.index);

    // Check if we're dealing with decimal sections (like 90.02 to 90.24)
    if (startStr.includes(".") || endStr.includes(".")) {
      // For decimal sections, we can't enumerate them - just store start and end
      // The UI will need to check if a section falls within range
      sections.push(startStr);
      if (startStr !== endStr) {
        sections.push(endStr);
      }
      // Mark this as a range by adding a special marker
      // We'll store this as "start-end" format that can be parsed later
      // Actually, let's just store both endpoints and let the UI handle range checking
    } else {
      // Integer range - enumerate all sections
      const start = Number.parseInt(startStr, 10);
      const end = Number.parseInt(endStr, 10);
      for (let i = start; i <= end; i++) {
        sections.push(String(i));
      }
    }
  }

  // Then extract single numbers that weren't part of ranges
  // biome-ignore lint/suspicious/noAssignInExpressions: Standard regex exec pattern
  while ((match = singlePattern.exec(normalized)) !== null) {
    // Skip if this number was part of a range we already processed
    let isPartOfRange = false;
    for (const idx of processedIndices) {
      if (match.index >= idx && match.index < idx + 30) {
        isPartOfRange = true;
        break;
      }
    }
    if (!isPartOfRange && !sections.includes(match[1])) {
      sections.push(match[1]);
    }
  }

  return sections;
}

/**
 * Parse scope declaration from text like "In this Act," or "The following definitions apply in sections 17 to 19"
 * Also handles French patterns like "Les définitions qui suivent s'appliquent aux articles..."
 */
export function parseDefinitionScope(
  scopeText: string,
  currentSectionLabel: string,
  docType: LegislationType
): DefinitionScope {
  const text = scopeText.toLowerCase();

  // Check for entire document scope (English)
  if (text.includes("in this act") && !text.includes("in this act and")) {
    return {
      scopeType: "act",
      scopeRawText: scopeText,
    };
  }

  // Check for entire document scope (French) - "dans la présente loi"
  if (
    text.includes("dans la présente loi") ||
    text.includes("la présente loi")
  ) {
    return {
      scopeType: "act",
      scopeRawText: scopeText,
    };
  }

  // Only match if it's not followed by section references
  if (text.includes("in this regulation") && !text.includes("sections")) {
    return {
      scopeType: "regulation",
      scopeRawText: scopeText,
    };
  }

  // Check for entire regulation scope (French) - "dans le présent règlement"
  if (
    text.includes("dans le présent règlement") ||
    text.includes("le présent règlement")
  ) {
    return {
      scopeType: "regulation",
      scopeRawText: scopeText,
    };
  }

  // Check for Part scope (English)
  if (text.includes("in this part") && !text.includes("sections")) {
    return {
      scopeType: "part",
      scopeRawText: scopeText,
    };
  }

  // Check for Part scope (French) - "dans la présente partie"
  if (text.includes("dans la présente partie") && !text.includes("articles")) {
    return {
      scopeType: "part",
      scopeRawText: scopeText,
    };
  }

  // Check for section-specific scope (English)
  // Patterns: "in this section", "apply in this section", "apply in sections X to Y"
  if (
    text.includes("in this section") ||
    text.includes("apply in this section")
  ) {
    const sections = [currentSectionLabel];

    // Check if it also includes other sections: "in this section and sections..."
    const andSectionsMatch = text.match(AND_SECTIONS_REGEX);
    if (andSectionsMatch) {
      const additionalSections = parseSectionRange(andSectionsMatch[1]);
      sections.push(...additionalSections);
    }

    return {
      scopeType: "section",
      scopeSections: [...new Set(sections)], // Remove duplicates
      scopeRawText: scopeText,
    };
  }

  // Check for section-specific scope (French)
  // Patterns: "au présent article", "s'appliquent au présent article et aux articles"
  if (text.includes("au présent article") || text.includes("présent article")) {
    const sections = [currentSectionLabel];

    // Check if it also includes other articles: "au présent article et aux articles..."
    const andArticlesMatch = text.match(AND_ARTICLES_REGEX);
    if (andArticlesMatch) {
      const additionalSections = parseSectionRange(andArticlesMatch[1]);
      sections.push(...additionalSections);
    }

    return {
      scopeType: "section",
      scopeSections: [...new Set(sections)], // Remove duplicates
      scopeRawText: scopeText,
    };
  }

  // Check for "apply in sections X to Y" without "this section" (English)
  // Handle both normal format and concatenated XML format like "sectionsto.73 80"
  // Use a more specific pattern to capture section numbers including decimals
  const sectionsMatch = text.match(SECTIONS_APPLY_REGEX);
  if (sectionsMatch) {
    const sections = parseSectionRange(sectionsMatch[1]);
    if (sections.length > 0) {
      return {
        scopeType: "section",
        scopeSections: sections,
        scopeRawText: scopeText,
      };
    }
  }

  // Check for "s'appliquent aux articles X à Y" (French)
  // Handle concatenated XML format like "articlesà.73 80"
  const articlesMatch = text.match(ARTICLES_APPLY_REGEX);
  if (articlesMatch) {
    const sections = parseSectionRange(articlesMatch[1]);
    if (sections.length > 0) {
      return {
        scopeType: "section",
        scopeSections: sections,
        scopeRawText: scopeText,
      };
    }
  }

  // Default to document-wide scope
  return {
    scopeType: docType,
    scopeRawText: scopeText,
  };
}

/**
 * Options for extracting a defined term from a Definition element
 */
type ExtractDefinedTermOptions = {
  defEl: Record<string, unknown>;
  language: Language;
  actId?: string;
  regulationId?: string;
  sectionLabel?: string;
  scope?: DefinitionScope;
  /** Document position for position-based joining with preserved-order content */
  definitionOrder?: number;
};

/**
 * Helper to extract individual term strings from a DefinedTermEn/Fr element or array
 */
function extractTermStrings(termEl: unknown): string[] {
  if (!termEl) {
    return [];
  }

  // If it's an array of term elements, extract each one separately
  if (Array.isArray(termEl)) {
    return termEl.map((t) => extractTextContent(t)).filter((t) => t.length > 0);
  }

  // Single term element
  const text = extractTextContent(termEl);
  return text ? [text] : [];
}

/**
 * Extract paired term from <Emphasis style="italic"> elements.
 *
 * Some older legislation XML uses <Emphasis> instead of <DefinedTermFr/En> for
 * the paired term. This is a fallback for those cases.
 *
 * Example XML:
 *   <Text>In this Part, <DefinedTermEn>elevating device</DefinedTermEn> means
 *   an escalator...(<Emphasis style="italic">appareil de levage</Emphasis>)</Text>
 *
 * We only extract from Emphasis elements with style="italic" that appear to be
 * paired terms (typically short text without periods).
 */
function extractPairedTermFromEmphasis(emphasisEl: unknown): string[] {
  if (!emphasisEl) {
    return [];
  }

  const emphasisArray = Array.isArray(emphasisEl) ? emphasisEl : [emphasisEl];
  const terms: string[] = [];

  for (const el of emphasisArray) {
    if (typeof el !== "object" || el === null) {
      // Could be a plain string emphasis (no attributes)
      if (typeof el === "string") {
        const trimmed = el.trim();
        // Skip if it looks like a full sentence or reference
        if (
          trimmed.length > 0 &&
          trimmed.length < 100 &&
          !trimmed.includes(".")
        ) {
          terms.push(trimmed);
        }
      }
      continue;
    }

    const emphObj = el as Record<string, unknown>;

    // Check for style="italic" - this is the common pattern for paired terms
    const style = emphObj["@_style"];
    if (style !== "italic") {
      continue;
    }

    // Extract the text content
    const text = extractTextContent(el);
    if (!text) {
      continue;
    }

    // Filter out non-term content:
    // - Skip very long text (likely not a term definition)
    // - Skip text containing periods (likely a sentence/reference)
    // - Skip text that looks like a statute reference
    const trimmed = text.trim();
    if (
      trimmed.length > 0 &&
      trimmed.length < 100 &&
      !trimmed.includes(".") &&
      !STATUTE_REF_PATTERN.test(trimmed) && // Skip patterns like "S.C. 2004"
      !YEAR_PATTERN.test(trimmed) // Skip year patterns
    ) {
      terms.push(trimmed);
    }
  }

  return terms;
}

/**
 * Nested XML element types that can contain paragraph structures with terms.
 * These elements may have Text children containing DefinedTermEn/Fr tags.
 */
const NESTED_PARAGRAPH_ELEMENTS = [
  "Paragraph",
  "Subparagraph",
  "Clause",
  "Subclause",
  "ContinuedParagraph",
  "ContinuedDefinition",
  "ContinuedSectionSubsection",
] as const;

/**
 * Recursively extract terms from an element and its nested children.
 *
 * Searches Text elements at any nesting level within paragraph structures.
 * Handles deeply nested XML like:
 *   Paragraph > Subparagraph > Text > DefinedTermFr
 *   Paragraph > Subparagraph > ContinuedParagraph > Text > DefinedTermFr
 */
function extractTermsFromElement(
  element: unknown,
  termKey: "DefinedTermEn" | "DefinedTermFr"
): string[] {
  if (!element || typeof element !== "object") {
    return [];
  }

  const terms: string[] = [];
  const obj = element as Record<string, unknown>;

  // Check if this element has a Text child with the term key
  if (obj.Text && typeof obj.Text === "object") {
    const textObj = obj.Text as Record<string, unknown>;
    const found = extractTermStrings(textObj[termKey]);
    terms.push(...found);
  }

  // Recursively search nested paragraph elements
  for (const key of NESTED_PARAGRAPH_ELEMENTS) {
    const child = obj[key];
    if (!child) {
      continue;
    }

    const childArray = Array.isArray(child) ? child : [child];
    for (const item of childArray) {
      terms.push(...extractTermsFromElement(item, termKey));
    }
  }

  return terms;
}

/**
 * Search for DefinedTermEn/Fr in nested Paragraph elements.
 *
 * List-style definitions place the paired term at the end of the last paragraph,
 * which may be deeply nested in Subparagraph or ContinuedParagraph elements:
 *
 * <Definition>
 *   <Text><DefinedTermEn>peace officer</DefinedTermEn> includes</Text>
 *   <Paragraph>
 *     <Label>(g)</Label>
 *     <Subparagraph>
 *       <Label>(ii)</Label>
 *       <Text>...(<DefinedTermFr>agent de la paix</DefinedTermFr>)</Text>
 *     </Subparagraph>
 *   </Paragraph>
 * </Definition>
 */
function extractTermsFromParagraphs(
  paragraphs: unknown,
  termKey: "DefinedTermEn" | "DefinedTermFr"
): string[] {
  if (!paragraphs) {
    return [];
  }

  const paragraphArray = Array.isArray(paragraphs) ? paragraphs : [paragraphs];
  const terms: string[] = [];

  for (const para of paragraphArray) {
    terms.push(...extractTermsFromElement(para, termKey));
  }

  // Deduplicate to handle edge cases where same term appears at multiple nesting levels
  return [...new Set(terms)];
}

/**
 * Extract defined terms from a Definition element
 *
 * A single Definition element may contain multiple DefinedTermEn/Fr elements,
 * e.g., `<DefinedTermEn>every one</DefinedTermEn>, <DefinedTermEn>person</DefinedTermEn>`
 *
 * This function returns an ARRAY of ParsedDefinedTerm, one for each term defined.
 * Terms are paired positionally with their counterparts in the other language.
 */
export function extractDefinedTermFromDefinition(
  options: ExtractDefinedTermOptions
): ParsedDefinedTerm[] {
  const {
    defEl,
    language,
    actId,
    regulationId,
    sectionLabel,
    scope,
    definitionOrder,
  } = options;
  const textEl = defEl.Text;
  if (!textEl) {
    return [];
  }

  const textObj =
    typeof textEl === "object" ? (textEl as Record<string, unknown>) : {};

  // Extract all terms from both languages (may be multiple per Definition)
  // First check the main Text element
  let termsEn = extractTermStrings(textObj.DefinedTermEn);
  let termsFr = extractTermStrings(textObj.DefinedTermFr);

  // For list-style definitions, the paired term may be in nested Paragraph elements
  // or in sibling elements like ContinuedDefinition/ContinuedSectionSubsection.
  // Only search if we're missing one language's terms.
  if (termsEn.length === 0 || termsFr.length === 0) {
    // Search Paragraph elements (which may have deeply nested terms)
    const paragraphTermsEn = extractTermsFromParagraphs(
      defEl.Paragraph,
      "DefinedTermEn"
    );
    const paragraphTermsFr = extractTermsFromParagraphs(
      defEl.Paragraph,
      "DefinedTermFr"
    );

    // Also search ContinuedDefinition and ContinuedSectionSubsection at Definition level
    // These are siblings to Paragraph, not nested inside them
    const continuedDefTermsEn = extractTermsFromParagraphs(
      defEl.ContinuedDefinition,
      "DefinedTermEn"
    );
    const continuedDefTermsFr = extractTermsFromParagraphs(
      defEl.ContinuedDefinition,
      "DefinedTermFr"
    );
    const continuedSubsectionTermsEn = extractTermsFromParagraphs(
      defEl.ContinuedSectionSubsection,
      "DefinedTermEn"
    );
    const continuedSubsectionTermsFr = extractTermsFromParagraphs(
      defEl.ContinuedSectionSubsection,
      "DefinedTermFr"
    );

    // Combine all found terms
    const allNestedTermsEn = [
      ...paragraphTermsEn,
      ...continuedDefTermsEn,
      ...continuedSubsectionTermsEn,
    ];
    const allNestedTermsFr = [
      ...paragraphTermsFr,
      ...continuedDefTermsFr,
      ...continuedSubsectionTermsFr,
    ];

    if (termsEn.length === 0 && allNestedTermsEn.length > 0) {
      termsEn = [...new Set(allNestedTermsEn)];
    }
    if (termsFr.length === 0 && allNestedTermsFr.length > 0) {
      termsFr = [...new Set(allNestedTermsFr)];
    }
  }

  // Fallback: Some older XML uses <Emphasis style="italic"> for paired terms
  // instead of proper <DefinedTermFr/En> tags. Extract from Emphasis as fallback.
  // Only use this fallback for the PAIRED term (the other language), not primary.
  if (termsEn.length > 0 && termsFr.length === 0 && language === "en") {
    // EN document has EN terms but missing FR paired term - check Emphasis
    const emphasisTerms = extractPairedTermFromEmphasis(textObj.Emphasis);
    if (emphasisTerms.length > 0) {
      termsFr = emphasisTerms;
    }
  }
  if (termsFr.length > 0 && termsEn.length === 0 && language === "fr") {
    // FR document has FR terms but missing EN paired term - check Emphasis
    const emphasisTerms = extractPairedTermFromEmphasis(textObj.Emphasis);
    if (emphasisTerms.length > 0) {
      termsEn = emphasisTerms;
    }
  }

  // Determine which terms to use based on document language
  // The document's language determines the primary terms; the other language provides paired terms
  const primaryTerms = language === "en" ? termsEn : termsFr;
  const pairedTerms = language === "en" ? termsFr : termsEn;

  // If no terms in the primary language, fall back to other language
  const termsToUse = primaryTerms.length > 0 ? primaryTerms : pairedTerms;
  const pairsToUse = primaryTerms.length > 0 ? pairedTerms : [];

  if (termsToUse.length === 0) {
    return [];
  }

  // Full definition text (shared by all terms in this Definition)
  // extractTextContent (aliased from extractTextContentPreserved) maintains document order
  // for mixed content (text interspersed with elements like XRefExternal)
  const definition = extractTextContent(textEl);

  // Default scope if not provided
  const defaultScopeType: DefinitionScopeType = actId ? "act" : "regulation";

  // Extract LIMS metadata from the Definition element (shared by all terms)
  const limsMetadata = extractLimsMetadata(defEl);

  // Create a ParsedDefinedTerm for each term
  // Pair terms positionally (term[0] pairs with pairedTerm[0], etc.)
  const results: ParsedDefinedTerm[] = [];

  for (let i = 0; i < termsToUse.length; i++) {
    const term = termsToUse[i];
    // Pair positionally if available, otherwise use first paired term as fallback
    const pairedTerm =
      pairsToUse[i] || (pairsToUse.length === 1 ? pairsToUse[0] : undefined);

    results.push({
      language,
      term,
      termNormalized: normalizeTermForMatching(term),
      pairedTerm,
      definition,
      actId,
      regulationId,
      sectionLabel,
      definitionOrder,
      scopeType: scope?.scopeType || defaultScopeType,
      scopeSections: scope?.scopeSections,
      scopeRawText: scope?.scopeRawText,
      limsMetadata,
    });
  }

  return results;
}
