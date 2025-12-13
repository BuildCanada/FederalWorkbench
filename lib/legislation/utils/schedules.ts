import type {
  Language,
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
  extractTableAttributes,
  extractTableHeaderInfo,
} from "./content-flags";
import { parseDate } from "./dates";
import { extractFootnotes, extractHistoricalNotes } from "./document-metadata";
import { extractLimsMetadata } from "./metadata";
import {
  extractCrossReferences,
  extractInternalReferences,
} from "./references";
import { extractHtmlContent, extractTextContent } from "./text";

/**
 * Context when processing elements inside a Schedule
 * Tracks schedule metadata to pass to child sections
 */
export type ScheduleContext = {
  scheduleId?: string;
  scheduleBilingual?: string;
  scheduleSpanLanguages?: string;
  scheduleLabel?: string;
  scheduleTitle?: string;
  scheduleOriginatingRef?: string;
  /** Type from ScheduleFormHeading (e.g., "amending" for NOT IN FORCE schedules) */
  scheduleType?: string;
};

/**
 * Extract schedule metadata from a Schedule element
 */
export function extractScheduleContext(
  scheduleEl: Record<string, unknown>
): ScheduleContext {
  const context: ScheduleContext = {};

  // Extract schedule attributes
  context.scheduleId = scheduleEl["@_id"] as string | undefined;
  context.scheduleBilingual = scheduleEl["@_bilingual"] as string | undefined;
  context.scheduleSpanLanguages = scheduleEl["@_spanlanguages"] as
    | string
    | undefined;

  // Extract label, title, originating reference, and type from ScheduleFormHeading
  if (scheduleEl.ScheduleFormHeading) {
    const heading = scheduleEl.ScheduleFormHeading as Record<string, unknown>;
    if (heading.Label) {
      context.scheduleLabel = extractTextContent(heading.Label);
    }
    if (heading.TitleText) {
      context.scheduleTitle = extractTextContent(heading.TitleText);
    }
    // Extract OriginatingRef - e.g., "(Section 2)" or "(Subsections 4(1) and 5(2))"
    if (heading.OriginatingRef) {
      context.scheduleOriginatingRef = extractTextContent(
        heading.OriginatingRef
      );
    }
    // Extract type attribute (e.g., "amending" for NOT IN FORCE schedules)
    context.scheduleType = heading["@_type"] as string | undefined;
  }

  return context;
}

/**
 * Determine section type based on schedule context
 * NOT IN FORCE schedules (NifProvs) contain amending provisions
 */
function getSectionTypeForSchedule(context: ScheduleContext): SectionType {
  const isAmendingSchedule =
    context.scheduleId === "NifProvs" || context.scheduleType === "amending";
  return isAmendingSchedule ? "amending" : "schedule";
}

/**
 * Options for extracting schedule list content
 */
type ExtractScheduleListOptions = {
  scheduleEl: Record<string, unknown>;
  scheduleContext: ScheduleContext;
  language: Language;
  actId?: string;
  regulationId?: string;
  startingOrder?: number;
};

/**
 * Extract content from List/Item elements in a Schedule as pseudo-sections
 * This captures schedule content that doesn't use Section wrappers
 */
export function extractScheduleListContent(
  options: ExtractScheduleListOptions
): {
  sections: ParsedSection[];
  definedTerms: ParsedDefinedTerm[];
  crossReferences: ParsedCrossReference[];
  nextOrder: number;
} {
  const {
    scheduleEl,
    scheduleContext,
    language,
    actId,
    regulationId,
    startingOrder,
  } = options;
  const sections: ParsedSection[] = [];
  const definedTerms: ParsedDefinedTerm[] = [];
  const crossReferences: ParsedCrossReference[] = [];
  let sectionOrder = startingOrder || 0;

  const idBase = actId || regulationId || "unknown";
  // Use scheduleLabel if available, otherwise fall back to scheduleId (e.g., "NifProvs")
  const scheduleLabel =
    scheduleContext.scheduleLabel || scheduleContext.scheduleId || "Schedule";

  // Helper to process List elements recursively
  const processListContent = (
    listEl: Record<string, unknown>,
    hierarchyPath: string[]
  ) => {
    if (!listEl.Item) {
      return;
    }

    const items = Array.isArray(listEl.Item) ? listEl.Item : [listEl.Item];

    for (const item of items) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const itemObj = item as Record<string, unknown>;

      // Get item label if present
      const itemLabel = itemObj.Label
        ? extractTextContent(itemObj.Label)
        : undefined;
      const itemText = extractTextContent(itemObj);

      // Only create a section if there's meaningful content
      if (itemText && itemText.trim().length > 0) {
        sectionOrder++;

        // Create a section label that includes schedule and item info
        const sectionLabel = itemLabel
          ? `${scheduleLabel} Item ${itemLabel}`
          : `${scheduleLabel} Item ${sectionOrder}`;

        // Determine sectionType first for use in canonicalSectionId
        const sectionType = getSectionTypeForSchedule(scheduleContext);

        // Include sectionType and sectionOrder in ID for uniqueness
        const canonicalSectionId = `${idBase}/${language}/${sectionType}/${sectionOrder}/sch-${scheduleLabel.replace(/\s+/g, "-").toLowerCase()}${itemLabel ? `-${itemLabel}` : "-item"}`;

        // Extract metadata
        const inForceStartDate = parseDate(
          itemObj["@_lims:inforce-start-date"] as string | undefined
        );
        const lastAmendedDate = parseDate(
          itemObj["@_lims:lastAmendedDate"] as string | undefined
        );
        const limsMetadata = extractLimsMetadata(itemObj);
        const contentHtml = extractHtmlContent(itemObj);
        const contentFlags = extractContentFlags(itemObj);
        const historicalNotes = extractHistoricalNotes(itemObj);
        const footnotes = extractFootnotes(itemObj);
        const internalReferences = extractInternalReferences(itemObj);

        // Determine status
        let status: Status = "in-force";
        if (itemObj.Repealed) {
          status = "repealed";
        } else if (itemObj["@_in-force"] === "no") {
          status = "not-in-force";
        }

        sections.push({
          canonicalSectionId,
          sectionLabel,
          sectionOrder,
          language,
          sectionType,
          hierarchyPath: [...hierarchyPath],
          marginalNote: undefined,
          content: itemText,
          contentHtml: contentHtml || undefined,
          status,
          inForceStartDate,
          lastAmendedDate,
          limsMetadata,
          historicalNotes:
            historicalNotes.length > 0 ? historicalNotes : undefined,
          footnotes: footnotes.length > 0 ? footnotes : undefined,
          contentFlags,
          internalReferences:
            internalReferences.length > 0 ? internalReferences : null,
          scheduleId: scheduleContext.scheduleId,
          scheduleBilingual: scheduleContext.scheduleBilingual,
          scheduleSpanLanguages: scheduleContext.scheduleSpanLanguages,
          scheduleOriginatingRef: scheduleContext.scheduleOriginatingRef,
          actId,
          regulationId,
        });

        // Extract cross references from this item
        const refs = extractCrossReferences(
          itemObj,
          actId,
          regulationId,
          sectionLabel
        );
        crossReferences.push(...refs);
      }

      // Process nested lists
      if (itemObj.List) {
        const nestedLists = Array.isArray(itemObj.List)
          ? itemObj.List
          : [itemObj.List];
        for (const nestedList of nestedLists) {
          if (nestedList && typeof nestedList === "object") {
            processListContent(nestedList as Record<string, unknown>, [
              ...hierarchyPath,
              itemLabel || `Item ${sectionOrder}`,
            ]);
          }
        }
      }
    }
  };

  // Process top-level List elements in the schedule
  if (scheduleEl.List) {
    const lists = Array.isArray(scheduleEl.List)
      ? scheduleEl.List
      : [scheduleEl.List];
    for (const list of lists) {
      if (list && typeof list === "object") {
        processListContent(list as Record<string, unknown>, [scheduleLabel]);
      }
    }
  }

  // Also process FormGroup elements which may contain schedule content
  if (scheduleEl.FormGroup) {
    const formGroups = Array.isArray(scheduleEl.FormGroup)
      ? scheduleEl.FormGroup
      : [scheduleEl.FormGroup];
    for (const formGroup of formGroups) {
      if (formGroup && typeof formGroup === "object") {
        const fgObj = formGroup as Record<string, unknown>;
        const fgContent = extractTextContent(fgObj);
        const internalReferences = extractInternalReferences(fgObj);
        if (fgContent && fgContent.trim().length > 0) {
          sectionOrder++;
          // Determine sectionType first for use in canonicalSectionId
          const sectionType = getSectionTypeForSchedule(scheduleContext);
          // Include sectionType and sectionOrder in ID for uniqueness
          const canonicalSectionId = `${idBase}/${language}/${sectionType}/${sectionOrder}/sch-${scheduleLabel.replace(/\s+/g, "-").toLowerCase()}-fg`;

          sections.push({
            canonicalSectionId,
            sectionLabel: `${scheduleLabel} Form`,
            sectionOrder,
            language,
            sectionType,
            hierarchyPath: [scheduleLabel],
            content: fgContent,
            contentHtml: extractHtmlContent(fgObj) || undefined,
            status: "in-force",
            contentFlags: extractContentFlags(fgObj),
            internalReferences:
              internalReferences.length > 0 ? internalReferences : null,
            scheduleId: scheduleContext.scheduleId,
            scheduleBilingual: scheduleContext.scheduleBilingual,
            scheduleSpanLanguages: scheduleContext.scheduleSpanLanguages,
            scheduleOriginatingRef: scheduleContext.scheduleOriginatingRef,
            actId,
            regulationId,
          });
        }
      }
    }
  }

  // Process TableGroup elements which contain tabular schedule content
  // (e.g., designation tables, lists of government institutions, tariff schedules)
  if (scheduleEl.TableGroup) {
    const tableGroups = Array.isArray(scheduleEl.TableGroup)
      ? scheduleEl.TableGroup
      : [scheduleEl.TableGroup];
    for (const tableGroup of tableGroups) {
      if (tableGroup && typeof tableGroup === "object") {
        const tgObj = tableGroup as Record<string, unknown>;
        const tgContent = extractTextContent(tgObj);
        if (tgContent && tgContent.trim().length > 0) {
          sectionOrder++;
          // Determine sectionType first for use in canonicalSectionId
          const sectionType = getSectionTypeForSchedule(scheduleContext);
          // Include sectionType and sectionOrder in ID for uniqueness
          const canonicalSectionId = `${idBase}/${language}/${sectionType}/${sectionOrder}/sch-${scheduleLabel.replace(/\s+/g, "-").toLowerCase()}-tbl`;

          // Extract table metadata for enhanced search/display
          const tableAttrs = extractTableAttributes(tgObj);
          const headerInfo = extractTableHeaderInfo(tgObj);
          const contentFlags = extractContentFlags(tgObj) || {};
          contentFlags.hasTable = true;
          if (tableAttrs) {
            contentFlags.tableAttributes = tableAttrs;
          }
          if (headerInfo) {
            contentFlags.tableHeaderInfo = headerInfo;
          }

          // Extract metadata from TableGroup attributes
          const inForceStartDate = parseDate(
            tgObj["@_lims:inforce-start-date"] as string | undefined
          );
          const lastAmendedDate = parseDate(
            tgObj["@_lims:lastAmendedDate"] as string | undefined
          );
          const limsMetadata = extractLimsMetadata(tgObj);
          const internalReferences = extractInternalReferences(tgObj);

          sections.push({
            canonicalSectionId,
            sectionLabel: `${scheduleLabel} Table`,
            sectionOrder,
            language,
            sectionType,
            hierarchyPath: [scheduleLabel],
            content: tgContent,
            contentHtml: extractHtmlContent(tgObj) || undefined,
            status: "in-force",
            inForceStartDate,
            lastAmendedDate,
            limsMetadata,
            contentFlags,
            internalReferences:
              internalReferences.length > 0 ? internalReferences : null,
            scheduleId: scheduleContext.scheduleId,
            scheduleBilingual: scheduleContext.scheduleBilingual,
            scheduleSpanLanguages: scheduleContext.scheduleSpanLanguages,
            scheduleOriginatingRef: scheduleContext.scheduleOriginatingRef,
            actId,
            regulationId,
          });

          // Extract cross references from table content
          const refs = extractCrossReferences(
            tgObj,
            actId,
            regulationId,
            `${scheduleLabel} Table`
          );
          crossReferences.push(...refs);
        }
      }
    }
  }

  // Process DocumentInternal elements which contain treaty/agreement content
  // These have Provision elements with ProvisionHeading for subsection titles
  if (scheduleEl.DocumentInternal) {
    const docInternals = Array.isArray(scheduleEl.DocumentInternal)
      ? scheduleEl.DocumentInternal
      : [scheduleEl.DocumentInternal];

    for (const docInternal of docInternals) {
      if (!docInternal || typeof docInternal !== "object") {
        continue;
      }
      const diObj = docInternal as Record<string, unknown>;

      // Helper to process Provision elements recursively from Group/DocumentInternal
      const processProvisions = (
        container: Record<string, unknown>,
        groupPath: string[]
      ) => {
        // Process direct Provision elements
        if (container.Provision) {
          const provisions = Array.isArray(container.Provision)
            ? container.Provision
            : [container.Provision];

          for (const provision of provisions) {
            if (!provision || typeof provision !== "object") {
              continue;
            }
            const provObj = provision as Record<string, unknown>;
            const provContent = extractTextContent(provObj);
            const innerHtml = extractHtmlContent(provObj);

            // Create section if there's text content OR meaningful HTML content (e.g., images)
            const hasContent =
              (provContent && provContent.trim().length > 0) ||
              (innerHtml && innerHtml.trim().length > 0);

            if (hasContent) {
              sectionOrder++;

              // Get label if present (e.g., "(i)", "(a)", "Section 1")
              const provLabel = provObj.Label
                ? extractTextContent(provObj.Label)
                : undefined;

              const sectionLabel = provLabel
                ? `${scheduleLabel} ${groupPath.join(" ")} ${provLabel}`.trim()
                : `${scheduleLabel} ${groupPath.join(" ")} Provision ${sectionOrder}`.trim();

              // Determine sectionType first for use in canonicalSectionId
              const sectionType = getSectionTypeForSchedule(scheduleContext);
              // Include sectionType and sectionOrder in ID for uniqueness
              const canonicalSectionId = `${idBase}/${language}/${sectionType}/${sectionOrder}/sch-${scheduleLabel.replace(/\s+/g, "-").toLowerCase()}-prov`;

              // Extract metadata
              const inForceStartDate = parseDate(
                provObj["@_lims:inforce-start-date"] as string | undefined
              );
              const lastAmendedDate = parseDate(
                provObj["@_lims:lastAmendedDate"] as string | undefined
              );
              const limsMetadata = extractLimsMetadata(provObj);
              // Wrap the provision in proper HTML structure
              // extractHtmlContent handles child elements, but when called on a Provision
              // as root, we need to wrap it in the provision class ourselves
              // (innerHtml is already computed above for the hasContent check)
              const contentHtml = innerHtml
                ? `<p class="provision">${innerHtml}</p>`
                : undefined;
              const contentFlags = extractContentFlags(provObj);
              const footnotes = extractFootnotes(provObj);
              const internalReferences = extractInternalReferences(provObj);
              const formattingAttributes = extractFormattingAttributes(provObj);
              const provisionHeading = extractProvisionHeading(provObj);

              // Determine status
              let status: Status = "in-force";
              if (provObj["@_in-force"] === "no") {
                status = "not-in-force";
              }

              sections.push({
                canonicalSectionId,
                sectionLabel,
                sectionOrder,
                language,
                sectionType,
                hierarchyPath: [scheduleLabel, ...groupPath],
                content: provContent,
                contentHtml: contentHtml || undefined,
                status,
                inForceStartDate,
                lastAmendedDate,
                limsMetadata,
                footnotes: footnotes.length > 0 ? footnotes : undefined,
                contentFlags,
                formattingAttributes,
                provisionHeading,
                internalReferences:
                  internalReferences.length > 0 ? internalReferences : null,
                scheduleId: scheduleContext.scheduleId,
                scheduleBilingual: scheduleContext.scheduleBilingual,
                scheduleSpanLanguages: scheduleContext.scheduleSpanLanguages,
                scheduleOriginatingRef: scheduleContext.scheduleOriginatingRef,
                actId,
                regulationId,
              });

              // Extract cross references
              const refs = extractCrossReferences(
                provObj,
                actId,
                regulationId,
                sectionLabel
              );
              crossReferences.push(...refs);
            }
          }
        }

        // Recurse into Group elements
        if (container.Group) {
          const groups = Array.isArray(container.Group)
            ? container.Group
            : [container.Group];

          for (const group of groups) {
            if (!group || typeof group !== "object") {
              continue;
            }
            const groupObj = group as Record<string, unknown>;

            // Extract group heading for hierarchy
            let groupHeading = "";
            if (groupObj.GroupHeading) {
              const ghObj = groupObj.GroupHeading as Record<string, unknown>;
              const label = ghObj.Label ? extractTextContent(ghObj.Label) : "";
              const title = ghObj.TitleText
                ? extractTextContent(ghObj.TitleText)
                : "";
              groupHeading = [label, title].filter(Boolean).join(" ");
            }

            processProvisions(groupObj, [
              ...groupPath,
              ...(groupHeading ? [groupHeading] : []),
            ]);
          }
        }
      };

      processProvisions(diObj, []);
    }
  }

  return { sections, definedTerms, crossReferences, nextOrder: sectionOrder };
}
