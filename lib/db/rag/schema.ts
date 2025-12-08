/**
 * RAG Schema
 *
 * Contains all RAG-related tables for parliament and legislation embeddings.
 */

import { type InferSelectModel, sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  varchar,
  vector,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import type {
  AmendmentInfo,
  BillHistory,
  ContentFlags,
  ProvisionHeadingInfo,
  RegulationMakerInfo,
} from "@/lib/db/legislation/schema";

/**
 * Valid source types for legislation resources
 * Used for CHECK constraint and TypeScript type alignment
 */
export const LEG_SOURCE_TYPES = [
  "act",
  "act_section",
  "regulation",
  "regulation_section",
  "defined_term",
  "preamble",
  "treaty",
  "cross_reference",
  "table_of_provisions",
  "signature_block",
  "related_provisions",
  "footnote",
  "schedule",
  "marginal_note",
  "publication_item",
] as const;

export type LegSourceType = (typeof LEG_SOURCE_TYPES)[number];

export const ragSchema = pgSchema("rag");

/**
 * Custom tsvector type for full-text search
 * Used in hybrid search to combine keyword matching with vector similarity
 */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * Resource Metadata Type
 * Stores information about the source document for citations and filtering
 */
export type ResourceMetadata = {
  // Core identity
  sourceType:
    | "bill"
    | "hansard"
    | "committee"
    | "committee_report"
    | "committee_meeting"
    | "vote_question"
    | "vote_member"
    | "vote_party"
    | "politician"
    | "party"
    | "election"
    | "candidacy"
    | "session"
    | "riding";
  // Identifiers
  sourceId: number | string; // FK or natural key for some tables (e.g., core_session.id is string)
  sessionId?: string; // e.g., "45-1"
  chunkIndex?: number; // 0 for metadata chunk, 1+ for text chunks
  language?: "en" | "fr"; // language of the content chunk

  // Bill-specific
  billNumber?: string; // e.g., "C-11", "S-203"
  billTitle?: string; // localized title for display

  // Hansard-specific
  documentId?: number; // hansards_document.id
  statementId?: number; // hansards_statement.id

  // Committee-specific
  committeeId?: number; // committees_committee.id
  committeeSlug?: string;
  meetingNumber?: number; // committees_committeemeeting.number

  // Vote-specific
  voteQuestionId?: number; // bills_votequestion.id (internal DB ID)
  voteNumber?: number; // bills_votequestion.number (used for ourcommons.ca URLs)
  partyId?: number; // core_party.id
  politicianId?: number; // core_politician.id

  // Elections
  electionId?: number; // elections_election.id
  candidacyId?: number; // elections_candidacy.id

  // Geography
  ridingId?: number; // core_riding.id

  // Generic denormalized fields for quick display/filtering
  title?: string;
  nameEn?: string;
  nameFr?: string;
  date?: string; // ISO date where applicable
  result?: string; // vote result code (e.g., 'Y', 'N', 'P', etc.)
  // Geography and people
  ridingNameEn?: string;
  ridingNameFr?: string;
  province?: string; // two-letter province code for ridings
  politicianName?: string;
  speakerNameEn?: string;
  speakerNameFr?: string;
  // Party/committee naming
  partyNameEn?: string;
  partyNameFr?: string;
  partyShortEn?: string;
  partyShortFr?: string;
  committeeNameEn?: string;
  committeeNameFr?: string;
  // Hansard/doc
  docNumber?: string; // hansards_document.number
  // Bill/vote cross-linking and status
  billId?: number; // for vote questions linking back to a bill
  billStatusCode?: string;
  billIntroduced?: string; // ISO date
  billStatusDate?: string; // ISO date
  institution?: "C" | "S"; // House of Commons (C) or Senate (S)
  privateMember?: boolean;
  law?: boolean;
  // Session
  sessionName?: string;
  parliamentnum?: number;
  sessnum?: number;
  // Optional keyword aliases for hybrid retrieval
  keywordsEn?: string[];
  keywordsFr?: string[];
};

/**
 * Parliament Resources Table
 * Stores source content chunks with metadata for filtering and citations
 */
export const parlResources = ragSchema.table(
  "parl_resources",
  {
    id: varchar("id", { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<ResourceMetadata>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // JSONB GIN index for fast containment queries on metadata
    index("parl_resources_metadata_gin").using("gin", table.metadata),
  ]
);

export type ParlResource = InferSelectModel<typeof parlResources>;

/**
 * Parliament Embeddings Table
 * Stores vector embeddings linked to resources for semantic search
 * Includes tsvector for hybrid keyword + semantic search
 */
export const parlEmbeddings = ragSchema.table(
  "parl_embeddings",
  {
    id: varchar("id", { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    resourceId: varchar("resource_id", { length: 191 })
      .references(() => parlResources.id, { onDelete: "cascade" })
      .notNull(),
    content: text("content").notNull(), // denormalized for display in search results
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    // Full-text search vector for hybrid retrieval (keyword + semantic)
    // Uses 'simple' config for language-neutral tokenization (EN/FR)
    tsv: tsvector("tsv"),
  },
  (table) => [
    index("parl_embeddings_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
    // GIN index for fast full-text search
    index("parl_embeddings_tsv_idx").using("gin", table.tsv),
  ]
);

export type ParlEmbedding = InferSelectModel<typeof parlEmbeddings>;

/**
 * Legislation Resource Metadata
 * Fields needed for search filtering and citation building.
 */
export type LegResourceMetadata = {
  // Identity - source types for all legislation content
  sourceType: LegSourceType;
  language: "en" | "fr";
  chunkIndex?: number; // 0 for metadata chunk, 1+ for content chunks

  // Document identifiers
  actId?: string; // e.g., "C-46" for Criminal Code
  regulationId?: string; // e.g., "SOR-86-946"
  documentTitle: string; // e.g., "Criminal Code" or "Code criminel"

  // Section-specific (for act_section/regulation_section)
  sectionId?: string; // FK to legislation.sections.id
  sectionLabel?: string; // e.g., "91", "Schedule I"
  marginalNote?: string; // Short description of section
  sectionStatus?: string; // "in-force", "repealed", "not-in-force", etc.
  sectionType?: string; // "section", "schedule", "preamble", "heading", etc.
  hierarchyPath?: string[]; // e.g., ["Part I", "Division 1", "Subdivision A"]
  contentFlags?: ContentFlags;
  sectionInForceDate?: string; // ISO date when section came into force
  sectionLastAmendedDate?: string; // ISO date when section was last amended (from sections.lastAmendedDate)
  sectionEnactedDate?: string; // ISO date when section was enacted (from sections.enactedDate)
  sectionRole?: string; // Legislative function: "amending", "transitional", "CIF", "CIFnobold", "repeal", "normal" (mapped from sections.xmlType)
  amendmentTarget?: string; // Target reference for amending sections - what is being amended (mapped from sections.xmlTarget). Useful for queries like "what amendments affected section X of Y act"
  historicalNotes?: {
    // Mirrors HistoricalNoteItem from legislation schema
    text: string;
    type?: string;
    enactedDate?: string;
    inForceStartDate?: string;
    enactId?: string;
  }[];

  // Schedule-specific (for sections inside schedules)
  scheduleId?: string; // Schedule ID from XML @id attribute
  scheduleBilingual?: string; // "yes" or "no" - if schedule has bilingual content
  scheduleSpanLanguages?: string; // "yes" or "no" - if schedule spans languages
  scheduleOriginatingRef?: string; // Reference to originating section (e.g., "(Section 2)" or "(Paragraphs 56(1)(a) and (c)...)")

  // Provision heading (for provisions in schedules/forms with topic headings, e.g., treaty articles)
  provisionHeading?: ProvisionHeadingInfo;

  // Internal references within the same document (from XRefInternal XML elements)
  internalReferences?: {
    targetLabel: string; // Label of the target section/provision
    targetId?: string; // XML ID of the target element
    referenceText?: string; // Display text of the reference
  }[];

  // Defined term specific fields
  termId?: string; // FK to legislation.defined_terms.id
  term?: string; // The defined term itself (e.g., "barrier", "obstable")
  termPaired?: string; // The paired term in other language
  scopeType?: string; // "act", "regulation", "part", "section"
  scopeSections?: string[]; // Section scope if applicable
  scopeRawText?: string; // Original scope declaration text (e.g., "The following definitions apply in sections 17 to 19")

  // Act metadata fields
  longTitle?: string;
  reversedShortTitle?: string; // Reversed short title for alphabetical indexes (e.g., "Code, Criminal" instead of "Criminal Code")
  shortTitleStatus?: "official" | "unofficial"; // Whether the short title is official or unofficial
  consolidatedNumberOfficial?: "yes" | "no"; // Whether the consolidated number is official
  status?: string; // "in-force", "repealed", etc.
  inForceDate?: string; // ISO date
  consolidationDate?: string;
  enactedDate?: string;
  billOrigin?: string; // "commons" or "senate"
  runningHead?: string; // Short title used in headers
  billType?: string; // "govt-public", "private", etc.
  lastAmendedDate?: string; // ISO date of last amendment
  consolidatedNumber?: string; // e.g., "A-1", "2019, c. 10"
  annualStatuteYear?: string; // Year from annual statute citation
  annualStatuteChapter?: string; // Chapter from annual statute citation
  billHistory?: BillHistory; // Parliament, stages, assent dates
  // Recent amendments (for searching "acts amended by Bill C-XX")
  recentAmendments?: AmendmentInfo[];
  // Version tracking - indicates if point-in-time historical versions exist
  hasPreviousVersion?: string; // "true" if historical versions available

  // Regulation metadata fields
  instrumentNumber?: string; // e.g., "SOR/86-946"
  regulationType?: string; // "SOR", "SI", "CRC"
  // Multiple enabling authorities (regulations can be made under multiple acts)
  enablingAuthorities?: {
    actId: string;
    actTitle: string;
  }[];
  // Legacy: First enabling act (for backwards compatibility and quick access)
  enablingActId?: string;
  enablingActTitle?: string;
  registrationDate?: string;
  gazettePart?: string; // "I" or "II" (Canada Gazette part)
  regulationMakerOrder?: RegulationMakerInfo; // Who made the regulation and order details

  // Preamble-specific fields
  preambleIndex?: number; // Position in preamble array

  // Treaty-specific fields
  treatyTitle?: string; // Title of the treaty/convention

  // Cross-reference fields
  crossRefId?: string; // FK to legislation.cross_references.id
  targetType?: string; // "act" or "regulation"
  targetRef?: string; // Reference to target document
  targetSectionRef?: string; // Optional section reference
  referenceText?: string; // Display text for the reference
  // Enhanced cross-reference fields (Task 2.1)
  targetActId?: string; // Resolved act ID from targetRef
  targetRegulationId?: string; // Resolved regulation ID from targetRef
  targetSectionId?: string; // Resolved section ID from targetSectionRef
  targetDocumentTitle?: string; // Title of the target document
  targetSnippet?: string; // Snippet of target section content for search

  // Table of provisions fields (batched per document)
  provisionCount?: number; // Number of ToP entries batched in this embedding

  // Signature block fields
  signatureName?: string; // Name of signatory
  signatureTitle?: string; // Title of signatory
  signatureDate?: string; // Date of signature

  // Related provisions fields
  relatedProvisionLabel?: string; // Label from related provision (e.g., "Transitional Provisions")
  relatedProvisionSource?: string; // Source reference
  relatedProvisionSections?: string[]; // Referenced section numbers

  // Footnote fields
  footnoteId?: string; // ID within section (e.g., "fn1", "fn2")
  footnoteLabel?: string; // Display label (e.g., "*", "†", "1")
  footnotePlacement?: string; // "section" or "page"
  footnoteStatus?: string; // "editorial" or "official"

  // Publication item fields (recommendations/notices in regulations)
  publicationType?: "recommendation" | "notice"; // Type of publication item
  publicationRequirement?: "STATUTORY" | "ADMINISTRATIVE"; // Publication requirement
  publicationSourceSections?: string[]; // Sections this relates to
  publicationIndex?: number; // Position in the recommendations/notices array

  // Bilingual pairing (Task 2.3)
  // Links EN/FR versions of the same content for cross-lingual search
  // Format: "{sourceType}:{sourceId}:{pairedLanguage}:{chunkIndex}"
  pairedResourceKey?: string;

  // Embedding model tracking (Task 3.3)
  // Stored in metadata for easy querying without joining embedding table
  embeddingModelVersion?: string;
};

/**
 * Legislation Resources Table
 * Stores content chunks with metadata for citations
 * Mirrors parlResources structure for legislation content
 */
export const legResources = ragSchema.table(
  "leg_resources",
  {
    id: varchar("id", { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    // Unique resource key for deduplication: "{sourceType}:{sourceId}:{language}:{chunkIndex}"
    resourceKey: varchar("resource_key", { length: 255 }).notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<LegResourceMetadata>().notNull(),
    // Denormalized columns for fast filtering (avoids JSONB extraction in queries)
    language: varchar("language", { length: 2 }).notNull(),
    sourceType: varchar("source_type", { length: 30 }).notNull(),
    // Paired resource key linking EN/FR versions (Task 2.3)
    // Format: "{sourceType}:{sourceId}:{pairedLanguage}:{chunkIndex}"
    pairedResourceKey: varchar("paired_resource_key", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Unique constraint to prevent duplicates on concurrent runs or restarts
    unique("leg_resources_resource_key_unique").on(table.resourceKey),
    index("leg_resources_resource_key_idx").on(table.resourceKey),
    // Composite index for common filtering patterns (language + sourceType)
    index("leg_resources_lang_source_idx").on(table.language, table.sourceType),
    // Index for bilingual pairing lookups (Task 2.3)
    index("leg_resources_paired_key_idx").on(table.pairedResourceKey),
    // Single GIN index on metadata for flexible querying
    index("leg_resources_metadata_gin").using("gin", table.metadata),

    // --- Functional indexes for metadata-only searches (Task 3.1) ---
    // Date-based queries: "acts amended in 2023", "legislation enacted before 2020"
    index("leg_resources_last_amended_date_idx").on(
      sql`((${table.metadata}->>'lastAmendedDate'))`
    ),
    index("leg_resources_enacted_date_idx").on(
      sql`((${table.metadata}->>'enactedDate'))`
    ),
    index("leg_resources_in_force_date_idx").on(
      sql`((${table.metadata}->>'inForceDate'))`
    ),
    index("leg_resources_consolidation_date_idx").on(
      sql`((${table.metadata}->>'consolidationDate'))`
    ),
    index("leg_resources_registration_date_idx").on(
      sql`((${table.metadata}->>'registrationDate'))`
    ),
    // Status-based queries: "all in-force acts", "repealed sections"
    index("leg_resources_status_idx").on(sql`((${table.metadata}->>'status'))`),
    index("leg_resources_section_status_idx").on(
      sql`((${table.metadata}->>'sectionStatus'))`
    ),
    // Document-based queries: filter by specific act/regulation
    index("leg_resources_act_id_idx").on(sql`((${table.metadata}->>'actId'))`),
    index("leg_resources_regulation_id_idx").on(
      sql`((${table.metadata}->>'regulationId'))`
    ),
    // Section-based queries: find specific sections
    index("leg_resources_section_label_idx").on(
      sql`((${table.metadata}->>'sectionLabel'))`
    ),
    // Composite index for common hybrid query: status + date (e.g., "in-force acts amended in 2023")
    index("leg_resources_status_amended_idx").on(
      sql`((${table.metadata}->>'status'))`,
      sql`((${table.metadata}->>'lastAmendedDate'))`
    ),

    // CHECK constraint for valid source types (data integrity)
    check(
      "leg_resources_source_type_check",
      sql`${table.sourceType} IN (${sql.raw(LEG_SOURCE_TYPES.map((t) => `'${t}'`).join(", "))})`
    ),
  ]
);

export type LegResource = InferSelectModel<typeof legResources>;

/**
 * Default embedding model identifier
 * Used for tracking which model generated each embedding (Task 3.3)
 */
export const DEFAULT_EMBEDDING_MODEL = "cohere-embed-multilingual-v3.0";

/**
 * Legislation Embeddings Table
 * Stores vector embeddings linked to leg_resources for semantic search
 * Includes tsvector for hybrid keyword + semantic search
 */
export const legEmbeddings = ragSchema.table(
  "leg_embeddings",
  {
    id: varchar("id", { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    resourceId: varchar("resource_id", { length: 191 })
      .references(() => legResources.id, { onDelete: "cascade" })
      .notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    // Full-text search vector for hybrid retrieval (keyword + semantic)
    tsv: tsvector("tsv"),
    chunkIndex: integer("chunk_index").notNull().default(0),
    totalChunks: integer("total_chunks").notNull().default(1),
    // Embedding model version tracking (Task 3.3)
    // Enables model upgrades by filtering records by model version
    embeddingModel: varchar("embedding_model", { length: 100 })
      .notNull()
      .default(DEFAULT_EMBEDDING_MODEL),
  },
  (table) => [
    index("leg_embeddings_resource_id_idx").on(table.resourceId),
    index("leg_embeddings_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
    // GIN index for hybrid keyword search
    index("leg_embeddings_tsv_idx").using("gin", table.tsv),
    // Index for model version queries (Task 3.3)
    // Enables efficient filtering when re-embedding with newer models
    index("leg_embeddings_model_idx").on(table.embeddingModel),
  ]
);

export type LegEmbedding = InferSelectModel<typeof legEmbeddings>;
