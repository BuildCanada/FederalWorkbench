/**
 * Types for parsed legislation XML data
 */

export type Language = "en" | "fr";

/**
 * A node in the content tree. Represents either text or an element with children.
 * The array order in the database IS the document order.
 * Used in the content_tree JSONB column for order-preserving content storage.
 */
export type ContentNode =
  // Text content
  | { type: "text"; value: string }
  // Defined terms and references
  | { type: "DefinedTermEn"; children: ContentNode[] }
  | { type: "DefinedTermFr"; children: ContentNode[] }
  | { type: "DefinitionRef"; children: ContentNode[] }
  // Cross-references
  | {
      type: "XRefExternal";
      link?: string;
      refType?: string;
      children: ContentNode[];
    }
  | { type: "XRefInternal"; target?: string; children: ContentNode[] }
  // Text formatting
  | {
      type: "Emphasis";
      style?: "italic" | "bold" | "smallcaps";
      children: ContentNode[];
    }
  | { type: "Language"; lang?: string; children: ContentNode[] }
  | { type: "Repealed"; children: ContentNode[] }
  | { type: "FootnoteRef"; id?: string; children: ContentNode[] }
  | { type: "Sup"; children: ContentNode[] }
  | { type: "Sub"; children: ContentNode[] }
  // Additional inline formatting (MathML and formula related)
  | { type: "Superscript"; children: ContentNode[] }
  | { type: "Subscript"; children: ContentNode[] }
  | { type: "Base"; children: ContentNode[] }
  // Inline formatting elements
  | { type: "LineBreak" }
  | { type: "PageBreak" }
  | { type: "FormBlank"; width?: string; children?: ContentNode[] }
  | { type: "Fraction"; children: ContentNode[] }
  | { type: "Numerator"; children: ContentNode[] }
  | { type: "Denominator"; children: ContentNode[] }
  | {
      type: "Leader";
      style?: "solid" | "dot" | "dash" | "none";
      length?: string;
    }
  | { type: "Separator" }
  // Structure elements
  | { type: "Label"; children: ContentNode[] }
  | { type: "Text"; children: ContentNode[] }
  | { type: "Subsection"; children: ContentNode[] }
  | { type: "Paragraph"; children: ContentNode[] }
  | { type: "Subparagraph"; children: ContentNode[] }
  | { type: "Clause"; children: ContentNode[] }
  | { type: "Subclause"; children: ContentNode[] }
  | { type: "Subsubclause"; children: ContentNode[] }
  | { type: "Definition"; children: ContentNode[] }
  | { type: "DefinitionEnOnly"; children: ContentNode[] }
  | { type: "DefinitionFrOnly"; children: ContentNode[] }
  | { type: "List"; style?: string; children: ContentNode[] }
  | { type: "Item"; children: ContentNode[] }
  // Tables (CALS)
  | {
      type: "Table";
      attrs?: Record<string, string>;
      children: ContentNode[];
    }
  | { type: "TableGroup"; children: ContentNode[] }
  | { type: "TGroup"; cols?: number; children: ContentNode[] }
  | { type: "ColSpec"; colName?: string; colWidth?: string }
  | { type: "THead"; children: ContentNode[] }
  | { type: "TBody"; children: ContentNode[] }
  | { type: "TFoot"; children: ContentNode[] }
  | { type: "Row"; children: ContentNode[] }
  | {
      type: "Entry";
      attrs?: Record<string, string>;
      children: ContentNode[];
    }
  // Formulas and math
  | { type: "Formula"; children: ContentNode[] }
  | { type: "FormulaGroup"; children: ContentNode[] }
  | { type: "FormulaText"; children: ContentNode[] }
  | { type: "FormulaConnector"; children: ContentNode[] }
  | { type: "FormulaDefinition"; children: ContentNode[] }
  | { type: "FormulaTerm"; children: ContentNode[] }
  | { type: "FormulaParagraph"; children: ContentNode[] }
  // MathML - stored as raw XML for browser rendering
  | { type: "MathML"; raw: string; display?: "block" | "inline" }
  // Images
  | { type: "ImageGroup"; children: ContentNode[] }
  | { type: "Image"; source?: string }
  | { type: "Caption"; children: ContentNode[] }
  // Bilingual content
  | { type: "BilingualGroup"; children: ContentNode[] }
  | { type: "BilingualItemEn"; children: ContentNode[] }
  | { type: "BilingualItemFr"; children: ContentNode[] }
  // Special content
  | { type: "QuotedText"; children: ContentNode[] }
  | { type: "CenteredText"; children: ContentNode[] }
  | { type: "Continued"; children: ContentNode[] }
  | { type: "ContinuedSubparagraph"; children: ContentNode[] }
  | { type: "ContinuedClause"; children: ContentNode[] }
  | { type: "ContinuedSubclause"; children: ContentNode[] }
  | { type: "ContinuedFormulaParagraph"; children: ContentNode[] }
  | { type: "ContinuedSectionSubsection"; children: ContentNode[] }
  | { type: "ContinuedParagraph"; children: ContentNode[] }
  | { type: "ContinuedDefinition"; children: ContentNode[] }
  | { type: "FormGroup"; children: ContentNode[] }
  | { type: "Oath"; children: ContentNode[] }
  | { type: "ReadAsText"; children: ContentNode[] }
  | { type: "ScheduleFormHeading"; children: ContentNode[] }
  | { type: "Heading"; level?: number; children: ContentNode[] }
  | { type: "LeaderRightJustified"; children: ContentNode[] }
  // Metadata elements (marginal notes, historical notes, footnotes)
  | { type: "MarginalNote"; children: ContentNode[] }
  | { type: "HistoricalNote"; children: ContentNode[] }
  | { type: "HistoricalNoteSubItem"; children: ContentNode[] }
  | {
      type: "Footnote";
      id?: string;
      placement?: string;
      children: ContentNode[];
    }
  // Amending and container elements
  | { type: "SectionPiece"; children: ContentNode[] }
  | { type: "AmendedText"; children: ContentNode[] }
  | { type: "AmendedContent"; children: ContentNode[] }
  | { type: "Reserved"; children: ContentNode[] }
  | { type: "Order"; children: ContentNode[] }
  | { type: "Recommendation"; children: ContentNode[] }
  | { type: "Notice"; children: ContentNode[] }
  // Fallback for unhandled elements
  | { type: "Unknown"; tag: string; children: ContentNode[] };
export type LegislationType = "act" | "regulation";
export type Status = "in-force" | "repealed" | "not-in-force";
export type SectionType =
  | "section"
  | "schedule"
  | "preamble"
  | "enacts"
  | "provision"
  | "heading"
  | "amending"
  | "form";

/**
 * Scope types for defined terms
 * - "act" or "regulation": applies to entire document (e.g., "In this Act,")
 * - "part": applies to a Part (e.g., "In this Part,")
 * - "section": applies to specific section(s)
 */
export type DefinitionScopeType = "act" | "regulation" | "part" | "section";

/**
 * LIMS metadata - Justice Canada tracking information
 */
export type LimsMetadata = {
  fid?: string;
  id?: string;
  enactedDate?: string;
  enactId?: string;
  pitDate?: string;
  currentDate?: string;
  inForceStartDate?: string;
};

/**
 * Bill history information (for statutes)
 */
export type BillHistory = {
  billNumber?: string;
  billOrigin?: string;
  billType?: string;
  parliament?: {
    session?: string;
    number?: string;
    years?: string;
    regnalYear?: string;
    monarch?: string;
  };
  stages?: Array<{
    stage: string;
    date?: string;
  }>;
  refNumber?: string;
  refDateTime?: string;
};

/**
 * Amendment citation information
 */
export type AmendmentInfo = {
  citation: string;
  date?: string;
  link?: string;
};

/**
 * Historical note item (amendment citation)
 */
export type HistoricalNoteItem = {
  text: string;
  type?: string;
  enactedDate?: string;
  inForceStartDate?: string;
  enactId?: string;
};

/**
 * Footnote information
 */
export type FootnoteInfo = {
  id: string;
  label?: string;
  text: string;
  placement?: string;
  status?: string;
};

/**
 * Internal reference within the same document (XRefInternal)
 */
export type InternalReference = {
  targetLabel: string;
  targetId?: string;
  referenceText?: string;
};

/**
 * Content type flags for sections
 * Tracks special content that may need different handling in RAG/display
 */
export type ContentFlags = {
  hasTable?: boolean; // Contains <TableGroup>
  hasFormula?: boolean; // Contains <FormulaGroup> or <MathML>
  hasImage?: boolean; // Contains <ImageGroup>
  imageSources?: string[]; // Array of image source URLs from <Image source="...">
  hasRepealed?: boolean; // Contains <Repealed> text (useful for partial repeals)
  hasEditorialNote?: boolean; // Contains <Note status="editorial"> or <Note status="unofficial">
  hasReserved?: boolean; // Contains <Reserved> placeholder text
  hasExplanatoryNote?: boolean; // Contains <ExplanatoryNote>
  // Medium Priority: Content completeness flags
  hasSignatureBlock?: boolean; // Contains <SignatureBlock> with official signatures
  hasBilingualGroup?: boolean; // Contains <BilingualGroup> with paired EN/FR content
  hasQuotedText?: boolean; // Contains <QuotedText> (quoted legislative text)
  hasReadAsText?: boolean; // Contains <ReadAsText> (amendment read-as provisions)
  hasAmendedText?: boolean; // Contains <AmendedText> (text being amended)
  hasAlternateText?: boolean; // Contains <AlternateText> (accessibility text for images/tables)
  alternateTextContent?: string[]; // Extracted alternate text content for accessibility
  // Lower Priority: Presentation/formatting flags
  hasFormGroup?: boolean; // Contains <FormGroup> with form content
  hasOath?: boolean; // Contains <Oath> element
  hasCaption?: boolean; // Contains <Caption> for tables/images
  inlineFormatting?: InlineFormattingFlags; // Inline formatting elements detected
  tableAttributes?: TableAttributes; // CALS table attributes if table present
  tableHeaderInfo?: TableHeaderInfo[]; // Table header accessibility info
};

/**
 * Regulation maker/order information
 */
export type RegulationMakerInfo = {
  regulationMaker?: string;
  orderNumber?: string;
  orderDate?: string;
};

/**
 * Enabling authority order content
 * Contains the text granting authority to make a regulation
 * (e.g., "Her Excellency the Governor General in Council... pursuant to")
 *
 * NOTE: This type is duplicated in schema.ts due to circular dependency.
 * Keep both definitions in sync.
 */
export type EnablingAuthorityOrder = {
  text: string;
  contentTree?: ContentNode[];
  footnotes?: FootnoteInfo[];
  limsMetadata?: LimsMetadata;
};

/**
 * Publication items specific to regulations (Recommendation/Notice blocks)
 */
export type RegulationPublicationItem = {
  type: "recommendation" | "notice";
  content: string;
  publicationRequirement?: "STATUTORY" | "ADMINISTRATIVE";
  sourceSections?: string[];
  limsMetadata?: LimsMetadata;
  footnotes?: FootnoteInfo[];
};

/**
 * Enabling authority reference (act that authorizes a regulation)
 */
export type EnablingAuthorityInfo = {
  actId: string; // e.g., "A-2", "C-38.8"
  actTitle: string; // e.g., "AERONAUTICS ACT"
};

/**
 * Preamble provision item
 */
export type PreambleProvision = {
  text: string;
  marginalNote?: string;
};

/**
 * Related provision reference
 */
export type RelatedProvisionInfo = {
  label?: string;
  source?: string;
  sections?: string[];
  text?: string;
};

/**
 * Treaty section heading for navigation (Parts, Chapters, Articles)
 */
export type TreatySectionHeading = {
  level: number; // 1 = Part, 2 = Chapter/Article, 3 = Sub-section
  label?: string; // "PART I", "ARTICLE 1"
  title?: string; // "General Provisions"
};

/**
 * Defined term within a treaty
 */
export type TreatyDefinition = {
  term: string;
  definition: string;
};

/**
 * Convention/Agreement/Treaty content
 * Structured representation of international agreements
 */
export type TreatyContent = {
  title?: string; // Main title from first Heading
  preamble?: string; // Preamble text (party names, recitals before PART I)
  sections?: TreatySectionHeading[]; // Section headings for TOC/navigation
  definitions?: TreatyDefinition[]; // Extracted defined terms
  signatureText?: string; // Closing text ("IN WITNESS WHEREOF...")
  text: string; // Full text (required, backward compat)
};

/**
 * Signature line within a SignatureBlock
 * Used for official signatures on treaties, conventions, and agreements
 */
export type SignatureLine = {
  signatureName?: string; // Name of signatory
  signatureTitle?: string; // Title/position of signatory
  signatureDate?: string; // Date signed
  signatureLocation?: string; // Location where signed
};

/**
 * Signature block containing one or more official signatures
 * Appears at the end of treaties, conventions, and official documents
 */
export type SignatureBlock = {
  lines: SignatureLine[];
  witnessClause?: string; // "IN WITNESS WHEREOF..." text
  doneAt?: string; // "Done at [location] on [date]" text
};

/**
 * Table of Provisions entry
 * Navigation aid for acts and regulations
 */
export type TableOfProvisionsEntry = {
  label: string; // Section/Part/Schedule label
  title: string; // Title/description text
  level: number; // Hierarchy level (1=Part, 2=Section, etc.)
};

/**
 * Formatting attributes for provisions and lists
 * Lower Priority (Presentation/formatting)
 */
export type FormattingAttributes = {
  indentLevel?: number; // @indent-level
  firstLineIndent?: string; // @first-line-indent
  subsequentLineIndent?: string; // @subsequent-line-indent
  justification?: "left" | "right" | "center" | "justified"; // @justification
  hyphenation?: boolean; // @hyphenation
  pointSize?: number; // @pointsize
  keepWithNext?: boolean; // @keep-with-next
  keepWithPrevious?: boolean; // @keep-with-previous
  topMarginSpacing?: string; // @topmarginspacing
  bottomMarginSpacing?: string; // @bottommarginspacing
  formatRef?: string; // @format-ref
  listItem?: boolean; // @list-item
  languageAlign?: boolean; // @language-align
  fontStyle?: string; // @font-style (for BilingualItems)
};

/**
 * Leader element types for inline formatting
 */
export type LeaderType = "solid" | "dot" | "dash";

/**
 * Inline formatting elements
 * Lower Priority (Presentation/formatting)
 */
export type InlineFormattingFlags = {
  hasLeader?: boolean; // Contains <Leader>
  leaderTypes?: LeaderType[]; // Types of leaders found
  hasLeaderRightJustified?: boolean; // Contains <LeaderRightJustified>
  hasLineBreak?: boolean; // Contains <LineBreak>
  hasPageBreak?: boolean; // Contains <PageBreak>
  hasFormBlank?: boolean; // Contains <FormBlank>
  formBlankWidths?: string[]; // Widths of form blanks
  hasSeparator?: boolean; // Contains <Separator>
  hasFraction?: boolean; // Contains <Fraction>
  hasIns?: boolean; // Contains <Ins> (insertion markup)
  hasDel?: boolean; // Contains <Del> (deletion markup)
};

/**
 * CALS table attributes
 * Lower Priority (Presentation/formatting)
 */
export type TableAttributes = {
  tabStyle?: string; // @tabstyle
  frame?: "all" | "bottom" | "none" | "sides" | "top" | "topbot"; // @frame
  pgWide?: boolean; // @pgwide - page-wide table
  orientation?: "portrait" | "landscape"; // @orientation
  rowBreak?: string; // @rowbreak
  keepTogether?: boolean; // @keep-together (on tgroup)
};

/**
 * Table header information for accessibility
 */
export type TableHeaderInfo = {
  rowHeader?: boolean; // @rowheader
  thId?: string; // @th-id
  thHeaders?: string; // @th-headers (references to other headers)
};

/**
 * Change tracking (ins/del/off/alt) for amendments
 */
export type ChangeType = "ins" | "del" | "off" | "alt";

/**
 * Parsed Act metadata
 *
 * Each record represents ONE language version of an act.
 * EN and FR are legally distinct official documents with different LIMS IDs,
 * citation formats, and sometimes different dates.
 */
export type ParsedAct = {
  actId: string; // e.g., "A-1"
  language: Language; // "en" or "fr"
  title: string; // Title in this language
  longTitle?: string; // Full formal name in this language
  runningHead?: string; // Short title in this language
  status: Status;
  inForceDate?: string;
  consolidationDate?: string;
  lastAmendedDate?: string;
  enactedDate?: string;
  // Bill metadata
  billOrigin?: string;
  billType?: string;
  hasPreviousVersion?: string;
  // Chapter information
  consolidatedNumber?: string;
  consolidatedNumberOfficial?: "yes" | "no"; // ConsolidatedNumber official attribute
  annualStatuteYear?: string;
  annualStatuteChapter?: string;
  // Short title status
  shortTitleStatus?: "official" | "unofficial"; // ShortTitle status attribute
  // Reversed short title for alphabetical indexes (from lookup.xml)
  reversedShortTitle?: string;
  // Whether this document should be consolidated (from lookup.xml)
  consolidateFlag?: boolean;
  // LIMS tracking (language-specific!)
  limsMetadata?: LimsMetadata;
  billHistory?: BillHistory;
  recentAmendments?: AmendmentInfo[];
  // Preamble text - legally significant introductory text
  preamble?: PreambleProvision[];
  // Related provisions
  relatedProvisions?: RelatedProvisionInfo[];
  // Convention/Agreement/Treaty content
  treaties?: TreatyContent[];
  // Medium Priority: Content completeness
  signatureBlocks?: SignatureBlock[];
  tableOfProvisions?: TableOfProvisionsEntry[];
};

/**
 * Parsed Regulation metadata
 *
 * Each record represents ONE language version of a regulation.
 * EN and FR are legally distinct official documents with different LIMS IDs,
 * citation formats (SOR vs DORS, P.C. vs C.P.), and sometimes different dates.
 */
export type ParsedRegulation = {
  regulationId: string; // normalized form e.g., "SOR-97-175"
  language: Language; // "en" or "fr"
  instrumentNumber: string; // original form e.g., "SOR/97-175" (language-specific format)
  regulationType?: string; // "SOR", "SI", "CRC"
  gazettePart?: string; // "I" or "II"
  title: string; // Title in this language
  longTitle?: string; // Full formal name in this language
  // Reversed short title for alphabetical indexes (from lookup.xml)
  reversedShortTitle?: string;
  // Whether this document should be consolidated (from lookup.xml)
  consolidateFlag?: boolean;
  // Multiple enabling authorities support (regulations can be made under multiple acts)
  enablingAuthorities?: EnablingAuthorityInfo[];
  // Legacy single enabling act fields (for backwards compatibility)
  enablingActId?: string;
  enablingActTitle?: string; // In this language
  status: Status;
  hasPreviousVersion?: string;
  registrationDate?: string;
  consolidationDate?: string;
  lastAmendedDate?: string;
  // LIMS tracking (language-specific!)
  limsMetadata?: LimsMetadata;
  regulationMakerOrder?: RegulationMakerInfo;
  // Enabling authority order text ("Her Excellency the Governor General... pursuant to")
  enablingAuthorityOrder?: EnablingAuthorityOrder;
  recentAmendments?: AmendmentInfo[];
  // Related provisions
  relatedProvisions?: RelatedProvisionInfo[];
  // Convention/Agreement/Treaty content
  treaties?: TreatyContent[];
  // Medium Priority: Content completeness
  signatureBlocks?: SignatureBlock[];
  tableOfProvisions?: TableOfProvisionsEntry[];
  // Recommendation/Notice blocks with publication metadata
  recommendations?: RegulationPublicationItem[];
  notices?: RegulationPublicationItem[];
};

/**
 * Provision heading information
 * Found within Provision elements in schedules/forms (e.g., treaty articles)
 * Contains subsection/topic titles with formatting hints
 */
export type ProvisionHeadingInfo = {
  text: string;
  formatRef?: string;
  limsMetadata?: LimsMetadata;
};

/**
 * Parsed Section content
 */
export type ParsedSection = {
  canonicalSectionId: string; // e.g., "A-1/en/s2"
  sectionLabel: string; // e.g., "2", "3.1", "Schedule I"
  sectionOrder: number;
  language: Language;
  sectionType: SectionType;
  hierarchyPath: string[];
  marginalNote?: string;
  content: string;
  contentTree?: ContentNode[]; // Ordered content tree for rendering (preserves document order)
  status: Status;
  // Section attributes from XML
  xmlType?: string; // "amending", "CIF", etc.
  xmlTarget?: string; // Target reference for amending sections
  // Change tracking for amendments (ins/del/off/alt)
  changeType?: ChangeType;
  inForceStartDate?: string;
  lastAmendedDate?: string;
  enactedDate?: string;
  // LIMS tracking
  limsMetadata?: LimsMetadata;
  // Amendment history
  historicalNotes?: HistoricalNoteItem[];
  // Footnotes
  footnotes?: FootnoteInfo[];
  // Schedule-specific fields
  scheduleId?: string;
  scheduleBilingual?: string;
  scheduleSpanLanguages?: string;
  scheduleOriginatingRef?: string;
  // Provision heading (for provisions in schedules/forms with topic headings)
  provisionHeading?: ProvisionHeadingInfo;
  // Content flags for special content types
  contentFlags?: ContentFlags;
  // Lower Priority: Formatting attributes
  formattingAttributes?: FormattingAttributes;
  // For linking to parent
  actId?: string;
  regulationId?: string;
  // Internal cross-references within the same document
  internalReferences?: InternalReference[] | null;
};

/**
 * Parsed Defined Term
 *
 * Each record represents ONE language version of a term.
 * EN and FR versions are linked via pairedTerm.
 * This matches the leg_defined_terms schema structure.
 */
export type ParsedDefinedTerm = {
  // Language of this term/definition
  language: Language;
  // The term in THIS language (e.g., "quarter" for EN, "trimestre" for FR)
  term: string;
  // Normalized for case-insensitive search
  termNormalized: string;
  // The equivalent term in the OTHER language (extracted from DefinedTermEn/DefinedTermFr in XML)
  // Used for linking EN↔FR versions
  pairedTerm?: string;
  // Definition text in THIS language
  definition: string;
  // Source location
  actId?: string;
  regulationId?: string;
  sectionLabel?: string;
  // Document position for joining with preserved-order content
  definitionOrder?: number;
  // Scope information (language-specific - EN and FR can have different scopes!)
  scopeType: DefinitionScopeType;
  scopeSections?: string[]; // Section labels where definition applies (null = entire doc)
  scopeRawText?: string; // Original scope declaration from XML
  // LIMS tracking
  limsMetadata?: LimsMetadata;
};

/**
 * Parsed Cross Reference
 * Links between legislation documents (acts and regulations)
 */
export type ParsedCrossReference = {
  sourceActId?: string;
  sourceRegulationId?: string;
  sourceSectionLabel?: string;
  targetType: "act" | "regulation";
  targetRef: string; // raw link value (e.g., "C-46", "SOR-2000-1")
  referenceText?: string;
};

/**
 * Complete parsed document
 */
export type ParsedDocument = {
  type: LegislationType;
  language: Language;
  act?: ParsedAct;
  regulation?: ParsedRegulation;
  sections: ParsedSection[];
  definedTerms: ParsedDefinedTerm[];
  crossReferences: ParsedCrossReference[];
};

/**
 * File info for processing
 */
export type LegislationFile = {
  path: string;
  type: LegislationType;
  language: Language;
  id: string; // Act ID or Regulation ID
};
