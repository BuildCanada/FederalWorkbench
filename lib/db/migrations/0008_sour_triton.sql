CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE SCHEMA "rag";
--> statement-breakpoint
CREATE SCHEMA "legislation";
--> statement-breakpoint
CREATE SCHEMA "parliament";
--> statement-breakpoint
CREATE TABLE "rag"."leg_embeddings" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"section_id" varchar(191) NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"total_chunks" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag"."parl_embeddings" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"resource_id" varchar(191) NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"tsv" "tsvector"
);
--> statement-breakpoint
CREATE TABLE "rag"."parl_resources" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legislation"."acts" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"act_id" varchar(50) NOT NULL,
	"language" varchar(2) NOT NULL,
	"title" text NOT NULL,
	"long_title" text,
	"running_head" text,
	"status" varchar(20) DEFAULT 'in-force' NOT NULL,
	"in_force_date" date,
	"consolidation_date" date,
	"last_amended_date" date,
	"enacted_date" date,
	"bill_origin" varchar(20),
	"bill_type" varchar(30),
	"has_previous_version" varchar(10),
	"consolidated_number" varchar(50),
	"annual_statute_year" varchar(10),
	"annual_statute_chapter" varchar(20),
	"lims_metadata" jsonb,
	"bill_history" jsonb,
	"recent_amendments" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "acts_act_id_language_unique" UNIQUE("act_id","language")
);
--> statement-breakpoint
CREATE TABLE "legislation"."cross_references" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"source_act_id" varchar(50),
	"source_regulation_id" varchar(100),
	"source_section_label" varchar(50),
	"target_type" varchar(20) NOT NULL,
	"target_ref" varchar(100) NOT NULL,
	"target_section_ref" varchar(50),
	"reference_text" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legislation"."defined_terms" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"language" varchar(2) NOT NULL,
	"term" varchar(255) NOT NULL,
	"term_normalized" varchar(255) NOT NULL,
	"paired_term" varchar(255),
	"paired_term_id" varchar(191),
	"definition" text NOT NULL,
	"act_id" varchar(50),
	"regulation_id" varchar(100),
	"section_label" varchar(50),
	"scope_type" varchar(20) DEFAULT 'act' NOT NULL,
	"scope_sections" jsonb,
	"scope_raw_text" text,
	"lims_metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legislation"."regulations" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"regulation_id" varchar(100) NOT NULL,
	"language" varchar(2) NOT NULL,
	"instrument_number" varchar(100) NOT NULL,
	"regulation_type" varchar(20),
	"gazette_part" varchar(5),
	"title" text NOT NULL,
	"long_title" text,
	"enabling_act_id" varchar(50),
	"enabling_act_title" text,
	"status" varchar(20) DEFAULT 'in-force' NOT NULL,
	"has_previous_version" varchar(10),
	"registration_date" date,
	"consolidation_date" date,
	"last_amended_date" date,
	"lims_metadata" jsonb,
	"regulation_maker_order" jsonb,
	"recent_amendments" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "regulations_regulation_id_language_unique" UNIQUE("regulation_id","language")
);
--> statement-breakpoint
CREATE TABLE "legislation"."sections" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"act_id" varchar(50),
	"regulation_id" varchar(100),
	"canonical_section_id" varchar(200) NOT NULL,
	"section_label" varchar(50) NOT NULL,
	"section_order" integer NOT NULL,
	"language" varchar(2) NOT NULL,
	"section_type" varchar(20) DEFAULT 'section',
	"hierarchy_path" jsonb,
	"marginal_note" text,
	"content" text NOT NULL,
	"content_html" text,
	"status" varchar(20) DEFAULT 'in-force',
	"xml_type" varchar(30),
	"xml_target" varchar(100),
	"in_force_start_date" date,
	"last_amended_date" date,
	"enacted_date" date,
	"lims_metadata" jsonb,
	"historical_notes" jsonb,
	"footnotes" jsonb,
	"schedule_id" varchar(50),
	"schedule_bilingual" varchar(10),
	"schedule_span_languages" varchar(10),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parliament"."bills_bill" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_en" text DEFAULT '' NOT NULL,
	"number" varchar(10) NOT NULL,
	"number_only" smallint NOT NULL,
	"sponsor_member_id" integer,
	"privatemember" boolean,
	"sponsor_politician_id" integer,
	"law" boolean,
	"added" date NOT NULL,
	"institution" varchar(1) NOT NULL,
	"name_fr" text DEFAULT '' NOT NULL,
	"short_title_en" text DEFAULT '' NOT NULL,
	"short_title_fr" text DEFAULT '' NOT NULL,
	"status_date" date,
	"introduced" date,
	"text_docid" integer,
	"status_code" varchar(50) DEFAULT '' NOT NULL,
	"billstages_json" text,
	"legisinfo_id" integer,
	"library_summary_available" boolean NOT NULL,
	"session_id" varchar(4) NOT NULL,
	"latest_debate_date" date,
	CONSTRAINT "bills_bill_legisinfo_id_check" CHECK ((legisinfo_id >= 0))
);
--> statement-breakpoint
CREATE TABLE "parliament"."bills_bill_similar_bills" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_bill_id" integer NOT NULL,
	"to_bill_id" integer NOT NULL,
	CONSTRAINT "bills_bill_similar_bills_from_bill_id_to_bill_id_87b85e17_uniq" UNIQUE("from_bill_id","to_bill_id")
);
--> statement-breakpoint
CREATE TABLE "parliament"."bills_billtext" (
	"id" serial PRIMARY KEY NOT NULL,
	"bill_id" integer NOT NULL,
	"docid" integer NOT NULL,
	"created" timestamp (6) with time zone NOT NULL,
	"text_en" text NOT NULL,
	"text_fr" text DEFAULT '' NOT NULL,
	"summary_en" text DEFAULT '' NOT NULL,
	CONSTRAINT "bills_billtext_docid_unique" UNIQUE("docid"),
	CONSTRAINT "bills_billtext_docid_check" CHECK ((docid >= 0))
);
--> statement-breakpoint
CREATE TABLE "parliament"."bills_membervote" (
	"member_id" integer NOT NULL,
	"politician_id" integer NOT NULL,
	"votequestion_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"vote" varchar(1) NOT NULL,
	"dissent" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parliament"."bills_partyvote" (
	"vote" varchar(1) NOT NULL,
	"party_id" integer NOT NULL,
	"votequestion_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"disagreement" double precision,
	CONSTRAINT "bills_partyvote_party_id_3db5377c11c3b9f1_uniq" UNIQUE("party_id","votequestion_id")
);
--> statement-breakpoint
CREATE TABLE "parliament"."bills_votequestion" (
	"description_en" text NOT NULL,
	"nay_total" smallint NOT NULL,
	"bill_id" integer,
	"paired_total" smallint NOT NULL,
	"number" integer NOT NULL,
	"session_id" varchar(4) NOT NULL,
	"result" varchar(1) NOT NULL,
	"date" date NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"yea_total" smallint NOT NULL,
	"context_statement_id" integer,
	"description_fr" text DEFAULT '' NOT NULL,
	CONSTRAINT "bills_votequestion_number_check" CHECK ((number >= 0))
);
--> statement-breakpoint
CREATE TABLE "parliament"."committees_committee" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"short_name_en" text NOT NULL,
	"slug" varchar(50) NOT NULL,
	"parent_id" integer,
	"display" boolean NOT NULL,
	"name_fr" text DEFAULT '' NOT NULL,
	"short_name_fr" text DEFAULT '' NOT NULL,
	"joint" boolean NOT NULL,
	CONSTRAINT "committees_committee_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "parliament"."committees_committeeactivity" (
	"id" serial PRIMARY KEY NOT NULL,
	"committee_id" integer NOT NULL,
	"name_en" varchar(500) NOT NULL,
	"name_fr" varchar(500) DEFAULT '' NOT NULL,
	"study" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parliament"."committees_committeeactivityinsession" (
	"id" serial PRIMARY KEY NOT NULL,
	"activity_id" integer NOT NULL,
	"session_id" varchar(4) NOT NULL,
	"source_id" integer NOT NULL,
	CONSTRAINT "committees_committeeactivityinsession_source_id_unique" UNIQUE("source_id"),
	CONSTRAINT "committees_committeeactivityi_activity_id_7357f535d6955621_uniq" UNIQUE("activity_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "parliament"."committees_committeeinsession" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(4) NOT NULL,
	"committee_id" integer NOT NULL,
	"acronym" varchar(5) NOT NULL,
	CONSTRAINT "committees_committeeinsession_acronym_4d7dee190bc1dac4_uniq" UNIQUE("acronym","session_id"),
	CONSTRAINT "committees_committeeinsession_session_id_7ce4b4057e46edfd_uniq" UNIQUE("session_id","committee_id")
);
--> statement-breakpoint
CREATE TABLE "parliament"."committees_committeemeeting" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"start_time" time(6) NOT NULL,
	"end_time" time(6),
	"committee_id" integer NOT NULL,
	"number" smallint NOT NULL,
	"session_id" varchar(4) NOT NULL,
	"minutes" integer,
	"notice" integer,
	"evidence_id" integer,
	"in_camera" boolean NOT NULL,
	"travel" boolean NOT NULL,
	"webcast" boolean NOT NULL,
	"televised" boolean NOT NULL,
	"source_id" integer,
	CONSTRAINT "committees_committeemeeting_evidence_id_unique" UNIQUE("evidence_id"),
	CONSTRAINT "committees_committeemeeting_session_id_792939e90cda4ac1_uniq" UNIQUE("session_id","number","committee_id")
);
--> statement-breakpoint
CREATE TABLE "parliament"."committees_committeemeeting_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"committeemeeting_id" integer NOT NULL,
	"committeeactivity_id" integer NOT NULL,
	CONSTRAINT "committees_committeem_committeemeeting_id_36a83bbd36111342_uniq" UNIQUE("committeemeeting_id","committeeactivity_id")
);
--> statement-breakpoint
CREATE TABLE "parliament"."committees_committeereport" (
	"id" serial PRIMARY KEY NOT NULL,
	"committee_id" integer NOT NULL,
	"session_id" varchar(4) NOT NULL,
	"number" smallint,
	"name_en" varchar(500) NOT NULL,
	"source_id" integer NOT NULL,
	"adopted_date" date,
	"presented_date" date,
	"government_response" boolean NOT NULL,
	"parent_id" integer,
	"name_fr" varchar(500) DEFAULT '' NOT NULL,
	CONSTRAINT "committees_committeereport_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "parliament"."core_electedmember" (
	"id" serial PRIMARY KEY NOT NULL,
	"politician_id" integer NOT NULL,
	"riding_id" integer NOT NULL,
	"party_id" integer NOT NULL,
	"end_date" date,
	"start_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parliament"."core_electedmember_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"electedmember_id" integer NOT NULL,
	"session_id" varchar(4) NOT NULL,
	CONSTRAINT "core_electedmember_sessions_electedmember_id_6d9c051f_uniq" UNIQUE("electedmember_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "parliament"."core_party" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_en" varchar(100) NOT NULL,
	"slug" varchar(10) DEFAULT '' NOT NULL,
	"short_name_en" varchar(100) DEFAULT '' NOT NULL,
	"name_fr" varchar(100) DEFAULT '' NOT NULL,
	"short_name_fr" varchar(100) DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parliament"."core_partyalternatename" (
	"name" varchar(100) PRIMARY KEY NOT NULL,
	"party_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parliament"."core_politician" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"name_given" varchar(50) DEFAULT '' NOT NULL,
	"name_family" varchar(50) DEFAULT '' NOT NULL,
	"gender" varchar(1) DEFAULT '' NOT NULL,
	"headshot" varchar(100),
	"slug" varchar(30) DEFAULT '' NOT NULL,
	"headshot_thumbnail" varchar(100)
);
--> statement-breakpoint
CREATE TABLE "parliament"."core_politicianinfo" (
	"politician_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"schema" varchar(40) NOT NULL,
	"created" timestamp (6) with time zone
);
--> statement-breakpoint
CREATE TABLE "parliament"."core_riding" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_en" varchar(200) NOT NULL,
	"province" varchar(2) NOT NULL,
	"slug" varchar(60) NOT NULL,
	"edid" integer,
	"name_fr" varchar(200) DEFAULT '' NOT NULL,
	"current" boolean NOT NULL,
	CONSTRAINT "core_riding_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "parliament"."core_session" (
	"id" varchar(4) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"start" date NOT NULL,
	"end" date,
	"parliamentnum" integer,
	"sessnum" integer
);
--> statement-breakpoint
CREATE TABLE "parliament"."elections_candidacy" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"riding_id" integer NOT NULL,
	"party_id" integer NOT NULL,
	"election_id" integer NOT NULL,
	"votetotal" integer,
	"elected" boolean,
	"votepercent" numeric(5, 2)
);
--> statement-breakpoint
CREATE TABLE "parliament"."elections_election" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"byelection" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parliament"."hansards_document" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date,
	"number" varchar(6) DEFAULT '' NOT NULL,
	"session_id" varchar(4) NOT NULL,
	"most_frequent_word" varchar(20) DEFAULT '' NOT NULL,
	"wordcloud" varchar(100),
	"document_type" varchar(1) NOT NULL,
	"source_id" integer NOT NULL,
	"downloaded" boolean NOT NULL,
	"public" boolean NOT NULL,
	"multilingual" boolean NOT NULL,
	"skip_parsing" boolean NOT NULL,
	"xml_source_url" varchar(200) DEFAULT '' NOT NULL,
	"first_imported" timestamp (6) with time zone,
	"last_imported" timestamp (6) with time zone,
	"skip_redownload" boolean NOT NULL,
	CONSTRAINT "hansards_document_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "parliament"."hansards_statement" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"time" timestamp (6) with time zone NOT NULL,
	"h1_en" varchar(300) DEFAULT '' NOT NULL,
	"h2_en" varchar(300) DEFAULT '' NOT NULL,
	"member_id" integer,
	"who_en" varchar(300) DEFAULT '' NOT NULL,
	"content_en" text NOT NULL,
	"sequence" integer NOT NULL,
	"wordcount" integer NOT NULL,
	"politician_id" integer,
	"procedural" boolean NOT NULL,
	"h3_en" varchar(300) DEFAULT '' NOT NULL,
	"who_hocid" integer,
	"content_fr" text DEFAULT '' NOT NULL,
	"statement_type" varchar(35) DEFAULT '' NOT NULL,
	"written_question" varchar(1) DEFAULT '' NOT NULL,
	"source_id" varchar(15) DEFAULT '' NOT NULL,
	"who_context_en" varchar(300) DEFAULT '' NOT NULL,
	"slug" varchar(100) DEFAULT '' NOT NULL,
	"urlcache" varchar(200) DEFAULT '' NOT NULL,
	"h1_fr" varchar(400) DEFAULT '' NOT NULL,
	"h2_fr" varchar(400) DEFAULT '' NOT NULL,
	"h3_fr" varchar(400) DEFAULT '' NOT NULL,
	"who_fr" varchar(500) DEFAULT '' NOT NULL,
	"who_context_fr" varchar(500) DEFAULT '' NOT NULL,
	"wordcount_en" smallint,
	"bill_debate_stage" varchar(10) DEFAULT '' NOT NULL,
	"bill_debated_id" integer,
	CONSTRAINT "hansards_statement_document_id_77a67b806d7aef3_uniq" UNIQUE("document_id","slug"),
	CONSTRAINT "hansards_statement_who_hocid_check" CHECK ((who_hocid >= 0)),
	CONSTRAINT "hansards_statement_wordcount_en_check" CHECK ((wordcount_en >= 0))
);
--> statement-breakpoint
CREATE TABLE "parliament"."hansards_statement_bills" (
	"id" serial PRIMARY KEY NOT NULL,
	"statement_id" integer NOT NULL,
	"bill_id" integer NOT NULL,
	CONSTRAINT "hansards_statement_bills_statement_id_55ead5ec_uniq" UNIQUE("statement_id","bill_id")
);
--> statement-breakpoint
CREATE TABLE "parliament"."hansards_statement_mentioned_politicians" (
	"id" serial PRIMARY KEY NOT NULL,
	"statement_id" integer NOT NULL,
	"politician_id" integer NOT NULL,
	CONSTRAINT "hansards_statement_mentioned_statement_id_144d57244608b1e4_uniq" UNIQUE("statement_id","politician_id")
);
--> statement-breakpoint
ALTER TABLE "Message_v2" ADD COLUMN "context" jsonb;--> statement-breakpoint
ALTER TABLE "rag"."parl_embeddings" ADD CONSTRAINT "parl_embeddings_resource_id_parl_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "rag"."parl_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legislation"."sections" ADD CONSTRAINT "sections_act_id_language_fk" FOREIGN KEY ("act_id","language") REFERENCES "legislation"."acts"("act_id","language") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legislation"."sections" ADD CONSTRAINT "sections_regulation_id_language_fk" FOREIGN KEY ("regulation_id","language") REFERENCES "legislation"."regulations"("regulation_id","language") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."bills_bill" ADD CONSTRAINT "bills_bill_sponsor_member_id_core_electedmember_id_fk" FOREIGN KEY ("sponsor_member_id") REFERENCES "parliament"."core_electedmember"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."bills_bill" ADD CONSTRAINT "bills_bill_sponsor_politician_id_core_politician_id_fk" FOREIGN KEY ("sponsor_politician_id") REFERENCES "parliament"."core_politician"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."bills_bill" ADD CONSTRAINT "bills_bill_session_id_core_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "parliament"."core_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."bills_bill_similar_bills" ADD CONSTRAINT "bills_bill_similar_bills_from_bill_id_bills_bill_id_fk" FOREIGN KEY ("from_bill_id") REFERENCES "parliament"."bills_bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."bills_bill_similar_bills" ADD CONSTRAINT "bills_bill_similar_bills_to_bill_id_bills_bill_id_fk" FOREIGN KEY ("to_bill_id") REFERENCES "parliament"."bills_bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."bills_billtext" ADD CONSTRAINT "bills_billtext_bill_id_bills_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "parliament"."bills_bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."bills_membervote" ADD CONSTRAINT "bills_membervote_member_id_core_electedmember_id_fk" FOREIGN KEY ("member_id") REFERENCES "parliament"."core_electedmember"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."bills_membervote" ADD CONSTRAINT "bills_membervote_politician_id_core_politician_id_fk" FOREIGN KEY ("politician_id") REFERENCES "parliament"."core_politician"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."bills_membervote" ADD CONSTRAINT "bills_membervote_votequestion_id_bills_votequestion_id_fk" FOREIGN KEY ("votequestion_id") REFERENCES "parliament"."bills_votequestion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."bills_partyvote" ADD CONSTRAINT "bills_partyvote_party_id_core_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "parliament"."core_party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."bills_partyvote" ADD CONSTRAINT "bills_partyvote_votequestion_id_bills_votequestion_id_fk" FOREIGN KEY ("votequestion_id") REFERENCES "parliament"."bills_votequestion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."bills_votequestion" ADD CONSTRAINT "bills_votequestion_bill_id_bills_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "parliament"."bills_bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."bills_votequestion" ADD CONSTRAINT "bills_votequestion_session_id_core_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "parliament"."core_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."bills_votequestion" ADD CONSTRAINT "bills_votequestion_context_statement_id_hansards_statement_id_fk" FOREIGN KEY ("context_statement_id") REFERENCES "parliament"."hansards_statement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."committees_committee" ADD CONSTRAINT "parent_id_refs_id_65ecaa5ea7c4a6ed" FOREIGN KEY ("parent_id") REFERENCES "parliament"."committees_committee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."committees_committeeactivity" ADD CONSTRAINT "committees_committeeactivity_committee_id_committees_committee_id_fk" FOREIGN KEY ("committee_id") REFERENCES "parliament"."committees_committee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."committees_committeeactivityinsession" ADD CONSTRAINT "committees_committeeactivityinsession_activity_id_committees_committeeactivity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "parliament"."committees_committeeactivity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."committees_committeeactivityinsession" ADD CONSTRAINT "committees_committeeactivityinsession_session_id_core_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "parliament"."core_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."committees_committeeinsession" ADD CONSTRAINT "committees_committeeinsession_session_id_core_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "parliament"."core_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."committees_committeeinsession" ADD CONSTRAINT "committees_committeeinsession_committee_id_committees_committee_id_fk" FOREIGN KEY ("committee_id") REFERENCES "parliament"."committees_committee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."committees_committeemeeting" ADD CONSTRAINT "committees_committeemeeting_committee_id_committees_committee_id_fk" FOREIGN KEY ("committee_id") REFERENCES "parliament"."committees_committee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."committees_committeemeeting" ADD CONSTRAINT "committees_committeemeeting_session_id_core_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "parliament"."core_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."committees_committeemeeting" ADD CONSTRAINT "committees_committeemeeting_evidence_id_hansards_document_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "parliament"."hansards_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."committees_committeemeeting_activities" ADD CONSTRAINT "committees_committeemeeting_activities_committeemeeting_id_committees_committeemeeting_id_fk" FOREIGN KEY ("committeemeeting_id") REFERENCES "parliament"."committees_committeemeeting"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."committees_committeemeeting_activities" ADD CONSTRAINT "committees_committeemeeting_activities_committeeactivity_id_committees_committeeactivity_id_fk" FOREIGN KEY ("committeeactivity_id") REFERENCES "parliament"."committees_committeeactivity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."committees_committeereport" ADD CONSTRAINT "committees_committeereport_committee_id_committees_committee_id_fk" FOREIGN KEY ("committee_id") REFERENCES "parliament"."committees_committee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."committees_committeereport" ADD CONSTRAINT "committees_committeereport_session_id_core_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "parliament"."core_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."committees_committeereport" ADD CONSTRAINT "parent_id_refs_id_2e952deed4931d93" FOREIGN KEY ("parent_id") REFERENCES "parliament"."committees_committeereport"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."core_electedmember" ADD CONSTRAINT "core_electedmember_politician_id_core_politician_id_fk" FOREIGN KEY ("politician_id") REFERENCES "parliament"."core_politician"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."core_electedmember" ADD CONSTRAINT "core_electedmember_riding_id_core_riding_id_fk" FOREIGN KEY ("riding_id") REFERENCES "parliament"."core_riding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."core_electedmember" ADD CONSTRAINT "core_electedmember_party_id_core_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "parliament"."core_party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."core_electedmember_sessions" ADD CONSTRAINT "core_electedmember_sessions_electedmember_id_core_electedmember_id_fk" FOREIGN KEY ("electedmember_id") REFERENCES "parliament"."core_electedmember"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."core_electedmember_sessions" ADD CONSTRAINT "core_electedmember_sessions_session_id_core_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "parliament"."core_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."core_partyalternatename" ADD CONSTRAINT "core_partyalternatename_party_id_core_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "parliament"."core_party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."core_politicianinfo" ADD CONSTRAINT "core_politicianinfo_politician_id_core_politician_id_fk" FOREIGN KEY ("politician_id") REFERENCES "parliament"."core_politician"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."elections_candidacy" ADD CONSTRAINT "elections_candidacy_candidate_id_core_politician_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "parliament"."core_politician"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."elections_candidacy" ADD CONSTRAINT "elections_candidacy_riding_id_core_riding_id_fk" FOREIGN KEY ("riding_id") REFERENCES "parliament"."core_riding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."elections_candidacy" ADD CONSTRAINT "elections_candidacy_party_id_core_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "parliament"."core_party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."elections_candidacy" ADD CONSTRAINT "elections_candidacy_election_id_elections_election_id_fk" FOREIGN KEY ("election_id") REFERENCES "parliament"."elections_election"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."hansards_document" ADD CONSTRAINT "hansards_document_session_id_core_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "parliament"."core_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."hansards_statement" ADD CONSTRAINT "hansards_statement_document_id_hansards_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "parliament"."hansards_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."hansards_statement" ADD CONSTRAINT "hansards_statement_member_id_core_electedmember_id_fk" FOREIGN KEY ("member_id") REFERENCES "parliament"."core_electedmember"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."hansards_statement" ADD CONSTRAINT "hansards_statement_politician_id_core_politician_id_fk" FOREIGN KEY ("politician_id") REFERENCES "parliament"."core_politician"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."hansards_statement" ADD CONSTRAINT "hansards_statement_bill_debated_id_bills_bill_id_fk" FOREIGN KEY ("bill_debated_id") REFERENCES "parliament"."bills_bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."hansards_statement_bills" ADD CONSTRAINT "hansards_statement_bills_statement_id_hansards_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "parliament"."hansards_statement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."hansards_statement_bills" ADD CONSTRAINT "hansards_statement_bills_bill_id_bills_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "parliament"."bills_bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."hansards_statement_mentioned_politicians" ADD CONSTRAINT "hansards_statement_mentioned_politicians_statement_id_hansards_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "parliament"."hansards_statement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parliament"."hansards_statement_mentioned_politicians" ADD CONSTRAINT "hansards_statement_mentioned_politicians_politician_id_core_politician_id_fk" FOREIGN KEY ("politician_id") REFERENCES "parliament"."core_politician"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leg_embeddings_section_id_idx" ON "rag"."leg_embeddings" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "leg_embeddings_embedding_idx" ON "rag"."leg_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "parl_embeddings_embedding_idx" ON "rag"."parl_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "parl_embeddings_tsv_idx" ON "rag"."parl_embeddings" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "parl_resources_metadata_gin" ON "rag"."parl_resources" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "acts_act_id_language_idx" ON "legislation"."acts" USING btree ("act_id","language");--> statement-breakpoint
CREATE INDEX "acts_status_idx" ON "legislation"."acts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "acts_language_idx" ON "legislation"."acts" USING btree ("language");--> statement-breakpoint
CREATE INDEX "cross_references_source_act_id_idx" ON "legislation"."cross_references" USING btree ("source_act_id");--> statement-breakpoint
CREATE INDEX "cross_references_source_regulation_id_idx" ON "legislation"."cross_references" USING btree ("source_regulation_id");--> statement-breakpoint
CREATE INDEX "cross_references_target_ref_idx" ON "legislation"."cross_references" USING btree ("target_ref");--> statement-breakpoint
CREATE INDEX "defined_terms_term_normalized_lang_idx" ON "legislation"."defined_terms" USING btree ("term_normalized","language");--> statement-breakpoint
CREATE INDEX "defined_terms_act_id_lang_idx" ON "legislation"."defined_terms" USING btree ("act_id","language");--> statement-breakpoint
CREATE INDEX "defined_terms_regulation_id_lang_idx" ON "legislation"."defined_terms" USING btree ("regulation_id","language");--> statement-breakpoint
CREATE INDEX "defined_terms_act_section_lang_idx" ON "legislation"."defined_terms" USING btree ("act_id","section_label","language");--> statement-breakpoint
CREATE INDEX "defined_terms_scope_type_idx" ON "legislation"."defined_terms" USING btree ("scope_type");--> statement-breakpoint
CREATE INDEX "defined_terms_paired_term_id_idx" ON "legislation"."defined_terms" USING btree ("paired_term_id");--> statement-breakpoint
CREATE INDEX "regulations_regulation_id_language_idx" ON "legislation"."regulations" USING btree ("regulation_id","language");--> statement-breakpoint
CREATE INDEX "regulations_enabling_act_id_idx" ON "legislation"."regulations" USING btree ("enabling_act_id");--> statement-breakpoint
CREATE INDEX "regulations_status_idx" ON "legislation"."regulations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "regulations_language_idx" ON "legislation"."regulations" USING btree ("language");--> statement-breakpoint
CREATE INDEX "sections_act_id_idx" ON "legislation"."sections" USING btree ("act_id");--> statement-breakpoint
CREATE INDEX "sections_regulation_id_idx" ON "legislation"."sections" USING btree ("regulation_id");--> statement-breakpoint
CREATE INDEX "sections_canonical_section_id_idx" ON "legislation"."sections" USING btree ("canonical_section_id");--> statement-breakpoint
CREATE INDEX "sections_language_idx" ON "legislation"."sections" USING btree ("language");--> statement-breakpoint
CREATE INDEX "sections_section_type_idx" ON "legislation"."sections" USING btree ("section_type");--> statement-breakpoint
CREATE INDEX "sections_bilingual_toggle_idx" ON "legislation"."sections" USING btree ("act_id","section_label","language");--> statement-breakpoint
CREATE INDEX "sections_bilingual_reg_toggle_idx" ON "legislation"."sections" USING btree ("regulation_id","section_label","language");--> statement-breakpoint
CREATE INDEX "bills_bill_added" ON "parliament"."bills_bill" USING btree ("added");--> statement-breakpoint
CREATE INDEX "bills_bill_institution" ON "parliament"."bills_bill" USING btree ("institution");--> statement-breakpoint
CREATE INDEX "bills_bill_institution_like" ON "parliament"."bills_bill" USING btree ("institution");--> statement-breakpoint
CREATE INDEX "bills_bill_latest_debate_date_84fda672" ON "parliament"."bills_bill" USING btree ("latest_debate_date");--> statement-breakpoint
CREATE INDEX "bills_bill_legisinfo_id_c01f6333" ON "parliament"."bills_bill" USING btree ("legisinfo_id");--> statement-breakpoint
CREATE INDEX "bills_bill_number_ba50c940" ON "parliament"."bills_bill" USING btree ("number");--> statement-breakpoint
CREATE INDEX "bills_bill_number_ba50c940_like" ON "parliament"."bills_bill" USING btree ("number");--> statement-breakpoint
CREATE INDEX "bills_bill_session_id_aa62dcb6" ON "parliament"."bills_bill" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "bills_bill_session_id_aa62dcb6_like" ON "parliament"."bills_bill" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "bills_bill_sponsor_member_id" ON "parliament"."bills_bill" USING btree ("sponsor_member_id");--> statement-breakpoint
CREATE INDEX "bills_bill_sponsor_politician_id" ON "parliament"."bills_bill" USING btree ("sponsor_politician_id");--> statement-breakpoint
CREATE INDEX "bills_bill_similar_bills_from_bill_id_8c11160d" ON "parliament"."bills_bill_similar_bills" USING btree ("from_bill_id");--> statement-breakpoint
CREATE INDEX "bills_bill_similar_bills_to_bill_id_67b84825" ON "parliament"."bills_bill_similar_bills" USING btree ("to_bill_id");--> statement-breakpoint
CREATE INDEX "bills_billtext_bill_id" ON "parliament"."bills_billtext" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "bills_billtext_docid" ON "parliament"."bills_billtext" USING btree ("docid");--> statement-breakpoint
CREATE INDEX "bills_membervote_dissent" ON "parliament"."bills_membervote" USING btree ("dissent");--> statement-breakpoint
CREATE INDEX "bills_membervote_member_id" ON "parliament"."bills_membervote" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "bills_membervote_politician_id" ON "parliament"."bills_membervote" USING btree ("politician_id");--> statement-breakpoint
CREATE INDEX "bills_membervote_votequestion_id" ON "parliament"."bills_membervote" USING btree ("votequestion_id");--> statement-breakpoint
CREATE INDEX "bills_partyvote_party_id" ON "parliament"."bills_partyvote" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "bills_partyvote_votequestion_id" ON "parliament"."bills_partyvote" USING btree ("votequestion_id");--> statement-breakpoint
CREATE INDEX "bills_votequestion_bill_id" ON "parliament"."bills_votequestion" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "bills_votequestion_context_statement_id" ON "parliament"."bills_votequestion" USING btree ("context_statement_id");--> statement-breakpoint
CREATE INDEX "bills_votequestion_date" ON "parliament"."bills_votequestion" USING btree ("date");--> statement-breakpoint
CREATE INDEX "bills_votequestion_session_id" ON "parliament"."bills_votequestion" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "committees_committee_display" ON "parliament"."committees_committee" USING btree ("display");--> statement-breakpoint
CREATE INDEX "committees_committee_parent_id" ON "parliament"."committees_committee" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "committees_committeeactivity_committee_id" ON "parliament"."committees_committeeactivity" USING btree ("committee_id");--> statement-breakpoint
CREATE INDEX "committees_committeeactivityinsession_activity_id" ON "parliament"."committees_committeeactivityinsession" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "committees_committeeactivityinsession_session_id" ON "parliament"."committees_committeeactivityinsession" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "committees_committeeactivityinsession_session_id_like" ON "parliament"."committees_committeeactivityinsession" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "committees_committeeinsession_acronym" ON "parliament"."committees_committeeinsession" USING btree ("acronym");--> statement-breakpoint
CREATE INDEX "committees_committeeinsession_acronym_like" ON "parliament"."committees_committeeinsession" USING btree ("acronym");--> statement-breakpoint
CREATE INDEX "committees_committeeinsession_committee_id" ON "parliament"."committees_committeeinsession" USING btree ("committee_id");--> statement-breakpoint
CREATE INDEX "committees_committeeinsession_session_id" ON "parliament"."committees_committeeinsession" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "committees_committeeinsession_session_id_like" ON "parliament"."committees_committeeinsession" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "committees_committeemeeting_committee_id" ON "parliament"."committees_committeemeeting" USING btree ("committee_id");--> statement-breakpoint
CREATE INDEX "committees_committeemeeting_date" ON "parliament"."committees_committeemeeting" USING btree ("date");--> statement-breakpoint
CREATE INDEX "committees_committeemeeting_session_id" ON "parliament"."committees_committeemeeting" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "committees_committeemeeting_session_id_like" ON "parliament"."committees_committeemeeting" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "committees_committeemeeting_activities_committeeactivity_id" ON "parliament"."committees_committeemeeting_activities" USING btree ("committeeactivity_id");--> statement-breakpoint
CREATE INDEX "committees_committeemeeting_activities_committeemeeting_id" ON "parliament"."committees_committeemeeting_activities" USING btree ("committeemeeting_id");--> statement-breakpoint
CREATE INDEX "committees_committeereport_committee_id" ON "parliament"."committees_committeereport" USING btree ("committee_id");--> statement-breakpoint
CREATE INDEX "committees_committeereport_parent_id" ON "parliament"."committees_committeereport" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "committees_committeereport_session_id" ON "parliament"."committees_committeereport" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "committees_committeereport_session_id_like" ON "parliament"."committees_committeereport" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "core_electedmember_end_date" ON "parliament"."core_electedmember" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "core_electedmember_member_id" ON "parliament"."core_electedmember" USING btree ("politician_id");--> statement-breakpoint
CREATE INDEX "core_electedmember_party_id" ON "parliament"."core_electedmember" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "core_electedmember_riding_id" ON "parliament"."core_electedmember" USING btree ("riding_id");--> statement-breakpoint
CREATE INDEX "core_electedmember_start_date" ON "parliament"."core_electedmember" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "core_electedmember_sessions_electedmember_id" ON "parliament"."core_electedmember_sessions" USING btree ("electedmember_id");--> statement-breakpoint
CREATE INDEX "core_electedmember_sessions_session_id" ON "parliament"."core_electedmember_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "core_partyalternatename_name_f40a3266_like" ON "parliament"."core_partyalternatename" USING btree ("name");--> statement-breakpoint
CREATE INDEX "core_partyalternatename_party_id_fc8d23e2" ON "parliament"."core_partyalternatename" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "core_politician_slug" ON "parliament"."core_politician" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "core_politician_slug_like" ON "parliament"."core_politician" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "core_politicianinfo_politician_id" ON "parliament"."core_politicianinfo" USING btree ("politician_id");--> statement-breakpoint
CREATE INDEX "core_politicianinfo_schema" ON "parliament"."core_politicianinfo" USING btree ("schema");--> statement-breakpoint
CREATE INDEX "core_politicianinfo_schema_like" ON "parliament"."core_politicianinfo" USING btree ("schema");--> statement-breakpoint
CREATE INDEX "core_riding_edid" ON "parliament"."core_riding" USING btree ("edid");--> statement-breakpoint
CREATE INDEX "core_riding_slug" ON "parliament"."core_riding" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "elections_candidacy_candidate_id" ON "parliament"."elections_candidacy" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "elections_candidacy_election_id" ON "parliament"."elections_candidacy" USING btree ("election_id");--> statement-breakpoint
CREATE INDEX "elections_candidacy_party_id" ON "parliament"."elections_candidacy" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "elections_candidacy_riding_id" ON "parliament"."elections_candidacy" USING btree ("riding_id");--> statement-breakpoint
CREATE INDEX "hansards_document_document_type" ON "parliament"."hansards_document" USING btree ("document_type");--> statement-breakpoint
CREATE INDEX "hansards_document_document_type_like" ON "parliament"."hansards_document" USING btree ("document_type");--> statement-breakpoint
CREATE INDEX "hansards_document_source_id" ON "parliament"."hansards_document" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "hansards_hansard_session_id" ON "parliament"."hansards_document" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "hansards_statement_bill_debate_stage_39688425" ON "parliament"."hansards_statement" USING btree ("bill_debate_stage");--> statement-breakpoint
CREATE INDEX "hansards_statement_bill_debate_stage_39688425_like" ON "parliament"."hansards_statement" USING btree ("bill_debate_stage");--> statement-breakpoint
CREATE INDEX "hansards_statement_bill_debated_id_e9c56f18" ON "parliament"."hansards_statement" USING btree ("bill_debated_id");--> statement-breakpoint
CREATE INDEX "hansards_statement_hansard_id" ON "parliament"."hansards_statement" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "hansards_statement_member_id" ON "parliament"."hansards_statement" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "hansards_statement_politician_id" ON "parliament"."hansards_statement" USING btree ("politician_id");--> statement-breakpoint
CREATE INDEX "hansards_statement_politician_ordered" ON "parliament"."hansards_statement" USING btree ("politician_id","time");--> statement-breakpoint
CREATE INDEX "hansards_statement_sequence" ON "parliament"."hansards_statement" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "hansards_statement_slug" ON "parliament"."hansards_statement" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "hansards_statement_slug_like" ON "parliament"."hansards_statement" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "hansards_statement_speaker" ON "parliament"."hansards_statement" USING btree ("procedural");--> statement-breakpoint
CREATE INDEX "hansards_statement_time" ON "parliament"."hansards_statement" USING btree ("time");--> statement-breakpoint
CREATE INDEX "hansards_statement_who_hocid" ON "parliament"."hansards_statement" USING btree ("who_hocid");--> statement-breakpoint
CREATE INDEX "hansards_statement_bills_bill_id" ON "parliament"."hansards_statement_bills" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "hansards_statement_bills_statement_id" ON "parliament"."hansards_statement_bills" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "hansards_statement_mentioned_politicians_politician_id" ON "parliament"."hansards_statement_mentioned_politicians" USING btree ("politician_id");--> statement-breakpoint
CREATE INDEX "hansards_statement_mentioned_politicians_statement_id" ON "parliament"."hansards_statement_mentioned_politicians" USING btree ("statement_id");