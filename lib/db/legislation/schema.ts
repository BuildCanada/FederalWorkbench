import type { InferSelectModel } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

export const legislationSchema = pgSchema("legislation");

// Enum for ShortTitle status attribute
export const shortTitleStatusEnum = legislationSchema.enum(
  "short_title_status",
  ["official", "unofficial"]
);

// Enum for ConsolidatedNumber official attribute
export const consolidatedNumberOfficialEnum = legislationSchema.enum(
  "consolidated_number_official",
  ["yes", "no"]
);

/**
 * LIMS metadata - Justice Canada tracking information
 * Common attributes found on XML elements
 */
export type LimsMetadata = {
  fid?: string; // lims:fid - fragment ID
  id?: string; // lims:id - element ID
  enactedDate?: string; // lims:enacted-date
  enactId?: string; // lims:enactId - enactment reference
  pitDate?: string; // lims:pit-date - point in time
  currentDate?: string; // lims:current-date
  inForceStartDate?: string; // lims:inforce-start-date
};

/**
 * Bill history information (for statutes)
 */
export type BillHistory = {
  billNumber?: string; // e.g., "C-81"
  billOrigin?: string; // "commons" or "senate"
  billType?: string; // "govt-public", "private", etc.
  parliament?: {
    session?: string;
    number?: string;
    years?: string;
    regnalYear?: string;
    monarch?: string;
  };
  stages?: Array<{
    stage: string; // "consolidation", "assented-to", etc.
    date?: string;
  }>;
  refNumber?: string;
  refDateTime?: string;
};

/**
 * Amendment citation information
 */
export type AmendmentInfo = {
  citation: string; // e.g., "2024, c. 20, s. 15"
  date?: string;
  link?: string; // e.g., "2024_20"
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
  definitionHtml?: string;
};

/**
 * Convention/Agreement/Treaty content
 * Structured representation of international agreements
 */
export type TreatyContent = {
  title?: string; // Main title from first Heading
  preamble?: string; // Preamble text (party names, recitals before PART I)
  preambleHtml?: string; // Preamble HTML
  sections?: TreatySectionHeading[]; // Section headings for TOC/navigation
  definitions?: TreatyDefinition[]; // Extracted defined terms
  signatureText?: string; // Closing text ("IN WITNESS WHEREOF...")
  signatureTextHtml?: string; // Closing HTML
  text: string; // Full text (required, backward compat)
  textHtml?: string; // Full HTML for display
};

/**
 * Signature line within a SignatureBlock
 */
export type SignatureLine = {
  signatureName?: string;
  signatureTitle?: string;
  signatureDate?: string;
  signatureLocation?: string;
};

/**
 * Signature block containing official signatures
 */
export type SignatureBlock = {
  lines: SignatureLine[];
  witnessClause?: string;
  doneAt?: string;
};

/**
 * Table of Provisions entry for navigation
 */
export type TableOfProvisionsEntry = {
  label: string;
  title: string;
  level: number;
};

/**
 * Acts Table
 * Stores Canadian federal acts metadata
 *
 * Each act has separate records for EN and FR versions.
 * EN and FR are legally distinct official documents with different LIMS IDs,
 * citation formats, and sometimes even different dates.
 */
export const acts = legislationSchema.table(
  "acts",
  {
    id: varchar("id", { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    // Official act identifier from Justice Canada (e.g., "A-1", "C-11")
    actId: varchar("act_id", { length: 50 }).notNull(),
    // Language: "en" or "fr" - each act has separate EN and FR records
    language: varchar("language", { length: 2 }).notNull(),
    // Title in this language
    title: text("title").notNull(),
    // Long title (full formal name) in this language
    longTitle: text("long_title"),
    // Running head (short title used in headers) in this language
    runningHead: text("running_head"),
    // Status: "in-force", "repealed", "not-in-force"
    status: varchar("status", { length: 20 }).notNull().default("in-force"),
    // Date the act came into force
    inForceDate: date("in_force_date", { mode: "string" }),
    // Date of the consolidation (last updated)
    consolidationDate: date("consolidation_date", { mode: "string" }),
    // Date of last amendment (from lims:lastAmendedDate)
    lastAmendedDate: date("last_amended_date", { mode: "string" }),
    // Enacted date (from lims:enacted-date)
    enactedDate: date("enacted_date", { mode: "string" }),
    // Bill metadata (origin, type, parliament info)
    billOrigin: varchar("bill_origin", { length: 20 }), // "commons" or "senate"
    billType: varchar("bill_type", { length: 30 }), // "govt-public", "private", etc.
    hasPreviousVersion: varchar("has_previous_version", { length: 10 }), // "true" or "false"
    // Chapter information (e.g., "A-1", "2019, c. 10")
    consolidatedNumber: varchar("consolidated_number", { length: 50 }),
    consolidatedNumberOfficial: consolidatedNumberOfficialEnum(
      "consolidated_number_official"
    ), // "yes" or "no"
    annualStatuteYear: varchar("annual_statute_year", { length: 20 }),
    annualStatuteChapter: varchar("annual_statute_chapter", { length: 50 }),
    // Short title status
    shortTitleStatus: shortTitleStatusEnum("short_title_status"), // "official" or "unofficial"
    // Reversed short title for alphabetical indexes (from lookup.xml)
    reversedShortTitle: text("reversed_short_title"),
    // Whether this document should be consolidated (from lookup.xml)
    consolidateFlag: boolean("consolidate_flag").default(false),
    // LIMS tracking metadata (Justice Canada internal IDs) - language-specific!
    limsMetadata: jsonb("lims_metadata").$type<LimsMetadata>(),
    // Bill history (parliament, stages, assent dates)
    billHistory: jsonb("bill_history").$type<BillHistory>(),
    // Recent amendments list - language-specific citation formats
    recentAmendments: jsonb("recent_amendments").$type<AmendmentInfo[]>(),
    // Preamble - legally significant introductory text
    preamble: jsonb("preamble").$type<PreambleProvision[]>(),
    // Related provisions (cross-references to related content)
    relatedProvisions:
      jsonb("related_provisions").$type<RelatedProvisionInfo[]>(),
    // Convention/Agreement/Treaty content
    treaties: jsonb("treaties").$type<TreatyContent[]>(),
    // Signature blocks (official signatures on treaties/conventions)
    signatureBlocks: jsonb("signature_blocks").$type<SignatureBlock[]>(),
    // Table of provisions (navigation structure)
    tableOfProvisions: jsonb("table_of_provisions").$type<
      TableOfProvisionsEntry[]
    >(),
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Unique constraint on (actId, language) - one record per language
    unique("acts_act_id_language_unique").on(table.actId, table.language),
    index("acts_act_id_language_idx").on(table.actId, table.language),
    index("acts_status_idx").on(table.status),
    index("acts_language_idx").on(table.language),
  ]
);

export type Act = InferSelectModel<typeof acts>;

/**
 * Regulation maker/order information
 */
export type RegulationMakerInfo = {
  regulationMaker?: string; // e.g., "Governor General in Council"
  orderNumber?: string;
  orderDate?: string;
};

/**
 * Publication items specific to regulations (Recommendation/Notice blocks)
 */
export type RegulationPublicationItem = {
  type: "recommendation" | "notice";
  content: string;
  contentHtml?: string;
  publicationRequirement?: "STATUTORY" | "ADMINISTRATIVE";
  sourceSections?: string[];
  limsMetadata?: LimsMetadata;
  footnotes?: FootnoteInfo[];
};

/**
 * Regulations Table
 * Stores Canadian federal regulations metadata
 *
 * Each regulation has separate records for EN and FR versions.
 * EN and FR are legally distinct official documents with different LIMS IDs,
 * citation formats (SOR vs DORS), and sometimes different dates.
 */
export const regulations = legislationSchema.table(
  "regulations",
  {
    id: varchar("id", { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    // Official regulation identifier (e.g., "SOR-86-946", "C.R.C., c. 10")
    regulationId: varchar("regulation_id", { length: 100 }).notNull(),
    // Language: "en" or "fr" - each regulation has separate EN and FR records
    language: varchar("language", { length: 2 }).notNull(),
    // Instrument number (e.g., "SOR/86-946", "C.R.C., c. 10") - language-specific format
    instrumentNumber: varchar("instrument_number", { length: 100 }).notNull(),
    // Regulation type: "SOR", "SI", "CRC" (from @regulation-type attribute)
    regulationType: varchar("regulation_type", { length: 20 }),
    // Gazette part: "I" or "II" (from @gazette-part attribute)
    gazettePart: varchar("gazette_part", { length: 5 }),
    // Title in this language
    title: text("title").notNull(),
    // Long title (full formal name) in this language
    longTitle: text("long_title"),
    // Reversed short title for alphabetical indexes (from lookup.xml)
    reversedShortTitle: text("reversed_short_title"),
    // Whether this document should be consolidated (from lookup.xml)
    consolidateFlag: boolean("consolidate_flag").default(false),
    // Multiple enabling authorities support (regulations can be made under multiple acts)
    enablingAuthorities: jsonb("enabling_authorities").$type<
      EnablingAuthorityInfo[]
    >(),
    // Legacy: First enabling act reference (for backwards compatibility/quick navigation)
    enablingActId: varchar("enabling_act_id", { length: 50 }),
    enablingActTitle: text("enabling_act_title"),
    // Status
    status: varchar("status", { length: 20 }).notNull().default("in-force"),
    // Version tracking
    hasPreviousVersion: varchar("has_previous_version", { length: 10 }),
    // Date registered in Canada Gazette (from RegistrationDate)
    registrationDate: date("registration_date", { mode: "string" }),
    // Date of consolidation
    consolidationDate: date("consolidation_date", { mode: "string" }),
    // Date of last amendment (from lims:lastAmendedDate)
    lastAmendedDate: date("last_amended_date", { mode: "string" }),
    // LIMS tracking metadata (Justice Canada internal IDs) - language-specific!
    limsMetadata: jsonb("lims_metadata").$type<LimsMetadata>(),
    // Regulation maker/order information - language-specific (P.C. vs C.P.)
    regulationMakerOrder: jsonb(
      "regulation_maker_order"
    ).$type<RegulationMakerInfo>(),
    // Recent amendments list - language-specific citation formats
    recentAmendments: jsonb("recent_amendments").$type<AmendmentInfo[]>(),
    // Related provisions (cross-references to related content)
    relatedProvisions:
      jsonb("related_provisions").$type<RelatedProvisionInfo[]>(),
    // Convention/Agreement/Treaty content
    treaties: jsonb("treaties").$type<TreatyContent[]>(),
    // Recommendation/Notice blocks with publication metadata
    recommendations:
      jsonb("recommendations").$type<RegulationPublicationItem[]>(),
    notices: jsonb("notices").$type<RegulationPublicationItem[]>(),
    // Signature blocks (official signatures on treaties/conventions)
    signatureBlocks: jsonb("signature_blocks").$type<SignatureBlock[]>(),
    // Table of provisions (navigation structure)
    tableOfProvisions: jsonb("table_of_provisions").$type<
      TableOfProvisionsEntry[]
    >(),
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Unique constraint on (regulationId, language) - one record per language
    unique("regulations_regulation_id_language_unique").on(
      table.regulationId,
      table.language
    ),
    index("regulations_regulation_id_language_idx").on(
      table.regulationId,
      table.language
    ),
    index("regulations_enabling_act_id_idx").on(table.enablingActId),
    index("regulations_status_idx").on(table.status),
    index("regulations_language_idx").on(table.language),
  ]
);

export type Regulation = InferSelectModel<typeof regulations>;

/**
 * Historical note item (amendment citation)
 */
export type HistoricalNoteItem = {
  text: string; // e.g., "2024, c. 20, s. 15"
  type?: string; // "original" or undefined
  enactedDate?: string;
  inForceStartDate?: string;
  enactId?: string;
};

/**
 * Footnote information
 */
export type FootnoteInfo = {
  id: string; // Footnote ID for linking
  label?: string;
  text: string;
  placement?: string; // "section" or "page"
  status?: string; // "editorial" or "official"
};

/**
 * Leader element types for inline formatting
 */
export type LeaderType = "solid" | "dot" | "dash";

/**
 * Inline formatting elements
 */
export type InlineFormattingFlags = {
  hasLeader?: boolean;
  leaderTypes?: LeaderType[];
  hasLeaderRightJustified?: boolean;
  hasLineBreak?: boolean;
  hasPageBreak?: boolean;
  hasFormBlank?: boolean;
  formBlankWidths?: string[];
  hasSeparator?: boolean;
  hasFraction?: boolean;
  hasIns?: boolean;
  hasDel?: boolean;
};

/**
 * CALS table attributes
 */
export type TableAttributes = {
  tabStyle?: string;
  frame?: "all" | "bottom" | "none" | "sides" | "top" | "topbot";
  pgWide?: boolean;
  orientation?: "portrait" | "landscape";
  rowBreak?: string;
  keepTogether?: boolean;
};

/**
 * Table header information for accessibility
 */
export type TableHeaderInfo = {
  rowHeader?: boolean;
  thId?: string;
  thHeaders?: string;
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
  hasSignatureBlock?: boolean; // Contains <SignatureBlock>
  hasBilingualGroup?: boolean; // Contains <BilingualGroup>
  hasQuotedText?: boolean; // Contains <QuotedText>
  hasReadAsText?: boolean; // Contains <ReadAsText>
  hasAmendedText?: boolean; // Contains <AmendedText>
  hasAlternateText?: boolean; // Contains <AlternateText>
  alternateTextContent?: string[]; // Extracted alternate text
  // Lower Priority: Presentation/formatting flags
  hasFormGroup?: boolean; // Contains <FormGroup>
  hasOath?: boolean; // Contains <Oath>
  hasCaption?: boolean; // Contains <Caption>
  inlineFormatting?: InlineFormattingFlags;
  tableAttributes?: TableAttributes;
  tableHeaderInfo?: TableHeaderInfo[];
};

/**
 * Formatting attributes for provisions and lists
 */
export type FormattingAttributes = {
  indentLevel?: number;
  firstLineIndent?: string;
  subsequentLineIndent?: string;
  justification?: "left" | "right" | "center" | "justified";
  hyphenation?: boolean;
  pointSize?: number;
  keepWithNext?: boolean;
  keepWithPrevious?: boolean;
  topMarginSpacing?: string;
  bottomMarginSpacing?: string;
  formatRef?: string;
  listItem?: boolean;
  languageAlign?: boolean;
  fontStyle?: string;
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
 * Section type classifications
 */
export type SectionType =
  | "section" // Regular numbered section
  | "schedule" // Schedule content
  | "preamble" // Preamble/introduction text
  | "enacts" // Enacting clause
  | "provision" // General provision (in preamble/order)
  | "heading" // Part/Division heading
  | "amending"; // Amending provision (CIF, transitional)

/**
 * Sections Table
 * Stores actual content sections (bilingual via language column)
 */
export const sections = legislationSchema.table(
  "sections",
  {
    id: varchar("id", { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    // Reference to parent act or regulation (one will be null)
    // FK is composite on (actId, language) / (regulationId, language) - defined in table constraints
    actId: varchar("act_id", { length: 50 }),
    regulationId: varchar("regulation_id", { length: 100 }),
    // Unique identifier for the section (e.g., "A-1/en/s2", "SOR-86-946/fr/s3.1")
    canonicalSectionId: varchar("canonical_section_id", {
      length: 200,
    }).notNull(),
    // Section label (e.g., "2", "3.1", "Schedule I", or full title for stub acts)
    sectionLabel: text("section_label").notNull(),
    // Order for sorting sections
    sectionOrder: integer("section_order").notNull(),
    // Language: "en" or "fr"
    language: varchar("language", { length: 2 }).notNull(),
    // Section type classification
    sectionType: varchar("section_type", { length: 20 }).default("section"),
    // Hierarchy path for navigation (e.g., ["Part I", "Division 1", "Section 2"])
    hierarchyPath: jsonb("hierarchy_path").$type<string[]>(),
    // Marginal note (short description shown beside section)
    marginalNote: text("marginal_note"),
    // Full content of the section
    content: text("content").notNull(),
    // HTML-formatted content (preserving structure like tables, emphasis)
    contentHtml: text("content_html"),
    // Status of this specific section
    status: varchar("status", { length: 20 }).default("in-force"),
    // Section attributes (from XML)
    xmlType: varchar("xml_type", { length: 30 }), // "amending", "CIF", etc.
    xmlTarget: text("xml_target"), // Target reference for amending sections (can be long text)
    // Change tracking for amendments: "ins" (insertion), "del" (deletion), "off" (official), "alt" (alternative)
    changeType: varchar("change_type", { length: 10 }),
    // Date this section came into force (from lims:inforce-start-date)
    inForceStartDate: date("in_force_start_date", { mode: "string" }),
    // Date this section was last amended (from lims:lastAmendedDate)
    lastAmendedDate: date("last_amended_date", { mode: "string" }),
    // Enacted date (from lims:enacted-date on this section)
    enactedDate: date("enacted_date", { mode: "string" }),
    // LIMS tracking metadata for this section
    limsMetadata: jsonb("lims_metadata").$type<LimsMetadata>(),
    // Historical notes (amendment citations)
    historicalNotes: jsonb("historical_notes").$type<HistoricalNoteItem[]>(),
    // Footnotes in this section
    footnotes: jsonb("footnotes").$type<FootnoteInfo[]>(),
    // Internal references within the same document (from XRefInternal)
    internalReferences: jsonb("internal_references").$type<
      InternalReference[]
    >(),
    // Schedule-specific fields (for sectionType='schedule')
    scheduleId: varchar("schedule_id", { length: 50 }), // e.g., "RelatedProvs", "NifProvs"
    scheduleBilingual: varchar("schedule_bilingual", { length: 10 }), // "yes" or "no"
    scheduleSpanLanguages: varchar("schedule_span_languages", { length: 10 }),
    scheduleOriginatingRef: text("schedule_originating_ref"), // e.g., "(Section 2)" or long references like "(Paragraphs 56(1)(a) and (c), section 68...)"
    // Content flags for special content types (tables, formulas, images, partial repeals)
    contentFlags: jsonb("content_flags").$type<ContentFlags>(),
    // Formatting attributes for provisions/lists
    formattingAttributes: jsonb(
      "formatting_attributes"
    ).$type<FormattingAttributes>(),
    // Provision heading (for provisions in schedules/forms with topic headings)
    provisionHeading: jsonb("provision_heading").$type<ProvisionHeadingInfo>(),
    // Timestamp
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Composite FK to acts (actId, language)
    foreignKey({
      columns: [table.actId, table.language],
      foreignColumns: [acts.actId, acts.language],
      name: "sections_act_id_language_fk",
    }).onDelete("cascade"),
    // Composite FK to regulations (regulationId, language)
    foreignKey({
      columns: [table.regulationId, table.language],
      foreignColumns: [regulations.regulationId, regulations.language],
      name: "sections_regulation_id_language_fk",
    }).onDelete("cascade"),
    index("sections_act_id_idx").on(table.actId),
    index("sections_regulation_id_idx").on(table.regulationId),
    uniqueIndex("sections_canonical_section_id_idx").on(
      table.canonicalSectionId
    ),
    index("sections_language_idx").on(table.language),
    index("sections_section_type_idx").on(table.sectionType),
    // Composite index for bilingual toggle query
    index("sections_bilingual_toggle_idx").on(
      table.actId,
      table.sectionLabel,
      table.language
    ),
    index("sections_bilingual_reg_toggle_idx").on(
      table.regulationId,
      table.sectionLabel,
      table.language
    ),
    // GIN index for fast containment queries on content flags
    index("sections_content_flags_gin_idx").using("gin", table.contentFlags),
    // Composite index for efficient section range queries in legislation viewer
    index("sections_act_language_order_idx").on(
      table.actId,
      table.language,
      table.sectionOrder
    ),
    // Composite index for regulation section range queries
    index("sections_reg_language_order_idx").on(
      table.regulationId,
      table.language,
      table.sectionOrder
    ),
  ]
);

export type Section = InferSelectModel<typeof sections>;

/**
 * Defined Terms Table
 * Stores legal definitions for term highlighting and query expansion
 *
 * Each row represents ONE language version of a defined term.
 * EN and FR versions are linked via pairedTermId for fast language toggle.
 * This mirrors how sections handles bilingual content.
 *
 * Definitions can have different scopes:
 * - "act" or "regulation": applies to entire document (e.g., "In this Act,")
 * - "part": applies to a Part (e.g., "In this Part,")
 * - "section": applies to specific section(s) (e.g., "The following definitions apply in sections 17 to 19")
 *
 * Note: EN and FR versions may have different scopes (e.g., FR may include "this section" while EN doesn't)
 */
export const definedTerms = legislationSchema.table(
  "defined_terms",
  {
    id: varchar("id", { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    // Language: "en" or "fr"
    language: varchar("language", { length: 2 }).notNull(),
    // The defined term in THIS language (e.g., "quarter" for EN, "trimestre" for FR)
    term: varchar("term", { length: 255 }).notNull(),
    // Normalized term for case-insensitive search
    termNormalized: varchar("term_normalized", { length: 255 }).notNull(),
    // The equivalent term in the other language (extracted from XML DefinedTermEn/DefinedTermFr)
    // Used for linking EN↔FR versions without needing the paired row to exist yet
    pairedTerm: varchar("paired_term", { length: 255 }),
    // Reference to the other language version of this term (populated after both languages imported)
    pairedTermId: varchar("paired_term_id", { length: 191 }),
    // Definition text in THIS language
    definition: text("definition").notNull(),
    // Source location (where the definition appears)
    actId: varchar("act_id", { length: 50 }),
    regulationId: varchar("regulation_id", { length: 100 }),
    sectionLabel: varchar("section_label", { length: 50 }),
    // Scope: where this definition applies
    // "act" = entire act, "regulation" = entire regulation, "part" = specific part, "section" = specific section(s)
    scopeType: varchar("scope_type", { length: 20 }).notNull().default("act"),
    // Array of section labels where this definition applies (null means entire doc)
    // e.g., ["17", "18", "19"] for "sections 17 to 19"
    scopeSections: jsonb("scope_sections").$type<string[]>(),
    // Original scope declaration text from XML for debugging/display
    // e.g., "The following definitions apply in sections 17 to 19 and 21 to 28."
    scopeRawText: text("scope_raw_text"),
    // LIMS tracking metadata
    limsMetadata: jsonb("lims_metadata").$type<LimsMetadata>(),
    // Timestamp
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Search by normalized term within a language
    index("defined_terms_term_normalized_lang_idx").on(
      table.termNormalized,
      table.language
    ),
    // Fast lookup by act and language
    index("defined_terms_act_id_lang_idx").on(table.actId, table.language),
    // Fast lookup by regulation and language
    index("defined_terms_regulation_id_lang_idx").on(
      table.regulationId,
      table.language
    ),
    // Fast lookup for section-specific terms
    index("defined_terms_act_section_lang_idx").on(
      table.actId,
      table.sectionLabel,
      table.language
    ),
    // Scope type filtering
    index("defined_terms_scope_type_idx").on(table.scopeType),
    // Fast language toggle via paired term ID
    index("defined_terms_paired_term_id_idx").on(table.pairedTermId),
  ]
);

export type DefinedTerm = InferSelectModel<typeof definedTerms>;

/**
 * Cross References Table
 * Stores links between acts and regulations
 * Resolution happens at display time, not import time
 */
export const crossReferences = legislationSchema.table(
  "cross_references",
  {
    id: varchar("id", { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    // Source (where the reference appears)
    sourceActId: varchar("source_act_id", { length: 50 }),
    sourceRegulationId: varchar("source_regulation_id", { length: 100 }),
    sourceSectionLabel: text("source_section_label"),
    // Target (what is being referenced) - raw from XML
    targetType: varchar("target_type", { length: 20 }).notNull(), // "act" or "regulation"
    targetRef: varchar("target_ref", { length: 100 }).notNull(), // Raw link (e.g., "C-46", "SOR-2000-1")
    // Display text for the reference
    referenceText: text("reference_text"),
    // Timestamp
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("cross_references_source_act_id_idx").on(table.sourceActId),
    index("cross_references_source_regulation_id_idx").on(
      table.sourceRegulationId
    ),
    index("cross_references_target_type_idx").on(table.targetType),
    index("cross_references_target_ref_idx").on(table.targetRef),
  ]
);

export type CrossReference = InferSelectModel<typeof crossReferences>;
