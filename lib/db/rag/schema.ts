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
  contentFlags?: {
    // Mirrors ContentFlags from legislation schema
    hasTable?: boolean;
    hasFormula?: boolean;
    hasImage?: boolean;
    imageSources?: string[];
    hasRepealed?: boolean;
  };
  sectionInForceDate?: string; // ISO date when section came into force
  historicalNotes?: {
    // Mirrors HistoricalNoteItem from legislation schema
    text: string;
    type?: string;
    enactedDate?: string;
    inForceStartDate?: string;
    enactId?: string;
  }[];

  // Defined term specific fields
  termId?: string; // FK to legislation.defined_terms.id
  term?: string; // The defined term itself (e.g., "barrier", "obstable")
  termPaired?: string; // The paired term in other language
  scopeType?: string; // "act", "regulation", "part", "section"
  scopeSections?: string[]; // Section scope if applicable

  // Act metadata fields
  longTitle?: string;
  status?: string; // "in-force", "repealed", etc.
  inForceDate?: string; // ISO date
  consolidationDate?: string;
  enactedDate?: string;
  billOrigin?: string; // "commons" or "senate"

  // Regulation metadata fields
  instrumentNumber?: string; // e.g., "SOR/86-946"
  regulationType?: string; // "SOR", "SI", "CRC"
  enablingActId?: string;
  enablingActTitle?: string;
  registrationDate?: string;

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

  // Table of provisions fields
  provisionLabel?: string; // Label from table of provisions
  provisionTitle?: string; // Title from table of provisions
  provisionLevel?: number; // Hierarchy level

  // Signature block fields
  signatureName?: string; // Name of signatory
  signatureTitle?: string; // Title of signatory
  signatureDate?: string; // Date of signature

  // Related provisions fields
  relatedProvisionLabel?: string; // Label from related provision (e.g., "Transitional Provisions")
  relatedProvisionSource?: string; // Source reference
  relatedProvisionSections?: string[]; // Referenced section numbers
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Unique constraint to prevent duplicates on concurrent runs or restarts
    unique("leg_resources_resource_key_unique").on(table.resourceKey),
    index("leg_resources_resource_key_idx").on(table.resourceKey),
    // Composite index for common filtering patterns (language + sourceType)
    index("leg_resources_lang_source_idx").on(table.language, table.sourceType),
    // Single GIN index on metadata for flexible querying
    index("leg_resources_metadata_gin").using("gin", table.metadata),
    // CHECK constraint for valid source types (data integrity)
    check(
      "leg_resources_source_type_check",
      sql`${table.sourceType} IN (${sql.raw(LEG_SOURCE_TYPES.map((t) => `'${t}'`).join(", "))})`
    ),
  ]
);

export type LegResource = InferSelectModel<typeof legResources>;

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
  },
  (table) => [
    index("leg_embeddings_resource_id_idx").on(table.resourceId),
    index("leg_embeddings_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
    // GIN index for hybrid keyword search
    index("leg_embeddings_tsv_idx").using("gin", table.tsv),
  ]
);

export type LegEmbedding = InferSelectModel<typeof legEmbeddings>;
