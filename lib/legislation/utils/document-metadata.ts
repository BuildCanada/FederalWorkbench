import type {
  AmendmentInfo,
  BillHistory,
  EnablingAuthorityInfo,
  EnablingAuthorityOrder,
  FootnoteInfo,
  FormattingAttributes,
  HistoricalNoteItem,
  LimsMetadata,
  PreambleProvision,
  RegulationMakerInfo,
  RegulationPublicationItem,
  RelatedProvisionInfo,
  SignatureBlock,
  SignatureLine,
  TableOfProvisionsEntry,
} from "../types";
import { parseDate, parseDateElement } from "./dates";
import { extractHeadingComponents } from "./heading";
import { extractLimsMetadata } from "./metadata";
import { extractInternalReferences } from "./references";
import { extractTextContent } from "./text";

/**
 * Extract historical notes from a Section element
 */
export function extractHistoricalNotes(
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
export function extractFootnotes(el: Record<string, unknown>): FootnoteInfo[] {
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
export function extractBillHistory(
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
export function extractRecentAmendments(
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
export function extractRegulationMakerOrder(
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
 * Extract enabling authority order from Order element
 * This is the text granting authority to make a regulation
 * (e.g., "Her Excellency the Governor General in Council... pursuant to")
 */
export function extractEnablingAuthorityOrder(
  regulation: Record<string, unknown>
): EnablingAuthorityOrder | undefined {
  if (!regulation.Order) {
    return;
  }

  const order = regulation.Order as Record<string, unknown>;

  // Extract the text content
  const text = extractTextContent(order);
  if (!text) {
    return;
  }

  // Extract footnotes (statute citations like "S.C. 2018, c. 12, s. 186")
  const footnotes = extractFootnotes(order);

  // Extract LIMS metadata from the Order element
  const limsMetadata = extractLimsMetadata(order);

  return {
    text,
    footnotes: footnotes.length > 0 ? footnotes : undefined,
    limsMetadata,
  };
}

/**
 * Extract multiple enabling authorities from EnablingAuthority element
 * Handles both single and multiple XRefExternal children
 */
export function extractEnablingAuthorities(
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
export function extractPreamble(
  intro: unknown
): PreambleProvision[] | undefined {
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
 * Enacting clause information extracted from Introduction.Enacts
 */
export type EnactingClauseInfo = {
  text: string;
  limsMetadata?: LimsMetadata;
  formattingAttributes?: FormattingAttributes;
  inForceStartDate?: string;
  enactedDate?: string;
};

/**
 * Extract the enacting clause from Introduction.Enacts element
 * The enacting clause is the "Now, therefore, Her Majesty..." text
 * that gives legal authority to the statute
 */
export function extractEnactingClause(
  intro: unknown
): EnactingClauseInfo | undefined {
  if (!intro || typeof intro !== "object") {
    return;
  }

  const introObj = intro as Record<string, unknown>;
  if (!introObj.Enacts) {
    return;
  }

  const enacts = introObj.Enacts as Record<string, unknown>;

  // The Enacts element may contain one or more Provision elements
  const provisionElements = enacts.Provision;
  if (!provisionElements) {
    // If no Provision, try to get text directly from Enacts
    const directText = extractTextContent(enacts);
    if (directText) {
      return {
        text: directText,
        limsMetadata: extractLimsMetadata(enacts),
        inForceStartDate: parseDate(
          enacts["@_lims:inforce-start-date"] as string | undefined
        ),
        enactedDate: parseDate(
          enacts["@_lims:enacted-date"] as string | undefined
        ),
      };
    }
    return;
  }

  // Combine text from all Provision elements (usually just one)
  const provArray = Array.isArray(provisionElements)
    ? provisionElements
    : [provisionElements];

  const texts: string[] = [];
  let formattingAttributes: FormattingAttributes | undefined;
  let limsMetadata: LimsMetadata | undefined;
  let inForceStartDate: string | undefined;
  let enactedDate: string | undefined;

  for (const prov of provArray) {
    if (typeof prov === "object" && prov !== null) {
      const provObj = prov as Record<string, unknown>;
      const text = extractTextContent(provObj);

      if (text) {
        texts.push(text);
      }

      // Capture metadata from first provision
      if (!limsMetadata) {
        limsMetadata = extractLimsMetadata(provObj);
      }
      if (!inForceStartDate) {
        inForceStartDate = parseDate(
          provObj["@_lims:inforce-start-date"] as string | undefined
        );
      }
      if (!enactedDate) {
        enactedDate = parseDate(
          provObj["@_lims:enacted-date"] as string | undefined
        );
      }

      // Capture formatting attributes from first provision
      if (!formattingAttributes) {
        const formatRef = provObj["@_format-ref"] as string | undefined;
        const languageAlign = provObj["@_language-align"] as string | undefined;
        if (formatRef || languageAlign) {
          formattingAttributes = {
            formatRef,
            languageAlign: languageAlign === "yes",
          };
        }
      }
    }
  }

  if (texts.length === 0) {
    return;
  }

  // Also capture LIMS metadata from the Enacts element itself if not from provisions
  if (!limsMetadata) {
    limsMetadata = extractLimsMetadata(enacts);
  }
  if (!inForceStartDate) {
    inForceStartDate = parseDate(
      enacts["@_lims:inforce-start-date"] as string | undefined
    );
  }
  if (!enactedDate) {
    enactedDate = parseDate(
      enacts["@_lims:enacted-date"] as string | undefined
    );
  }

  return {
    text: texts.join(" "),
    limsMetadata,
    formattingAttributes,
    inForceStartDate,
    enactedDate,
  };
}

/**
 * Extract related provisions from RelatedProvisions element
 */
export function extractRelatedProvisions(
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
 * Extract Recommendation/Notice blocks from a regulation
 */
export function extractPublicationItems(
  items: unknown,
  type: "recommendation" | "notice"
): RegulationPublicationItem[] | undefined {
  if (!items) {
    return;
  }

  const arr = Array.isArray(items) ? items : [items];
  const results: RegulationPublicationItem[] = [];

  for (const item of arr) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const obj = item as Record<string, unknown>;
    const content = extractTextContent(obj);
    const publicationRequirement =
      type === "notice"
        ? (obj["@_publication-requirement"] as
            | "STATUTORY"
            | "ADMINISTRATIVE"
            | undefined)
        : undefined;
    const limsMetadata = extractLimsMetadata(obj);
    const footnotes = extractFootnotes(obj);
    const internalRefs = extractInternalReferences(obj);
    const sourceSections = Array.from(
      new Set(internalRefs.map((ref) => ref.targetLabel).filter(Boolean))
    );

    if (
      content ||
      publicationRequirement ||
      limsMetadata ||
      internalRefs.length > 0 ||
      footnotes.length > 0
    ) {
      results.push({
        type,
        content,
        publicationRequirement,
        sourceSections: sourceSections.length > 0 ? sourceSections : undefined,
        limsMetadata,
        footnotes: footnotes.length > 0 ? footnotes : undefined,
      });
    }
  }

  return results.length > 0 ? results : undefined;
}

/**
 * Extract signature blocks from a document
 * SignatureBlocks contain official signatures for treaties/conventions
 */
export function extractSignatureBlocks(
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
export function extractTableOfProvisions(
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
        const { label: labelText, title: titleText } =
          extractHeadingComponents(tp);
        const label = labelText || "";
        // Fall back to full element text if no TitleText
        const title = titleText || extractTextContent(tp);

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
