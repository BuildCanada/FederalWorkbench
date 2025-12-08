import type {
  DefinitionScopeType,
  Language,
  LegislationType,
  ParsedDefinedTerm,
} from "../types";
import { extractLimsMetadata } from "./metadata";
import { extractTextContent } from "./text";

const AND_SECTIONS_REGEX =
  /in this section and (?:in )?sections?\s+(.+?)(?:\.|$)/i;
const AND_ARTICLES_REGEX =
  /au présent article et aux articles?\s*(?:à\.?)?\s*([\d\s.,àto-]+)/i;
const SECTIONS_APPLY_REGEX =
  /(?:apply|definitions apply) in sections?\s*(?:to\.?)?\s*([\d\s.,to-]+)/i;
const ARTICLES_APPLY_REGEX =
  /(?:s'appliquent|appliquent)\s*(?:aux|au)\s*articles?\s*(?:à\.?)?\s*([\d\s.,àto-]+)/i;

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
};

/**
 * Extract defined terms from a Definition element
 *
 * Creates ONE ParsedDefinedTerm per call, representing THIS language version.
 * The term in the current language becomes `term`, and the term in the other
 * language (if present) becomes `pairedTerm` for linking.
 */
export function extractDefinedTermFromDefinition(
  options: ExtractDefinedTermOptions
): ParsedDefinedTerm | null {
  const { defEl, language, actId, regulationId, sectionLabel, scope } = options;
  const textEl = defEl.Text;
  if (!textEl) {
    return null;
  }

  const textObj =
    typeof textEl === "object" ? (textEl as Record<string, unknown>) : {};

  // Extract both language terms from XML
  // The XML may contain DefinedTermEn and/or DefinedTermFr elements
  let termEn: string | undefined;
  if (textObj.DefinedTermEn) {
    termEn = extractTextContent(textObj.DefinedTermEn);
  }

  let termFr: string | undefined;
  if (textObj.DefinedTermFr) {
    termFr = extractTextContent(textObj.DefinedTermFr);
  }

  // Determine the term for THIS language and the paired term for OTHER language
  // If the document is English, use DefinedTermEn as term and DefinedTermFr as pairedTerm
  // If the document is French, use DefinedTermFr as term and DefinedTermEn as pairedTerm
  let term: string | undefined;
  let pairedTerm: string | undefined;

  if (language === "en") {
    term = termEn || termFr; // Fall back to French if English not present
    pairedTerm = termFr;
  } else {
    term = termFr || termEn; // Fall back to English if French not present
    pairedTerm = termEn;
  }

  if (!term) {
    return null;
  }

  // Full definition text (this is the definition in the current document's language)
  const definition = extractTextContent(textEl);

  // Default scope if not provided
  const defaultScopeType: DefinitionScopeType = actId ? "act" : "regulation";

  // Extract LIMS metadata from the Definition element
  const limsMetadata = extractLimsMetadata(defEl);

  return {
    language,
    term,
    termNormalized: term.toLowerCase().replace(/[^\w\s]/g, ""),
    pairedTerm,
    definition,
    actId,
    regulationId,
    sectionLabel,
    scopeType: scope?.scopeType || defaultScopeType,
    scopeSections: scope?.scopeSections,
    scopeRawText: scope?.scopeRawText,
    limsMetadata,
  };
}
