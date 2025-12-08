/**
 * XML Parser for Canadian Federal Legislation (Acts and Regulations)
 * Parses Justice Canada XML files into structured data
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import type {
  AmendmentInfo,
  BillHistory,
  ChangeType,
  ContentFlags,
  DefinitionScopeType,
  EnablingAuthorityInfo,
  FootnoteInfo,
  FormattingAttributes,
  HistoricalNoteItem,
  InlineFormattingFlags,
  Language,
  LeaderType,
  LegislationType,
  LimsMetadata,
  ParsedAct,
  ParsedCrossReference,
  ParsedDefinedTerm,
  ParsedDocument,
  ParsedRegulation,
  ParsedSection,
  PreambleProvision,
  RegulationMakerInfo,
  RelatedProvisionInfo,
  SectionType,
  SignatureBlock,
  SignatureLine,
  Status,
  TableAttributes,
  TableHeaderInfo,
  TableOfProvisionsEntry,
  TreatyContent,
} from "./types";

// Configure XML parser
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  preserveOrder: false,
  trimValues: true,
  parseAttributeValue: false,
  parseTagValue: false,
});

// Top-level regex patterns for performance
const DATE_YYYYMMDD_REGEX = /^\d{8}$/;
const DATE_YYYY_MM_DD_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const AND_SECTIONS_REGEX =
  /in this section and (?:in )?sections?\s+(.+?)(?:\.|$)/i;
const AND_ARTICLES_REGEX =
  /au présent article et aux articles?\s*(?:à\.?)?\s*([\d\s.,àto-]+)/i;
const SECTIONS_APPLY_REGEX =
  /(?:apply|definitions apply) in sections?\s*(?:to\.?)?\s*([\d\s.,to-]+)/i;
const ARTICLES_APPLY_REGEX =
  /(?:s'appliquent|appliquent)\s*(?:aux|au)\s*articles?\s*(?:à\.?)?\s*([\d\s.,àto-]+)/i;

/**
 * Parse a date from LIMS format (YYYY-MM-DD or YYYYMMDD)
 */
function parseDate(dateStr?: string): string | undefined {
  if (!dateStr) {
    return;
  }
  // Handle YYYYMMDD format
  if (DATE_YYYYMMDD_REGEX.test(dateStr)) {
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  }
  // Already in YYYY-MM-DD format
  if (DATE_YYYY_MM_DD_REGEX.test(dateStr)) {
    return dateStr;
  }
  return;
}

/**
 * Parse a date from XML Date element
 */
function parseDateElement(
  dateEl: { YYYY?: string; MM?: string; DD?: string } | undefined
): string | undefined {
  if (!dateEl?.YYYY) {
    return;
  }
  const yyyy = dateEl.YYYY;
  const mm = (dateEl.MM || "01").padStart(2, "0");
  const dd = (dateEl.DD || "01").padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Determine status from XML attributes
 */
function determineStatus(el: Record<string, unknown>): Status {
  if (el["@_in-force"] === "no") {
    return "not-in-force";
  }
  return "in-force";
}

/**
 * Extract LIMS metadata from XML element attributes
 */
function extractLimsMetadata(
  el: Record<string, unknown>
): LimsMetadata | undefined {
  const fid = el["@_lims:fid"] as string | undefined;
  const id = el["@_lims:id"] as string | undefined;
  const enactedDate = parseDate(
    el["@_lims:enacted-date"] as string | undefined
  );
  const enactId = el["@_lims:enactId"] as string | undefined;
  const pitDate = parseDate(el["@_lims:pit-date"] as string | undefined);
  const currentDate = parseDate(
    el["@_lims:current-date"] as string | undefined
  );
  const inForceStartDate = parseDate(
    el["@_lims:inforce-start-date"] as string | undefined
  );

  if (
    !fid &&
    !id &&
    !enactedDate &&
    !enactId &&
    !pitDate &&
    !currentDate &&
    !inForceStartDate
  ) {
    return;
  }

  return {
    fid,
    id,
    enactedDate,
    enactId,
    pitDate,
    currentDate,
    inForceStartDate,
  };
}

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
 * Extract content flags from a section element
 */
function extractContentFlags(
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

/**
 * Extract historical notes from a Section element
 */
function extractHistoricalNotes(
  sectionEl: Record<string, unknown>
): HistoricalNoteItem[] {
  const notes: HistoricalNoteItem[] = [];

  if (!sectionEl.HistoricalNote) {
    return notes;
  }

  const historicalNote = sectionEl.HistoricalNote as Record<string, unknown>;

  // Check for HistoricalNoteSubItem elements
  if (historicalNote.HistoricalNoteSubItem) {
    const subItems = Array.isArray(historicalNote.HistoricalNoteSubItem)
      ? historicalNote.HistoricalNoteSubItem
      : [historicalNote.HistoricalNoteSubItem];

    for (const item of subItems) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const itemObj = item as Record<string, unknown>;

      const text = extractTextContent(itemObj);
      if (text) {
        notes.push({
          text,
          type: itemObj["@_type"] as string | undefined,
          enactedDate: parseDate(
            itemObj["@_lims:enacted-date"] as string | undefined
          ),
          inForceStartDate: parseDate(
            itemObj["@_lims:inforce-start-date"] as string | undefined
          ),
          enactId: itemObj["@_lims:enactId"] as string | undefined,
        });
      }
    }
  }

  // Also capture direct text content
  const directText = extractTextContent(historicalNote);
  if (directText && notes.length === 0) {
    notes.push({ text: directText });
  }

  return notes;
}

/**
 * Extract footnotes from an element
 */
function extractFootnotes(el: Record<string, unknown>): FootnoteInfo[] {
  const footnotes: FootnoteInfo[] = [];

  const processElement = (obj: unknown) => {
    if (!obj || typeof obj !== "object") {
      return;
    }
    const o = obj as Record<string, unknown>;

    if (o.Footnote) {
      const footnotesArray = Array.isArray(o.Footnote)
        ? o.Footnote
        : [o.Footnote];
      for (const fn of footnotesArray) {
        if (!fn || typeof fn !== "object") {
          continue;
        }
        const fnObj = fn as Record<string, unknown>;

        const id = fnObj["@_id"] as string;
        if (!id) {
          continue;
        }

        const label = fnObj.Label ? extractTextContent(fnObj.Label) : undefined;
        const text = fnObj.Text
          ? extractTextContent(fnObj.Text)
          : extractTextContent(fnObj);

        footnotes.push({
          id,
          label,
          text,
          placement: fnObj["@_placement"] as string | undefined,
          status: fnObj["@_status"] as string | undefined,
        });
      }
    }

    // Recurse into child elements
    for (const [key, value] of Object.entries(o)) {
      if (key.startsWith("@_") || key === "#text" || key === "Footnote") {
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
  return footnotes;
}

/**
 * Extract bill history from Identification element
 */
function extractBillHistory(
  identification: Record<string, unknown>
): BillHistory | undefined {
  const history: BillHistory = {};

  // Bill number
  if (identification.BillNumber) {
    history.billNumber = extractTextContent(identification.BillNumber);
  }

  // Bill ref number
  if (identification.BillRefNumber) {
    const refEl = identification.BillRefNumber as Record<string, unknown>;
    history.refNumber = extractTextContent(refEl);
    history.refDateTime = refEl["@_date-time"] as string | undefined;
  }

  // Parliament info
  if (identification.Parliament) {
    const parl = identification.Parliament as Record<string, unknown>;
    history.parliament = {
      session: parl.Session ? extractTextContent(parl.Session) : undefined,
      number: parl.Number ? extractTextContent(parl.Number) : undefined,
      years: parl["Year-s"] ? extractTextContent(parl["Year-s"]) : undefined,
    };

    // Regnal year info
    if (parl.RegnalYear) {
      const regnal = parl.RegnalYear as Record<string, unknown>;
      history.parliament.regnalYear = regnal["Year-s"]
        ? extractTextContent(regnal["Year-s"])
        : undefined;
      history.parliament.monarch = regnal.Monarch
        ? extractTextContent(regnal.Monarch)
        : undefined;
    }
  }

  // Bill history stages
  if (identification.BillHistory) {
    const billHist = identification.BillHistory as Record<string, unknown>;
    if (billHist.Stages) {
      const stagesArray = Array.isArray(billHist.Stages)
        ? billHist.Stages
        : [billHist.Stages];
      history.stages = [];

      for (const stageEl of stagesArray) {
        if (!stageEl || typeof stageEl !== "object") {
          continue;
        }
        const stage = stageEl as Record<string, unknown>;
        const stageName = stage["@_stage"] as string;
        if (stageName) {
          const dateEl = stage.Date as
            | { YYYY?: string; MM?: string; DD?: string }
            | undefined;
          history.stages.push({
            stage: stageName,
            date: parseDateElement(dateEl),
          });
        }
      }
    }
  }

  // Return undefined if empty
  if (!history.billNumber && !history.parliament && !history.stages?.length) {
    return;
  }

  return history;
}

/**
 * Extract recent amendments from RecentAmendments element
 */
function extractRecentAmendments(
  docEl: Record<string, unknown>
): AmendmentInfo[] | undefined {
  if (!docEl.RecentAmendments) {
    return;
  }

  const recentAmends = docEl.RecentAmendments as Record<string, unknown>;
  if (!recentAmends.Amendment) {
    return;
  }

  const amendments: AmendmentInfo[] = [];
  const amendArray = Array.isArray(recentAmends.Amendment)
    ? recentAmends.Amendment
    : [recentAmends.Amendment];

  for (const amend of amendArray) {
    if (!amend || typeof amend !== "object") {
      continue;
    }
    const amendObj = amend as Record<string, unknown>;

    const citation = amendObj.AmendmentCitation
      ? extractTextContent(amendObj.AmendmentCitation)
      : "";
    const date = amendObj.AmendmentDate
      ? extractTextContent(amendObj.AmendmentDate)
      : undefined;

    // Get link from AmendmentCitation attribute
    let link: string | undefined;
    if (
      amendObj.AmendmentCitation &&
      typeof amendObj.AmendmentCitation === "object"
    ) {
      const citEl = amendObj.AmendmentCitation as Record<string, unknown>;
      link = citEl["@_link"] as string | undefined;
    }

    if (citation) {
      amendments.push({ citation, date, link });
    }
  }

  return amendments.length > 0 ? amendments : undefined;
}

/**
 * Extract regulation maker/order information
 */
function extractRegulationMakerOrder(
  identification: Record<string, unknown>
): RegulationMakerInfo | undefined {
  if (!identification.RegulationMakerOrder) {
    return;
  }

  const rmo = identification.RegulationMakerOrder as Record<string, unknown>;

  const regulationMaker = rmo.RegulationMaker
    ? extractTextContent(rmo.RegulationMaker)
    : undefined;
  const orderNumber = rmo.OrderNumber
    ? extractTextContent(rmo.OrderNumber)
    : undefined;
  const orderDate = rmo.Date
    ? parseDateElement(rmo.Date as { YYYY?: string; MM?: string; DD?: string })
    : undefined;

  if (!regulationMaker && !orderNumber && !orderDate) {
    return;
  }

  return { regulationMaker, orderNumber, orderDate };
}

/**
 * Extract multiple enabling authorities from EnablingAuthority element
 * Handles both single and multiple XRefExternal children
 */
function extractEnablingAuthorities(
  identification: Record<string, unknown>
): EnablingAuthorityInfo[] | undefined {
  if (!identification.EnablingAuthority) {
    return;
  }

  const ea = identification.EnablingAuthority as Record<string, unknown>;
  const authorities: EnablingAuthorityInfo[] = [];

  // Get all XRefExternal elements
  const xrefs = ea.XRefExternal;
  if (!xrefs) {
    return;
  }

  const xrefArray = Array.isArray(xrefs) ? xrefs : [xrefs];

  for (const xref of xrefArray) {
    if (typeof xref === "object" && xref !== null) {
      const xrefObj = xref as Record<string, unknown>;
      const link = xrefObj["@_link"] as string | undefined;
      const title = extractTextContent(xref);

      if (link && title) {
        authorities.push({ actId: link, actTitle: title });
      }
    }
  }

  return authorities.length > 0 ? authorities : undefined;
}

/**
 * Extract preamble provisions from Introduction/Preamble element
 */
function extractPreamble(intro: unknown): PreambleProvision[] | undefined {
  if (!intro || typeof intro !== "object") {
    return;
  }

  const introObj = intro as Record<string, unknown>;
  if (!introObj.Preamble) {
    return;
  }

  const preamble = introObj.Preamble as Record<string, unknown>;
  const provisions: PreambleProvision[] = [];

  // Get Provision elements from Preamble
  const provisionElements = preamble.Provision;
  if (!provisionElements) {
    return;
  }

  const provArray = Array.isArray(provisionElements)
    ? provisionElements
    : [provisionElements];

  for (const prov of provArray) {
    if (typeof prov === "object" && prov !== null) {
      const provObj = prov as Record<string, unknown>;
      const text = extractTextContent(provObj);
      let marginalNote: string | undefined;

      if (provObj.MarginalNote) {
        marginalNote = extractTextContent(provObj.MarginalNote);
      }

      if (text) {
        provisions.push({ text, marginalNote });
      }
    }
  }

  return provisions.length > 0 ? provisions : undefined;
}

/**
 * Extract related provisions from RelatedProvisions element
 */
function extractRelatedProvisions(
  doc: Record<string, unknown>
): RelatedProvisionInfo[] | undefined {
  // Check for RelatedProvisions at various levels
  const relatedProvsEl =
    doc.RelatedProvisions ||
    (doc.Body as Record<string, unknown> | undefined)?.RelatedProvisions;

  if (!relatedProvsEl) {
    return;
  }

  const relatedProvs = relatedProvsEl as Record<string, unknown>;
  const provisions: RelatedProvisionInfo[] = [];

  // Get RelatedProvision elements
  const rpElements = relatedProvs.RelatedProvision;
  if (!rpElements) {
    return;
  }

  const rpArray = Array.isArray(rpElements) ? rpElements : [rpElements];

  for (const rp of rpArray) {
    if (typeof rp === "object" && rp !== null) {
      const rpObj = rp as Record<string, unknown>;
      const label = rpObj["@_label"] as string | undefined;
      const source = rpObj["@_source"] as string | undefined;
      const text = extractTextContent(rpObj);
      let sections: string[] | undefined;

      // Extract section references if present
      if (rpObj.Section) {
        const sectionEls = Array.isArray(rpObj.Section)
          ? rpObj.Section
          : [rpObj.Section];
        sections = sectionEls
          .map((s: unknown) => extractTextContent(s))
          .filter((s) => s);
      }

      if (text || label || source || sections?.length) {
        provisions.push({ label, source, sections, text });
      }
    }
  }

  return provisions.length > 0 ? provisions : undefined;
}

/**
 * Extract Convention/Agreement/Treaty content
 */
function extractTreaties(
  doc: Record<string, unknown>
): TreatyContent[] | undefined {
  const treatyEl = doc.ConventionAgreementTreaty;
  if (!treatyEl) {
    return;
  }

  const treaties: TreatyContent[] = [];
  const treatyArray = Array.isArray(treatyEl) ? treatyEl : [treatyEl];

  for (const treaty of treatyArray) {
    if (typeof treaty === "object" && treaty !== null) {
      const treatyObj = treaty as Record<string, unknown>;
      const title = treatyObj.TitleText
        ? extractTextContent(treatyObj.TitleText)
        : undefined;
      const text = extractTextContent(treatyObj);

      if (text) {
        treaties.push({ title, text });
      }
    }
  }

  return treaties.length > 0 ? treaties : undefined;
}

/**
 * Extract signature blocks from a document
 * SignatureBlocks contain official signatures for treaties/conventions
 */
function extractSignatureBlocks(
  doc: Record<string, unknown>
): SignatureBlock[] | undefined {
  const blocks: SignatureBlock[] = [];

  const findSignatureBlocks = (obj: unknown) => {
    if (!obj || typeof obj !== "object") {
      return;
    }
    const o = obj as Record<string, unknown>;

    if (o.SignatureBlock) {
      const sigBlocks = Array.isArray(o.SignatureBlock)
        ? o.SignatureBlock
        : [o.SignatureBlock];

      for (const block of sigBlocks) {
        if (!block || typeof block !== "object") {
          continue;
        }
        const blockObj = block as Record<string, unknown>;

        const signatureBlock: SignatureBlock = {
          lines: [],
        };

        // Extract witness clause (IN WITNESS WHEREOF...)
        if (blockObj.WitnessClause) {
          signatureBlock.witnessClause = extractTextContent(
            blockObj.WitnessClause
          );
        }

        // Extract "Done at" text
        if (blockObj.DoneAt) {
          signatureBlock.doneAt = extractTextContent(blockObj.DoneAt);
        }

        // Extract signature lines
        if (blockObj.SignatureLine) {
          const sigLines = Array.isArray(blockObj.SignatureLine)
            ? blockObj.SignatureLine
            : [blockObj.SignatureLine];

          for (const line of sigLines) {
            if (!line || typeof line !== "object") {
              continue;
            }
            const lineObj = line as Record<string, unknown>;

            const sigLine: SignatureLine = {};

            if (lineObj.SignatureName) {
              sigLine.signatureName = extractTextContent(lineObj.SignatureName);
            }
            if (lineObj.SignatureTitle) {
              sigLine.signatureTitle = extractTextContent(
                lineObj.SignatureTitle
              );
            }
            if (lineObj.Date) {
              sigLine.signatureDate = parseDateElement(
                lineObj.Date as { YYYY?: string; MM?: string; DD?: string }
              );
            }
            if (lineObj.Location) {
              sigLine.signatureLocation = extractTextContent(lineObj.Location);
            }

            if (sigLine.signatureName || sigLine.signatureTitle) {
              signatureBlock.lines.push(sigLine);
            }
          }
        }

        if (
          signatureBlock.lines.length > 0 ||
          signatureBlock.witnessClause ||
          signatureBlock.doneAt
        ) {
          blocks.push(signatureBlock);
        }
      }
    }

    // Recurse into child elements
    for (const [key, value] of Object.entries(o)) {
      if (key.startsWith("@_") || key === "#text" || key === "SignatureBlock") {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          findSignatureBlocks(item);
        }
      } else {
        findSignatureBlocks(value);
      }
    }
  };

  findSignatureBlocks(doc);
  return blocks.length > 0 ? blocks : undefined;
}

/**
 * Extract table of provisions from a document
 * TableOfProvisions provides a navigation structure for the document
 */
function extractTableOfProvisions(
  doc: Record<string, unknown>
): TableOfProvisionsEntry[] | undefined {
  const entries: TableOfProvisionsEntry[] = [];

  const findTableOfProvisions = (obj: unknown) => {
    if (!obj || typeof obj !== "object") {
      return;
    }
    const o = obj as Record<string, unknown>;

    if (o.TableOfProvisions) {
      const top = o.TableOfProvisions as Record<string, unknown>;

      // TableOfProvisions contains TitleProvision elements
      const processTitleProvision = (
        tp: Record<string, unknown>,
        level: number
      ) => {
        const label = tp.Label ? extractTextContent(tp.Label) : "";
        const title = tp.TitleText
          ? extractTextContent(tp.TitleText)
          : extractTextContent(tp);

        if (label || title) {
          entries.push({
            label: label || "",
            title: title || "",
            level,
          });
        }

        // Handle nested provisions
        if (tp.TitleProvision) {
          const nested = Array.isArray(tp.TitleProvision)
            ? tp.TitleProvision
            : [tp.TitleProvision];
          for (const child of nested) {
            if (child && typeof child === "object") {
              processTitleProvision(
                child as Record<string, unknown>,
                level + 1
              );
            }
          }
        }
      };

      if (top.TitleProvision) {
        const titleProvs = Array.isArray(top.TitleProvision)
          ? top.TitleProvision
          : [top.TitleProvision];
        for (const tp of titleProvs) {
          if (tp && typeof tp === "object") {
            processTitleProvision(tp as Record<string, unknown>, 1);
          }
        }
      }
    }
  };

  findTableOfProvisions(doc);
  return entries.length > 0 ? entries : undefined;
}

/**
 * Extract alternate text content from an element
 * AlternateText provides accessibility descriptions for images/tables
 */
function extractAlternateTextContent(el: Record<string, unknown>): string[] {
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
 * Extract formatting attributes from an element
 * Lower Priority (Presentation/formatting)
 */
function extractFormattingAttributes(
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
 * Extract inline formatting flags from an element
 * Lower Priority (Presentation/formatting)
 */
function extractInlineFormattingFlags(
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
function extractTableAttributes(
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
function extractTableHeaderInfo(
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
 * Extract @change attribute value (ins/del/off/alt)
 */
function extractChangeType(
  el: Record<string, unknown>
): ChangeType | undefined {
  const change = el["@_change"] as string | undefined;
  if (change && ["ins", "del", "off", "alt"].includes(change)) {
    return change as ChangeType;
  }
  return;
}

/**
 * Convert XML element to simple HTML (preserving structure)
 */
function extractHtmlContent(el: unknown): string {
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
        case "TableGroup":
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
              `style="vertical-align: ${escapeHtml(String(itemObj["@_valign"]))}"`
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
              `style="vertical-align: ${escapeHtml(String(itemObj["@_valign"]))}"`
            );
          }
          const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
          html += `<tbody${attrStr}>${extractTableRows(item, false)}</tbody>`;
          break;
        }
        case "row": {
          // Handle row elements that appear directly (not within thead/tbody)
          html += extractTableRow(item, false);
          break;
        }
        case "entry": {
          // Handle entry elements that appear directly (not within row)
          html += extractTableCell(item, false);
          break;
        }
        // List elements
        case "List": {
          const itemObj = item as Record<string, unknown>;
          // Determine list type from attributes
          // The XML doesn't seem to have explicit style="arabic/roman/bullet"
          // but we check for it anyway and default to ul
          const style = itemObj["@_style"] as string | undefined;
          let listTag = "ul";
          let typeAttr = "";
          if (style === "arabic" || style === "decimal") {
            listTag = "ol";
            typeAttr = ' type="1"';
          } else if (style === "lower-roman" || style === "roman") {
            listTag = "ol";
            typeAttr = ' type="i"';
          } else if (style === "upper-roman") {
            listTag = "ol";
            typeAttr = ' type="I"';
          } else if (style === "lower-alpha") {
            listTag = "ol";
            typeAttr = ' type="a"';
          } else if (style === "upper-alpha") {
            listTag = "ol";
            typeAttr = ' type="A"';
          }
          html += `<${listTag}${typeAttr}>${extractListItems(item)}</${listTag}>`;
          break;
        }
        case "Item": {
          // Handle Item elements that appear directly (not within List)
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
        default:
          html += extractHtmlContent(item);
      }
    }
  }

  return html;
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
  if (!el || typeof el !== "object") {
    return "";
  }
  const obj = el as Record<string, unknown>;
  const tag = isHeader ? "th" : "td";
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

/**
 * Normalize regulation ID (SOR/97-175 -> SOR-97-175)
 */
export function normalizeRegulationId(instrumentNumber: string): string {
  // Replace / with - for consistent ID format
  return instrumentNumber.replace(/\//g, "-").replace(/,\s*/g, "_");
}

/**
 * Extract text content from a complex XML element
 */
function extractTextContent(el: unknown): string {
  if (typeof el === "string") {
    return el;
  }
  if (typeof el === "number") {
    return String(el);
  }
  if (!el || typeof el !== "object") {
    return "";
  }

  const obj = el as Record<string, unknown>;

  // If it has #text, use that as base
  let text = typeof obj["#text"] === "string" ? obj["#text"] : "";

  // Recursively extract from child elements
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("@_") || key === "#text") {
      continue;
    }

    if (Array.isArray(value)) {
      text += value.map((v) => extractTextContent(v)).join(" ");
    } else {
      text += extractTextContent(value);
    }
  }

  return text.trim();
}

/**
 * Information about definition scope parsed from XML
 */
type DefinitionScope = {
  scopeType: DefinitionScopeType;
  scopeSections?: string[];
  scopeRawText?: string;
};

/**
 * Context when processing elements inside a Schedule
 * Tracks schedule metadata to pass to child sections
 */
type ScheduleContext = {
  scheduleId?: string;
  scheduleBilingual?: string;
  scheduleSpanLanguages?: string;
  scheduleLabel?: string;
  scheduleTitle?: string;
  scheduleOriginatingRef?: string;
};

/**
 * Parse section ranges from scope text like "sections 17 to 19 and 21 to 28"
 * Also handles concatenated XML text like "sectionsto.73 80" (from XRefInternal elements)
 * Handles both integer sections (17, 18, 19) and decimal sections (90.02, 90.03, etc.)
 */
function parseSectionRange(text: string): string[] {
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
function parseDefinitionScope(
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
function extractDefinedTermFromDefinition(
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

/**
 * Extract cross references from an element
 * Only captures references to other legislation (acts and regulations)
 */
function extractCrossReferences(
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
 * Extract schedule metadata from a Schedule element
 */
function extractScheduleContext(
  scheduleEl: Record<string, unknown>
): ScheduleContext {
  const context: ScheduleContext = {};

  // Extract schedule attributes
  context.scheduleId = scheduleEl["@_id"] as string | undefined;
  context.scheduleBilingual = scheduleEl["@_bilingual"] as string | undefined;
  context.scheduleSpanLanguages = scheduleEl["@_spanlanguages"] as
    | string
    | undefined;

  // Extract label, title, and originating reference from ScheduleFormHeading
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
  }

  return context;
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
function extractScheduleListContent(options: ExtractScheduleListOptions): {
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
  const scheduleLabel = scheduleContext.scheduleLabel || "Schedule";

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

        const canonicalSectionId = `${idBase}/${language}/sch-${scheduleLabel.replace(/\s+/g, "-").toLowerCase()}${itemLabel ? `-${itemLabel}` : `-item-${sectionOrder}`}`;

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

        // Determine status
        let status: "in-force" | "repealed" | "not-in-force" = "in-force";
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
          sectionType: "schedule",
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
        if (fgContent && fgContent.trim().length > 0) {
          sectionOrder++;
          const canonicalSectionId = `${idBase}/${language}/sch-${scheduleLabel.replace(/\s+/g, "-").toLowerCase()}-fg-${sectionOrder}`;

          sections.push({
            canonicalSectionId,
            sectionLabel: `${scheduleLabel} Form`,
            sectionOrder,
            language,
            sectionType: "schedule",
            hierarchyPath: [scheduleLabel],
            content: fgContent,
            contentHtml: extractHtmlContent(fgObj) || undefined,
            status: "in-force",
            contentFlags: extractContentFlags(fgObj),
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
          const canonicalSectionId = `${idBase}/${language}/sch-${scheduleLabel.replace(/\s+/g, "-").toLowerCase()}-tbl-${sectionOrder}`;

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

          sections.push({
            canonicalSectionId,
            sectionLabel: `${scheduleLabel} Table`,
            sectionOrder,
            language,
            sectionType: "schedule",
            hierarchyPath: [scheduleLabel],
            content: tgContent,
            contentHtml: extractHtmlContent(tgObj) || undefined,
            status: "in-force",
            inForceStartDate,
            lastAmendedDate,
            limsMetadata,
            contentFlags,
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

  return { sections, definedTerms, crossReferences, nextOrder: sectionOrder };
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
function parseSections(options: ParseSectionsOptions): {
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
    if (sectionEl.Repealed) {
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
    const canonicalSectionId = effectiveScheduleContext?.scheduleLabel
      ? `${idBase}/${language}/sch-${effectiveScheduleContext.scheduleLabel.replace(/\s+/g, "-").toLowerCase()}/s${label}`
      : `${idBase}/${language}/s${label}`;

    // Determine section type - schedule context takes priority
    let sectionType: SectionType = "section";
    if (effectiveScheduleContext) {
      // If we're inside a schedule, this is a schedule section
      sectionType = "schedule";
    } else {
      const xmlType = sectionEl["@_type"] as string | undefined;
      if (xmlType === "amending" || xmlType === "CIF") {
        sectionType = "amending";
      }
    }

    // Extract additional metadata
    const xmlType = sectionEl["@_type"] as string | undefined;
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
      // Schedule metadata from context
      scheduleId: effectiveScheduleContext?.scheduleId,
      scheduleBilingual: effectiveScheduleContext?.scheduleBilingual,
      scheduleSpanLanguages: effectiveScheduleContext?.scheduleSpanLanguages,
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
        const term = extractDefinedTermFromDefinition({
          defEl: def as Record<string, unknown>,
          language,
          actId,
          regulationId,
          sectionLabel: label,
          scope,
        });
        if (term) {
          definedTerms.push(term);
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
      const term = extractDefinedTermFromDefinition({
        defEl: def as Record<string, unknown>,
        language,
        actId,
        regulationId,
        sectionLabel: label,
        scope,
      });
      if (term) {
        definedTerms.push(term);
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
      let provisionIndex = 0;
      for (const provision of provisions) {
        if (provision && typeof provision === "object") {
          provisionIndex++;
          const provObj = provision as Record<string, unknown>;

          // Generate a label for the provision (they don't have native labels)
          const label =
            provisionIndex === 1
              ? "order"
              : `order-provision-${provisionIndex}`;

          sectionOrder++;

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
          const formattingAttributes = extractFormattingAttributes(provObj);

          const canonicalSectionId = `${idBase}/${language}/${label}`;

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
            const term = extractDefinedTermFromDefinition({
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
            if (term) {
              definedTerms.push(term);
            }
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

/**
 * Parse an Act XML file
 */
export function parseActXml(
  xmlContent: string,
  language: Language
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

  // Extract preamble from Introduction element
  const introduction = statute.Introduction;
  const preamble = extractPreamble(introduction);

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

  return {
    type: "act",
    language,
    act,
    sections,
    definedTerms,
    crossReferences,
  };
}

/**
 * Parse a Regulation XML file
 */
export function parseRegulationXml(
  xmlContent: string,
  language: Language
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

  // Extract recent amendments
  const recentAmendments = extractRecentAmendments(regulation);

  // Extract related provisions
  const relatedProvisions = extractRelatedProvisions(regulation);

  // Extract treaties/conventions
  const treaties = extractTreaties(regulation);

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
    recentAmendments,
    relatedProvisions,
    treaties,
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

  // Create a combined element that includes Body content, root-level Schedules,
  // and Order elements (which contain regulatory authority text)
  const bodySchedules = body.Schedule
    ? Array.isArray(body.Schedule)
      ? body.Schedule
      : [body.Schedule]
    : [];
  const allSchedules = [...bodySchedules, ...rootSchedules];

  const combinedBody = {
    ...body,
    ...(allSchedules.length > 0 ? { Schedule: allSchedules } : {}),
    ...(regulation.Order ? { Order: regulation.Order } : {}),
  };

  const { sections, definedTerms, crossReferences } = parseSections({
    bodyEl: combinedBody,
    language,
    regulationId,
  });

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
 */
export function parseLegislationXml(
  filePath: string,
  language: Language
): ParsedDocument {
  const xmlContent = readFileSync(filePath, "utf-8");

  // Detect type from content
  if (xmlContent.includes("<Statute")) {
    return parseActXml(xmlContent, language);
  }
  if (xmlContent.includes("<Regulation")) {
    return parseRegulationXml(xmlContent, language);
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
