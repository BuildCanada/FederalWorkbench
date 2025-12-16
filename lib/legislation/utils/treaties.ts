import type {
  TreatyContent,
  TreatyDefinition,
  TreatySectionHeading,
} from "../types";
import { extractHeadingComponents } from "./heading";
import { extractTextContent } from "./text";

// Treaty parsing patterns
const TREATY_PART_HEADING_REGEX = /^PART\s/i;
const TREATY_NUMERIC_LABEL_REGEX = /^\d/;
const TREATY_IN_WITNESS_REGEX = /IN WITNESS WHEREOF/i;
const TREATY_DONE_REGEX = /^DONE\s/i;

/**
 * Extract section headings from treaty content (Parts, Chapters, Articles)
 */
export function extractTreatySections(
  treatyObj: Record<string, unknown>
): TreatySectionHeading[] {
  const sections: TreatySectionHeading[] = [];

  // Extract all Heading elements
  const headings = treatyObj.Heading;
  if (!headings) {
    return sections;
  }

  const headingArray = Array.isArray(headings) ? headings : [headings];

  for (const heading of headingArray) {
    if (typeof heading !== "object" || heading === null) {
      continue;
    }

    const headingObj = heading as Record<string, unknown>;
    const level = Number(headingObj["@_level"]) || 1;
    const { label, title } = extractHeadingComponents(headingObj);

    // Skip the main title heading (first heading without a label)
    if (!label && sections.length === 0) {
      continue;
    }

    if (label || title) {
      sections.push({ level, label, title });
    }
  }

  return sections;
}

/**
 * Extract defined terms from treaty Definition elements
 */
export function extractTreatyDefinitions(
  treatyObj: Record<string, unknown>
): TreatyDefinition[] {
  const definitions: TreatyDefinition[] = [];

  // Recursively find all Definition elements
  function findDefinitions(obj: unknown): void {
    if (!obj || typeof obj !== "object") {
      return;
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        findDefinitions(item);
      }
      return;
    }

    const record = obj as Record<string, unknown>;

    // Check for Definition element
    if (record.Definition) {
      const defs = Array.isArray(record.Definition)
        ? record.Definition
        : [record.Definition];

      for (const def of defs) {
        if (typeof def !== "object" || def === null) {
          continue;
        }

        const defObj = def as Record<string, unknown>;
        const textEl = defObj.Text;
        if (!textEl) {
          continue;
        }

        const textObj =
          typeof textEl === "object" ? (textEl as Record<string, unknown>) : {};

        // Extract term from DefinedTermEn or DefinedTermFr
        let term: string | undefined;
        if (textObj.DefinedTermEn) {
          term = extractTextContent(textObj.DefinedTermEn);
        } else if (textObj.DefinedTermFr) {
          term = extractTextContent(textObj.DefinedTermFr);
        }

        if (term) {
          const definition = extractTextContent(textEl);

          definitions.push({
            term,
            definition,
          });
        }
      }
    }

    // Recurse into child elements
    for (const [key, value] of Object.entries(record)) {
      if (!key.startsWith("@_") && key !== "#text") {
        findDefinitions(value);
      }
    }
  }

  findDefinitions(treatyObj);
  return definitions;
}

/**
 * Extract preamble text from treaty (content before the first PART heading)
 */
export function extractTreatyPreamble(treatyObj: Record<string, unknown>): {
  preamble: string;
} {
  const preambleTexts: string[] = [];

  // Get provisions
  const provisions = treatyObj.Provision;
  if (!provisions) {
    return { preamble: "" };
  }

  const provisionArray = Array.isArray(provisions) ? provisions : [provisions];

  // Iterate through provisions, collecting preamble content until we hit main content
  for (const provision of provisionArray) {
    if (typeof provision !== "object" || provision === null) {
      continue;
    }

    const provisionObj = provision as Record<string, unknown>;

    // Check if this provision contains a Heading that starts a PART
    if (provisionObj.Heading) {
      const headingObj = provisionObj.Heading as Record<string, unknown>;
      const label = headingObj.Label
        ? extractTextContent(headingObj.Label)
        : undefined;
      if (label && TREATY_PART_HEADING_REGEX.test(label)) {
        break;
      }
    }

    // Preamble provisions typically don't have numeric labels
    const label = provisionObj.Label
      ? extractTextContent(provisionObj.Label)
      : undefined;
    if (label && TREATY_NUMERIC_LABEL_REGEX.test(label)) {
      // Numeric label means we're in the main content
      break;
    }

    const text = extractTextContent(provisionObj);

    if (text) {
      preambleTexts.push(text);
    }
  }

  return {
    preamble: preambleTexts.join("\n\n"),
  };
}

/**
 * Extract signature text from treaty (IN WITNESS WHEREOF, DONE, etc.)
 */
export function extractTreatySignatureText(
  treatyObj: Record<string, unknown>
): {
  signatureText: string;
} {
  const signatureTexts: string[] = [];
  let foundSignatureStart = false;

  // Get provisions
  const provisions = treatyObj.Provision;
  if (!provisions) {
    return { signatureText: "" };
  }

  const provisionArray = Array.isArray(provisions) ? provisions : [provisions];

  for (const provision of provisionArray) {
    if (typeof provision !== "object" || provision === null) {
      continue;
    }

    const provisionObj = provision as Record<string, unknown>;
    const text = extractTextContent(provisionObj);

    // Look for signature markers
    if (
      text &&
      (TREATY_IN_WITNESS_REGEX.test(text) ||
        TREATY_DONE_REGEX.test(text.trim()))
    ) {
      foundSignatureStart = true;
    }

    if (foundSignatureStart && text) {
      signatureTexts.push(text);
    }
  }

  return {
    signatureText: signatureTexts.join("\n\n"),
  };
}

/**
 * Parse a single treaty object into TreatyContent
 */
export function parseTreatyContent(treaty: unknown): TreatyContent | undefined {
  if (typeof treaty !== "object" || treaty === null) {
    return;
  }

  const treatyObj = treaty as Record<string, unknown>;

  // Extract title from first Heading
  let title: string | undefined;
  const headings = treatyObj.Heading;
  if (headings) {
    const firstHeading = Array.isArray(headings) ? headings[0] : headings;
    if (typeof firstHeading === "object" && firstHeading !== null) {
      const headingObj = firstHeading as Record<string, unknown>;
      title = extractHeadingComponents(headingObj).title;
    }
  }

  // Extract structured content
  const sections = extractTreatySections(treatyObj);
  const definitions = extractTreatyDefinitions(treatyObj);
  const { preamble } = extractTreatyPreamble(treatyObj);
  const { signatureText } = extractTreatySignatureText(treatyObj);

  // Generate full text
  const text = extractTextContent(treatyObj);

  if (!text) {
    return;
  }

  return {
    title,
    preamble: preamble || undefined,
    sections: sections.length > 0 ? sections : undefined,
    definitions: definitions.length > 0 ? definitions : undefined,
    signatureText: signatureText || undefined,
    text,
  };
}

/**
 * Extract Convention/Agreement/Treaty content with full structural detail
 * Treaties may be at the document level or nested inside Schedule elements
 */
export function extractTreaties(
  doc: Record<string, unknown>
): TreatyContent[] | undefined {
  const treaties: TreatyContent[] = [];

  // Check for treaty at document level
  if (doc.ConventionAgreementTreaty) {
    const treatyEl = doc.ConventionAgreementTreaty;
    const treatyArray = Array.isArray(treatyEl) ? treatyEl : [treatyEl];
    for (const treaty of treatyArray) {
      const parsed = parseTreatyContent(treaty);
      if (parsed) {
        treaties.push(parsed);
      }
    }
  }

  // Check for treaties inside Schedule elements
  if (doc.Schedule) {
    const schedules = Array.isArray(doc.Schedule)
      ? doc.Schedule
      : [doc.Schedule];
    for (const schedule of schedules) {
      if (typeof schedule === "object" && schedule !== null) {
        const scheduleObj = schedule as Record<string, unknown>;
        if (scheduleObj.ConventionAgreementTreaty) {
          const treatyEl = scheduleObj.ConventionAgreementTreaty;
          const treatyArray = Array.isArray(treatyEl) ? treatyEl : [treatyEl];
          for (const treaty of treatyArray) {
            const parsed = parseTreatyContent(treaty);
            if (parsed) {
              treaties.push(parsed);
            }
          }
        }
      }
    }
  }

  return treaties.length > 0 ? treaties : undefined;
}
