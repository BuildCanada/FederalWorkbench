/**
 * XML Parser for Canadian Federal Legislation (Acts and Regulations)
 * Parses Justice Canada XML files into structured data
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import type {
  Language,
  LegislationType,
  ParsedAct,
  ParsedDocument,
  ParsedRegulation,
} from "./types";
import {
  type ExtractedContent,
  extractAllContent,
  parseFileWithPreservedOrder,
} from "./utils/content-tree";
import { parseDate, parseDateElement } from "./utils/dates";
import {
  extractBillHistory,
  extractEnablingAuthorities,
  extractEnablingAuthorityOrder,
  extractEnactingClause,
  extractPreamble,
  extractPublicationItems,
  extractRecentAmendments,
  extractRegulationMakerOrder,
  extractRelatedProvisions,
  extractSignatureBlocks,
  extractTableOfProvisions,
} from "./utils/document-metadata";
import { normalizeRegulationId as normalizeRegulationIdUtil } from "./utils/ids";
import { determineStatus, extractLimsMetadata } from "./utils/metadata";
import { parseSections } from "./utils/sections";
import { extractTextContent } from "./utils/text";
import { extractTreaties } from "./utils/treaties";

export function normalizeRegulationId(instrumentNumber: string): string {
  return normalizeRegulationIdUtil(instrumentNumber);
}

// Configure XML parser
// Using stopNodes to preserve raw XML for DefinedTermEn/Fr elements.
// This allows us to re-parse them with preserveOrder=true to get correct
// document order for mixed content (e.g., "embryon <Language>in vitro</Language>")
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  preserveOrder: false,
  trimValues: true,
  parseAttributeValue: false,
  parseTagValue: false,
  stopNodes: ["*.DefinedTermEn", "*.DefinedTermFr"],
});

/**
 * Parse an Act XML file
 *
 * @param xmlContent - Raw XML content
 * @param language - Document language
 * @param extractedContent - Pre-extracted content from preserved-order parse (optional for backwards compat)
 */
export function parseActXml(
  xmlContent: string,
  language: Language,
  extractedContent?: ExtractedContent
): ParsedDocument {
  const parsed = parser.parse(xmlContent);
  const statute = parsed.Statute;

  if (!statute) {
    throw new Error("Invalid Act XML: missing Statute element");
  }

  const identification = statute.Identification || {};

  // Extract act ID from Chapter/ConsolidatedNumber
  const chapter = identification.Chapter || {};
  const actId =
    extractTextContent(chapter.ConsolidatedNumber) ||
    extractTextContent(chapter.OfficialNumber);

  if (!actId) {
    throw new Error("Invalid Act XML: missing act ID");
  }

  // Extract titles
  const shortTitle = extractTextContent(identification.ShortTitle);
  const longTitle = extractTextContent(identification.LongTitle);
  const runningHead = extractTextContent(identification.RunningHead);

  // Extract dates
  const inForceDate = parseDate(statute["@_lims:inforce-start-date"]);
  const consolidationDate = parseDate(statute["@_lims:current-date"]);
  const lastAmendedDate = parseDate(statute["@_lims:lastAmendedDate"]);
  const enactedDate = parseDate(statute["@_lims:enacted-date"]);

  // Determine status
  const status = determineStatus(statute);

  // Extract additional metadata from statute attributes
  const billOrigin = statute["@_bill-origin"] as string | undefined;
  const billType = statute["@_bill-type"] as string | undefined;
  const hasPreviousVersion = statute["@_hasPreviousVersion"] as
    | string
    | undefined;

  // Extract chapter info
  const consolidatedNumber = extractTextContent(chapter.ConsolidatedNumber);

  // Extract official markers for title and consolidated number
  const consolidatedNumberObj = chapter.ConsolidatedNumber as
    | Record<string, unknown>
    | undefined;
  const consolidatedNumberOfficialRaw = consolidatedNumberObj?.["@_official"] as
    | string
    | undefined;
  const consolidatedNumberOfficial =
    consolidatedNumberOfficialRaw === "yes" ||
    consolidatedNumberOfficialRaw === "no"
      ? (consolidatedNumberOfficialRaw as "yes" | "no")
      : undefined;

  const shortTitleObj = identification.ShortTitle as
    | Record<string, unknown>
    | undefined;
  const shortTitleStatusRaw = shortTitleObj?.["@_status"] as string | undefined;
  const shortTitleStatus =
    shortTitleStatusRaw === "official" || shortTitleStatusRaw === "unofficial"
      ? (shortTitleStatusRaw as "official" | "unofficial")
      : undefined;

  let annualStatuteYear: string | undefined;
  let annualStatuteChapter: string | undefined;
  if (chapter.AnnualStatuteId) {
    const annualId = chapter.AnnualStatuteId as Record<string, unknown>;
    annualStatuteYear = annualId.YYYY
      ? extractTextContent(annualId.YYYY)
      : undefined;
    annualStatuteChapter = annualId.AnnualStatuteNumber
      ? extractTextContent(annualId.AnnualStatuteNumber)
      : undefined;
  }

  // Extract LIMS metadata
  const limsMetadata = extractLimsMetadata(statute);

  // Extract bill history
  const billHistory = extractBillHistory(identification);

  // Extract recent amendments
  const recentAmendments = extractRecentAmendments(statute);

  // Extract preamble and enacting clause from Introduction element
  const introduction = statute.Introduction;
  const preamble = extractPreamble(introduction);
  const enactingClause = extractEnactingClause(introduction);

  // Extract related provisions
  const relatedProvisions = extractRelatedProvisions(statute);

  // Extract treaties/conventions
  const treaties = extractTreaties(statute);

  // Medium Priority: Extract signature blocks and table of provisions
  const signatureBlocks = extractSignatureBlocks(statute);
  const tableOfProvisions = extractTableOfProvisions(statute);

  const act: ParsedAct = {
    actId,
    language,
    title: shortTitle,
    longTitle: longTitle || undefined,
    runningHead: runningHead || undefined,
    status,
    inForceDate,
    consolidationDate,
    lastAmendedDate,
    enactedDate,
    billOrigin,
    billType,
    hasPreviousVersion,
    consolidatedNumber,
    consolidatedNumberOfficial,
    annualStatuteYear,
    annualStatuteChapter,
    shortTitleStatus,
    limsMetadata,
    billHistory,
    recentAmendments,
    preamble,
    relatedProvisions,
    treaties,
    signatureBlocks,
    tableOfProvisions,
  };

  // Parse sections from Body and root-level Schedule elements
  // Root-level Schedule elements (e.g., NOT IN FORCE/RELATED PROVISIONS, designation tables)
  // are direct children of Statute, not inside Body, so we need to process them separately
  const body = statute.Body || {};
  const rootSchedules = statute.Schedule
    ? Array.isArray(statute.Schedule)
      ? statute.Schedule
      : [statute.Schedule]
    : [];

  // Create a combined element that includes Body content and root-level Schedules
  // This allows parseSections to process all content uniformly
  const bodySchedules = body.Schedule
    ? Array.isArray(body.Schedule)
      ? body.Schedule
      : [body.Schedule]
    : [];
  const allSchedules = [...bodySchedules, ...rootSchedules];

  const combinedBody = {
    ...body,
    // Add all schedules (from Body and root-level) if any exist
    ...(allSchedules.length > 0 ? { Schedule: allSchedules } : {}),
  };

  const { sections, definedTerms, crossReferences } = parseSections({
    bodyEl: combinedBody,
    language,
    actId,
  });

  // Prepend enacting clause as its own section if present
  // This allows the operative "Now, therefore, Her Majesty... enacts as follows:" text to be queryable
  const allSections = [...sections];
  if (enactingClause) {
    const enactsSection = {
      canonicalSectionId: `${actId}/${language}/enacts/0/clause`,
      sectionLabel: "Enacting Clause",
      sectionOrder: 0, // Before all body sections
      language,
      sectionType: "enacts" as const,
      hierarchyPath: [],
      marginalNote: undefined,
      content: enactingClause.text,
      status: "in-force" as const,
      inForceStartDate: enactingClause.inForceStartDate,
      enactedDate: enactingClause.enactedDate,
      limsMetadata: enactingClause.limsMetadata,
      formattingAttributes: enactingClause.formattingAttributes,
      actId,
      regulationId: undefined,
    };
    allSections.unshift(enactsSection);
  }

  // Join extracted content by position to populate contentTree, hierarchyPath, and corrected content
  if (extractedContent) {
    // Build lookup maps for efficient joining - keyed by document position, not limsId
    const contentTreeMap = new Map(
      extractedContent.contentTrees
        .filter((ct) => ct.limsId)
        .map((ct) => [ct.limsId, ct])
    );
    // Section content map keyed by sectionOrder (position in document)
    const sectionContentByOrder = new Map(
      extractedContent.sectionContents.map((sc) => [sc.sectionOrder, sc])
    );
    // Definition text map keyed by definitionOrder (position in document)
    const definitionTextByOrder = new Map(
      extractedContent.definitionTexts.map((dt) => [dt.definitionOrder, dt])
    );

    // Join ALL sections by sectionOrder (position-based, not limsId-gated)
    for (const section of allSections) {
      // Content tree still uses limsId for now (hierarchy path)
      const limsId = section.limsMetadata?.id;
      if (limsId) {
        const contentTree = contentTreeMap.get(limsId);
        if (contentTree) {
          section.contentTree = contentTree.contentTree;
          section.hierarchyPath = contentTree.hierarchyPath;
        }
      }
      // Section content uses position-based joining
      const sectionContent = sectionContentByOrder.get(section.sectionOrder);
      if (sectionContent) {
        section.content = sectionContent.content;
        if (sectionContent.marginalNote) {
          section.marginalNote = sectionContent.marginalNote;
        }
      }
    }

    // Join ALL defined terms by definitionOrder (position-based)
    for (const term of definedTerms) {
      if (term.definitionOrder !== undefined) {
        const definitionText = definitionTextByOrder.get(term.definitionOrder);
        if (definitionText) {
          term.definition = definitionText.definitionText;
        }
      }
    }

    // Use preserved-order preamble if available
    if (extractedContent.preamble) {
      act.preamble = extractedContent.preamble;
    }

    // Use preserved-order treaties if available
    if (extractedContent.treaties) {
      act.treaties = extractedContent.treaties;
    }
  }

  return {
    type: "act",
    language,
    act,
    sections: allSections,
    definedTerms,
    crossReferences,
  };
}

/**
 * Parse a Regulation XML file
 *
 * @param xmlContent - Raw XML content
 * @param language - Document language
 * @param extractedContent - Pre-extracted content from preserved-order parse (optional for backwards compat)
 */
export function parseRegulationXml(
  xmlContent: string,
  language: Language,
  extractedContent?: ExtractedContent
): ParsedDocument {
  const parsed = parser.parse(xmlContent);
  const regulation = parsed.Regulation;

  if (!regulation) {
    throw new Error("Invalid Regulation XML: missing Regulation element");
  }

  const identification = regulation.Identification || {};

  // Extract instrument number
  const instrumentNumber = extractTextContent(identification.InstrumentNumber);
  if (!instrumentNumber) {
    throw new Error("Invalid Regulation XML: missing instrument number");
  }

  const regulationId = normalizeRegulationId(instrumentNumber);
  const regulationType = regulation["@_regulation-type"] as string | undefined;
  const gazettePart = regulation["@_gazette-part"] as string | undefined;
  const hasPreviousVersion = regulation["@_hasPreviousVersion"] as
    | string
    | undefined;

  // Extract titles
  const shortTitle = extractTextContent(identification.ShortTitle);
  const longTitle = extractTextContent(identification.LongTitle);
  const title = shortTitle || longTitle;

  // Extract enabling authority
  // Extract all enabling authorities (regulations can be made under multiple acts)
  const enablingAuthorities = extractEnablingAuthorities(identification);
  // Legacy: First enabling act for backwards compatibility
  const enablingActId = enablingAuthorities?.[0]?.actId;
  const enablingActTitle = enablingAuthorities?.[0]?.actTitle;

  // Extract dates
  const consolidationDate = parseDateElement(
    identification.ConsolidationDate?.Date
  );
  const registrationDate = parseDateElement(
    identification.RegistrationDate?.Date
  );
  const lastAmendedDate = parseDate(regulation["@_lims:lastAmendedDate"]);

  // Determine status
  const status = determineStatus(regulation);

  // Extract LIMS metadata
  const limsMetadata = extractLimsMetadata(regulation);

  // Extract regulation maker/order info
  const regulationMakerOrder = extractRegulationMakerOrder(identification);

  // Extract enabling authority order (text, footnotes, limsMetadata from standard parse)
  const baseEnablingAuthorityOrder = extractEnablingAuthorityOrder(regulation);
  // Merge with contentTree from preserved-order extraction for proper rendering
  const enablingAuthorityOrder = baseEnablingAuthorityOrder
    ? {
        ...baseEnablingAuthorityOrder,
        contentTree: extractedContent?.enablingAuthorityOrder?.contentTree,
      }
    : undefined;

  // Extract recent amendments
  const recentAmendments = extractRecentAmendments(regulation);

  // Extract related provisions
  const relatedProvisions = extractRelatedProvisions(regulation);

  // Extract treaties/conventions
  const treaties = extractTreaties(regulation);

  // Extract Recommendation/Notice blocks (publication requirements)
  const recommendations = extractPublicationItems(
    regulation.Recommendation,
    "recommendation"
  );
  const notices = extractPublicationItems(regulation.Notice, "notice");

  // Medium Priority: Extract signature blocks and table of provisions
  const signatureBlocks = extractSignatureBlocks(regulation);
  const tableOfProvisions = extractTableOfProvisions(regulation);

  const reg: ParsedRegulation = {
    regulationId,
    language,
    instrumentNumber,
    regulationType: regulationType ? String(regulationType) : undefined,
    gazettePart,
    title,
    longTitle: longTitle || undefined,
    enablingAuthorities,
    enablingActId,
    enablingActTitle: enablingActTitle || undefined,
    status,
    hasPreviousVersion,
    registrationDate,
    consolidationDate,
    lastAmendedDate,
    limsMetadata,
    regulationMakerOrder,
    enablingAuthorityOrder,
    recentAmendments,
    relatedProvisions,
    treaties,
    recommendations,
    notices,
    signatureBlocks,
    tableOfProvisions,
  };

  // Parse sections from Body and root-level Schedule elements
  // Root-level Schedule elements are direct children of Regulation, not inside Body
  const body = regulation.Body || {};
  const rootSchedules = regulation.Schedule
    ? Array.isArray(regulation.Schedule)
      ? regulation.Schedule
      : [regulation.Schedule]
    : [];

  // Create a combined element that includes Body content and root-level Schedules
  // Note: Order elements (enabling authority text) are extracted as metadata, not sections
  const bodySchedules = body.Schedule
    ? Array.isArray(body.Schedule)
      ? body.Schedule
      : [body.Schedule]
    : [];
  const allSchedules = [...bodySchedules, ...rootSchedules];

  const combinedBody = {
    ...body,
    ...(allSchedules.length > 0 ? { Schedule: allSchedules } : {}),
  };

  const { sections, definedTerms, crossReferences } = parseSections({
    bodyEl: combinedBody,
    language,
    regulationId,
  });

  // Join extracted content by position to populate contentTree, hierarchyPath, and corrected content
  if (extractedContent) {
    // Build lookup maps for efficient joining - keyed by document position, not limsId
    const contentTreeMap = new Map(
      extractedContent.contentTrees
        .filter((ct) => ct.limsId)
        .map((ct) => [ct.limsId, ct])
    );
    // Section content map keyed by sectionOrder (position in document)
    const sectionContentByOrder = new Map(
      extractedContent.sectionContents.map((sc) => [sc.sectionOrder, sc])
    );
    // Definition text map keyed by definitionOrder (position in document)
    const definitionTextByOrder = new Map(
      extractedContent.definitionTexts.map((dt) => [dt.definitionOrder, dt])
    );

    // Join ALL sections by sectionOrder (position-based, not limsId-gated)
    for (const section of sections) {
      // Content tree still uses limsId for now (hierarchy path)
      const limsId = section.limsMetadata?.id;
      if (limsId) {
        const contentTree = contentTreeMap.get(limsId);
        if (contentTree) {
          section.contentTree = contentTree.contentTree;
          section.hierarchyPath = contentTree.hierarchyPath;
        }
      }
      // Section content uses position-based joining
      const sectionContent = sectionContentByOrder.get(section.sectionOrder);
      if (sectionContent) {
        section.content = sectionContent.content;
        if (sectionContent.marginalNote) {
          section.marginalNote = sectionContent.marginalNote;
        }
      }
    }

    // Join ALL defined terms by definitionOrder (position-based)
    for (const term of definedTerms) {
      if (term.definitionOrder !== undefined) {
        const definitionText = definitionTextByOrder.get(term.definitionOrder);
        if (definitionText) {
          term.definition = definitionText.definitionText;
        }
      }
    }

    // Use preserved-order treaties if available
    if (extractedContent.treaties) {
      reg.treaties = extractedContent.treaties;
    }
  }

  return {
    type: "regulation",
    language,
    regulation: reg,
    sections,
    definedTerms,
    crossReferences,
  };
}

/**
 * Parse a legislation XML file (auto-detect type)
 *
 * This function performs TWO parses of the XML file:
 * 1. Standard parse (preserveOrder=false) - for structure and metadata extraction
 * 2. Preserved-order parse (preserveOrder=true) - for content with correct text order
 *
 * The preserved-order content is joined with sections by limsId to populate:
 * - contentTree: JSONB structure for rendering
 * - hierarchyPath: Section location in document structure
 * - content: Plain text with correct order (replaces garbled text)
 * - preamble/treaties: On act/regulation objects
 * - definition text: On defined terms
 */
export function parseLegislationXml(
  filePath: string,
  language: Language
): ParsedDocument {
  const xmlContent = readFileSync(filePath, "utf-8");

  // Parse with preserved order for content extraction
  const preservedParsed = parseFileWithPreservedOrder(filePath);
  const extractedContent = extractAllContent(preservedParsed);

  // Detect type from content and parse with standard parser
  if (xmlContent.includes("<Statute")) {
    return parseActXml(xmlContent, language, extractedContent);
  }
  if (xmlContent.includes("<Regulation")) {
    return parseRegulationXml(xmlContent, language, extractedContent);
  }

  throw new Error(`Unknown document type in ${filePath}`);
}

/**
 * Get legislation files from the laws-lois-xml directory
 *
 * @param basePath - Base path to the laws-lois-xml directory
 * @param type - Optional type filter ("act" or "regulation")
 * @param limit - Optional limit on number of files
 * @param language - Optional language filter ("en" or "fr")
 */
export function getLegislationFiles(
  basePath: string,
  type?: LegislationType,
  limit?: number,
  language?: Language
): { path: string; type: LegislationType; language: Language; id: string }[] {
  const files: {
    path: string;
    type: LegislationType;
    language: Language;
    id: string;
  }[] = [];

  const paths: {
    dir: string;
    type: LegislationType;
    language: Language;
  }[] = [];

  // English paths
  if ((!language || language === "en") && (!type || type === "act")) {
    paths.push({ dir: `${basePath}/eng/acts`, type: "act", language: "en" });
  }
  if ((!language || language === "en") && (!type || type === "regulation")) {
    paths.push({
      dir: `${basePath}/eng/regulations`,
      type: "regulation",
      language: "en",
    });
  }

  // French paths
  if ((!language || language === "fr") && (!type || type === "act")) {
    paths.push({ dir: `${basePath}/fra/lois`, type: "act", language: "fr" });
  }
  if ((!language || language === "fr") && (!type || type === "regulation")) {
    paths.push({
      dir: `${basePath}/fra/reglements`,
      type: "regulation",
      language: "fr",
    });
  }

  for (const { dir, type: docType, language: lang } of paths) {
    if (!existsSync(dir)) {
      continue;
    }

    const xmlFiles = readdirSync(dir).filter((f) => f.endsWith(".xml"));

    for (const file of xmlFiles) {
      if (limit && files.length >= limit) {
        break;
      }

      const id = file.replace(".xml", "");
      files.push({
        path: `${dir}/${file}`,
        type: docType,
        language: lang,
        id,
      });
    }
  }

  return files;
}
