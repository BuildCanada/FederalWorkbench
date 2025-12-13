import type {
  Language,
  LegislationType,
  ParsedCrossReference,
  ParsedDefinedTerm,
  ParsedSection,
  SectionType,
  Status,
} from "../types";
import {
  extractContentFlags,
  extractFormattingAttributes,
  extractProvisionHeading,
} from "./content-flags";
import { parseDate } from "./dates";
import {
  type DefinitionScope,
  extractDefinedTermFromDefinition,
  parseDefinitionScope,
} from "./definitions";
import { extractFootnotes, extractHistoricalNotes } from "./document-metadata";
import { extractChangeType, extractLimsMetadata } from "./metadata";
import {
  extractCrossReferences,
  extractInternalReferences,
} from "./references";
import {
  extractScheduleContext,
  extractScheduleListContent,
  type ScheduleContext,
} from "./schedules";
import { extractHtmlContent, extractTextContent } from "./text";

/**
 * Determine if a section element represents a repealed section.
 *
 * The Justice Canada XML uses two patterns for repealed sections:
 *
 * 1. Direct Repealed child (rare):
 *    <Section><Repealed>[Repealed, SOR/2023-5]</Repealed></Section>
 *
 * 2. Repealed inside Text (common):
 *    <Section><Label>1</Label><Text><Repealed>[Repealed, SOR/2018-39]</Repealed></Text></Section>
 *
 * This function detects BOTH patterns. It only returns true when the section's
 * PRIMARY content is a Repealed element, not when some nested content (like a
 * single definition) is repealed while the section remains active.
 */
export function isRepealedSection(sectionEl: Record<string, unknown>): boolean {
  // Pattern 1: Direct <Repealed> child
  if (sectionEl.Repealed) {
    return true;
  }

  // Pattern 2: <Text><Repealed>...</Repealed></Text> where Text contains ONLY Repealed
  if (sectionEl.Text && typeof sectionEl.Text === "object") {
    const textEl = sectionEl.Text as Record<string, unknown>;

    // Check if Text has a Repealed property
    if (!textEl.Repealed) {
      return false;
    }

    // Count substantive keys (exclude XML attributes starting with @)
    // A fully repealed section's Text should only have Repealed (and maybe whitespace #text)
    const substantiveKeys = Object.keys(textEl).filter(
      (key) => !key.startsWith("@") && key !== "#text"
    );

    // If Repealed is the only substantive content, section is repealed
    return substantiveKeys.length === 1 && substantiveKeys[0] === "Repealed";
  }

  return false;
}

/**
 * Options for parsing sections from Body element
 */
type ParseSectionsOptions = {
  bodyEl: Record<string, unknown>;
  language: Language;
  actId?: string;
  regulationId?: string;
  scheduleContext?: ScheduleContext;
};

/**
 * Parse sections from Body element
 */
export function parseSections(options: ParseSectionsOptions): {
  sections: ParsedSection[];
  definedTerms: ParsedDefinedTerm[];
  crossReferences: ParsedCrossReference[];
} {
  const { bodyEl, language, actId, regulationId, scheduleContext } = options;
  const sections: ParsedSection[] = [];
  const definedTerms: ParsedDefinedTerm[] = [];
  const crossReferences: ParsedCrossReference[] = [];
  let sectionOrder = 0;
  const currentHierarchy: string[] = [];

  const idBase = actId || regulationId || "unknown";
  const docType: LegislationType = actId ? "act" : "regulation";

  const processSection = (
    sectionEl: Record<string, unknown>,
    parentLabel?: string,
    currentScheduleContext?: ScheduleContext
  ) => {
    const label = sectionEl.Label
      ? extractTextContent(sectionEl.Label)
      : parentLabel;
    if (!label) {
      return;
    }

    sectionOrder++;

    // Extract marginal note
    let marginalNote: string | undefined;
    if (sectionEl.MarginalNote) {
      marginalNote = extractTextContent(sectionEl.MarginalNote);
    }

    // Extract full content
    const content = extractTextContent(sectionEl);

    // Determine status
    let status: Status = "in-force";
    if (isRepealedSection(sectionEl)) {
      status = "repealed";
    } else if (sectionEl["@_in-force"] === "no") {
      status = "not-in-force";
    }

    // Extract dates
    const inForceStartDate = parseDate(
      sectionEl["@_lims:inforce-start-date"] as string | undefined
    );
    const lastAmendedDate = parseDate(
      sectionEl["@_lims:lastAmendedDate"] as string | undefined
    );

    // Use schedule context for canonicalSectionId if inside a schedule
    const effectiveScheduleContext = currentScheduleContext || scheduleContext;

    // Determine section type FIRST (needed for canonicalSectionId)
    // Check for amending type from section's own attributes
    const xmlType = sectionEl["@_type"] as string | undefined;
    let sectionType: SectionType = "section";

    if (xmlType === "amending" || xmlType === "CIF") {
      // Section explicitly marked as amending (e.g., NOT IN FORCE provisions)
      sectionType = "amending";
    } else if (effectiveScheduleContext) {
      // Inside a schedule - check if it's an amending schedule (NifProvs = NOT IN FORCE)
      const isAmendingSchedule =
        effectiveScheduleContext.scheduleId === "NifProvs" ||
        effectiveScheduleContext.scheduleType === "amending";
      sectionType = isAmendingSchedule ? "amending" : "schedule";
    }

    // Generate canonicalSectionId including sectionType and sectionOrder for uniqueness
    // Format: {docId}/{language}/{sectionType}/{order}/s{label}
    // sectionOrder guarantees uniqueness even when same label appears multiple times
    // (e.g., multiple "section 16" in different BillPiece blocks within RelatedProvs)
    const scheduleIdentifier =
      effectiveScheduleContext?.scheduleLabel ||
      effectiveScheduleContext?.scheduleId;
    const canonicalSectionId = scheduleIdentifier
      ? `${idBase}/${language}/${sectionType}/${sectionOrder}/sch-${scheduleIdentifier.replace(/\s+/g, "-").toLowerCase()}/s${label}`
      : `${idBase}/${language}/${sectionType}/${sectionOrder}/s${label}`;

    // Extract additional metadata
    const xmlTarget = sectionEl["@_target"] as string | undefined;
    const changeType = extractChangeType(sectionEl);
    const enactedDate = parseDate(
      sectionEl["@_lims:enacted-date"] as string | undefined
    );
    const limsMetadata = extractLimsMetadata(sectionEl);
    const historicalNotes = extractHistoricalNotes(sectionEl);
    const footnotes = extractFootnotes(sectionEl);
    const contentHtml = extractHtmlContent(sectionEl);
    const contentFlags = extractContentFlags(sectionEl);
    const internalReferences = extractInternalReferences(sectionEl);
    // Lower Priority: Extract formatting attributes
    const formattingAttributes = extractFormattingAttributes(sectionEl);

    sections.push({
      canonicalSectionId,
      sectionLabel: label,
      sectionOrder,
      language,
      sectionType,
      hierarchyPath: [...currentHierarchy],
      marginalNote,
      content,
      contentHtml: contentHtml || undefined,
      status,
      xmlType,
      xmlTarget,
      changeType,
      inForceStartDate,
      lastAmendedDate,
      enactedDate,
      limsMetadata,
      historicalNotes: historicalNotes.length > 0 ? historicalNotes : undefined,
      footnotes: footnotes.length > 0 ? footnotes : undefined,
      contentFlags,
      formattingAttributes,
      internalReferences:
        internalReferences.length > 0 ? internalReferences : null,
      // Schedule metadata from context
      scheduleId: effectiveScheduleContext?.scheduleId,
      scheduleBilingual: effectiveScheduleContext?.scheduleBilingual,
      scheduleSpanLanguages: effectiveScheduleContext?.scheduleSpanLanguages,
      scheduleOriginatingRef: effectiveScheduleContext?.scheduleOriginatingRef,
      actId,
      regulationId,
    });

    // Extract scope declaration from section's Text element (appears before Definition elements)
    // Look for patterns like "In this Act," or "The following definitions apply in sections 17 to 19"
    let scope: DefinitionScope | undefined;

    // Check for direct Text element in section
    if (sectionEl.Text) {
      const scopeText = extractTextContent(sectionEl.Text);
      if (scopeText) {
        scope = parseDefinitionScope(scopeText, label, docType);
      }
    }

    // Also check subsections for scope declarations
    const subsections = sectionEl.Subsection
      ? Array.isArray(sectionEl.Subsection)
        ? sectionEl.Subsection
        : [sectionEl.Subsection]
      : [];

    for (const subsec of subsections) {
      if (!subsec || typeof subsec !== "object") {
        continue;
      }
      const subsecObj = subsec as Record<string, unknown>;

      // Check if this subsection has a Text element with scope declaration
      if (subsecObj.Text && !scope) {
        const subsecText = extractTextContent(subsecObj.Text);
        if (subsecText) {
          const potentialScope = parseDefinitionScope(
            subsecText,
            label,
            docType
          );
          // Only use if it looks like a scope declaration
          if (potentialScope.scopeRawText) {
            scope = potentialScope;
          }
        }
      }

      // Extract definitions from subsections too
      const subsecDefs = subsecObj.Definition
        ? Array.isArray(subsecObj.Definition)
          ? subsecObj.Definition
          : [subsecObj.Definition]
        : [];

      for (const def of subsecDefs) {
        const terms = extractDefinedTermFromDefinition({
          defEl: def as Record<string, unknown>,
          language,
          actId,
          regulationId,
          sectionLabel: label,
          scope,
        });
        definedTerms.push(...terms);
      }

      // Extract inline definitions from Subsection/Text (no Definition wrapper)
      if (subsecDefs.length === 0 && subsecObj.Text) {
        const textObj =
          typeof subsecObj.Text === "object"
            ? (subsecObj.Text as Record<string, unknown>)
            : {};

        const hasInlineDefinedTerm =
          textObj.DefinedTermEn !== undefined ||
          textObj.DefinedTermFr !== undefined;

        if (hasInlineDefinedTerm) {
          const syntheticDef = { Text: subsecObj.Text };
          const inlineTerms = extractDefinedTermFromDefinition({
            defEl: syntheticDef,
            language,
            actId,
            regulationId,
            sectionLabel: label,
            scope,
          });
          definedTerms.push(...inlineTerms);
        }
      }
    }

    // Extract defined terms from Definition elements directly in section
    const definitions = sectionEl.Definition
      ? Array.isArray(sectionEl.Definition)
        ? sectionEl.Definition
        : [sectionEl.Definition]
      : [];

    for (const def of definitions) {
      const terms = extractDefinedTermFromDefinition({
        defEl: def as Record<string, unknown>,
        language,
        actId,
        regulationId,
        sectionLabel: label,
        scope,
      });
      definedTerms.push(...terms);
    }

    // Extract inline definitions: DefinedTermEn/Fr directly in Section/Text
    // without a Definition wrapper. Example:
    //   <Section><Text>In this Part, <DefinedTermEn>elevating device</DefinedTermEn>
    //   means... (<Emphasis>appareil de levage</Emphasis>)</Text></Section>
    // Only check if no Definition elements were found in this section
    if (definitions.length === 0 && sectionEl.Text) {
      const textObj =
        typeof sectionEl.Text === "object"
          ? (sectionEl.Text as Record<string, unknown>)
          : {};

      // Check if Text contains DefinedTermEn or DefinedTermFr
      const hasInlineDefinedTerm =
        textObj.DefinedTermEn !== undefined ||
        textObj.DefinedTermFr !== undefined;

      if (hasInlineDefinedTerm) {
        // Create a synthetic Definition element wrapping the Text
        const syntheticDef = { Text: sectionEl.Text };
        const inlineTerms = extractDefinedTermFromDefinition({
          defEl: syntheticDef,
          language,
          actId,
          regulationId,
          sectionLabel: label,
          scope,
        });
        definedTerms.push(...inlineTerms);
      }
    }

    // Extract cross references
    const refs = extractCrossReferences(sectionEl, actId, regulationId, label);
    crossReferences.push(...refs);
  };

  const processElement = (
    el: unknown,
    currentScheduleContext?: ScheduleContext
  ) => {
    if (!el || typeof el !== "object") {
      return;
    }
    const obj = el as Record<string, unknown>;

    // Handle Heading elements (update hierarchy)
    if (obj.Heading) {
      const headings = Array.isArray(obj.Heading) ? obj.Heading : [obj.Heading];
      for (const heading of headings) {
        if (!heading || typeof heading !== "object") {
          continue;
        }
        const h = heading as Record<string, unknown>;
        const level = Number.parseInt(String(h["@_level"] || "1"), 10);
        const titleText = h.TitleText
          ? extractTextContent(h.TitleText)
          : undefined;
        const labelText = h.Label ? extractTextContent(h.Label) : undefined;

        const headingText = [labelText, titleText].filter(Boolean).join(" ");

        // Adjust hierarchy based on level
        while (currentHierarchy.length >= level) {
          currentHierarchy.pop();
        }
        if (headingText) {
          currentHierarchy.push(headingText);
        }
      }
    }

    // Handle Section elements - pass schedule context if we're inside a Schedule
    if (obj.Section) {
      const sectionArray = Array.isArray(obj.Section)
        ? obj.Section
        : [obj.Section];
      for (const section of sectionArray) {
        if (section && typeof section === "object") {
          processSection(
            section as Record<string, unknown>,
            undefined,
            currentScheduleContext || scheduleContext
          );
        }
      }
    }

    // Handle Provision elements (from Order blocks in regulations)
    // These contain regulatory authority text without section labels
    if (obj.Provision) {
      const provisions = Array.isArray(obj.Provision)
        ? obj.Provision
        : [obj.Provision];
      for (const provision of provisions) {
        if (provision && typeof provision === "object") {
          sectionOrder++;
          const provObj = provision as Record<string, unknown>;

          // Generate a label for the provision using document-level sectionOrder for uniqueness
          // (provisionIndex would reset for each Order block, causing duplicates)
          const label = `order-${sectionOrder}`;

          // Extract content
          const content = extractTextContent(provObj);

          // Extract marginal note if present
          let marginalNote: string | undefined;
          if (provObj.MarginalNote) {
            marginalNote = extractTextContent(provObj.MarginalNote);
          }

          // Determine status
          let status: Status = "in-force";
          if (provObj["@_in-force"] === "no") {
            status = "not-in-force";
          }

          // Extract dates and metadata
          const inForceStartDate = parseDate(
            provObj["@_lims:inforce-start-date"] as string | undefined
          );
          const lastAmendedDate = parseDate(
            provObj["@_lims:lastAmendedDate"] as string | undefined
          );
          const enactedDate = parseDate(
            provObj["@_lims:enacted-date"] as string | undefined
          );
          const limsMetadata = extractLimsMetadata(provObj);
          const footnotes = extractFootnotes(provObj);
          const contentHtml = extractHtmlContent(provObj);
          const contentFlags = extractContentFlags(provObj);
          const internalReferences = extractInternalReferences(provObj);
          const formattingAttributes = extractFormattingAttributes(provObj);
          const provisionHeading = extractProvisionHeading(provObj);

          // Include sectionType and sectionOrder in ID for uniqueness
          const canonicalSectionId = `${idBase}/${language}/provision/${sectionOrder}/${label}`;

          sections.push({
            canonicalSectionId,
            sectionLabel: label,
            sectionOrder,
            language,
            sectionType: "provision",
            hierarchyPath: [...currentHierarchy],
            marginalNote,
            content,
            contentHtml: contentHtml || undefined,
            status,
            inForceStartDate,
            lastAmendedDate,
            enactedDate,
            limsMetadata,
            footnotes,
            contentFlags,
            formattingAttributes,
            provisionHeading,
            internalReferences:
              internalReferences.length > 0 ? internalReferences : null,
            actId,
            regulationId,
          });

          // Extract defined terms from provisions (rare but possible)
          const definitions = provObj.Definition
            ? Array.isArray(provObj.Definition)
              ? provObj.Definition
              : [provObj.Definition]
            : [];
          for (const def of definitions) {
            const terms = extractDefinedTermFromDefinition({
              defEl: def as Record<string, unknown>,
              language,
              actId,
              regulationId,
              sectionLabel: label,
              scope: {
                scopeType: docType,
                scopeSections: undefined,
                scopeRawText: undefined,
              },
            });
            definedTerms.push(...terms);
          }

          // Extract cross references from provisions
          const refs = extractCrossReferences(
            provObj,
            actId,
            regulationId,
            label
          );
          crossReferences.push(...refs);
        }
      }
    }

    // Handle Schedule elements specially
    if (obj.Schedule) {
      const schedules = Array.isArray(obj.Schedule)
        ? obj.Schedule
        : [obj.Schedule];
      for (const schedule of schedules) {
        if (schedule && typeof schedule === "object") {
          const scheduleObj = schedule as Record<string, unknown>;

          // Extract schedule context from this Schedule element
          const newScheduleContext = extractScheduleContext(scheduleObj);

          // Add schedule label to hierarchy if present
          if (newScheduleContext.scheduleLabel) {
            currentHierarchy.push(newScheduleContext.scheduleLabel);
          }

          // First, extract List/Item content that doesn't use Section wrappers
          // This captures schedule content like CDSA drug lists
          const listResult = extractScheduleListContent({
            scheduleEl: scheduleObj,
            scheduleContext: newScheduleContext,
            language,
            actId,
            regulationId,
            startingOrder: sectionOrder,
          });
          sections.push(...listResult.sections);
          definedTerms.push(...listResult.definedTerms);
          crossReferences.push(...listResult.crossReferences);
          sectionOrder = listResult.nextOrder;

          // Then recurse into the Schedule to process any Section elements
          // Pass the schedule context so sections know they're inside a schedule
          processElement(scheduleObj, newScheduleContext);

          // Pop schedule from hierarchy
          if (newScheduleContext.scheduleLabel) {
            currentHierarchy.pop();
          }
        }
      }
    }

    // Recurse into other structural elements (but NOT Schedule - handled above)
    // BillPiece and RelatedOrNotInForce contain Section elements for NOT IN FORCE
    // and RELATED PROVISIONS content in root-level schedules
    for (const key of ["Body", "Order", "BilingualGroup"]) {
      if (obj[key]) {
        const children = Array.isArray(obj[key]) ? obj[key] : [obj[key]];
        for (const child of children) {
          processElement(child, currentScheduleContext);
        }
      }
    }

    // Handle BillPiece and RelatedOrNotInForce specially - they may contain
    // List/FormGroup/TableGroup content directly (not wrapped in Section)
    // When inside a schedule context, also extract any non-Section content
    for (const key of ["BillPiece", "RelatedOrNotInForce"]) {
      if (obj[key]) {
        const children = Array.isArray(obj[key]) ? obj[key] : [obj[key]];
        for (const child of children) {
          if (child && typeof child === "object") {
            const childObj = child as Record<string, unknown>;

            // If we're inside a schedule, extract List/FormGroup/TableGroup content
            if (currentScheduleContext) {
              const listResult = extractScheduleListContent({
                scheduleEl: childObj,
                scheduleContext: currentScheduleContext,
                language,
                actId,
                regulationId,
                startingOrder: sectionOrder,
              });
              sections.push(...listResult.sections);
              definedTerms.push(...listResult.definedTerms);
              crossReferences.push(...listResult.crossReferences);
              sectionOrder = listResult.nextOrder;
            }

            // Then recurse to find Section elements
            processElement(childObj, currentScheduleContext);
          }
        }
      }
    }
  };

  processElement(bodyEl);

  return { sections, definedTerms, crossReferences };
}
