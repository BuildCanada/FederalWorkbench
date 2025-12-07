DROP INDEX "rag"."leg_resources_section_id_idx";--> statement-breakpoint
ALTER TABLE "rag"."leg_embeddings" ADD COLUMN "embedding_model" varchar(100) DEFAULT 'cohere-embed-multilingual-v3.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "rag"."leg_resources" ADD COLUMN "resource_key" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "rag"."leg_resources" ADD COLUMN "language" varchar(2) NOT NULL;--> statement-breakpoint
ALTER TABLE "rag"."leg_resources" ADD COLUMN "source_type" varchar(30) NOT NULL;--> statement-breakpoint
ALTER TABLE "rag"."leg_resources" ADD COLUMN "paired_resource_key" varchar(255);--> statement-breakpoint
CREATE INDEX "leg_embeddings_model_idx" ON "rag"."leg_embeddings" USING btree ("embedding_model");--> statement-breakpoint
CREATE INDEX "leg_resources_resource_key_idx" ON "rag"."leg_resources" USING btree ("resource_key");--> statement-breakpoint
CREATE INDEX "leg_resources_lang_source_idx" ON "rag"."leg_resources" USING btree ("language","source_type");--> statement-breakpoint
CREATE INDEX "leg_resources_paired_key_idx" ON "rag"."leg_resources" USING btree ("paired_resource_key");--> statement-breakpoint
CREATE INDEX "leg_resources_last_amended_date_idx" ON "rag"."leg_resources" USING btree ((("metadata"->>'lastAmendedDate')));--> statement-breakpoint
CREATE INDEX "leg_resources_enacted_date_idx" ON "rag"."leg_resources" USING btree ((("metadata"->>'enactedDate')));--> statement-breakpoint
CREATE INDEX "leg_resources_in_force_date_idx" ON "rag"."leg_resources" USING btree ((("metadata"->>'inForceDate')));--> statement-breakpoint
CREATE INDEX "leg_resources_consolidation_date_idx" ON "rag"."leg_resources" USING btree ((("metadata"->>'consolidationDate')));--> statement-breakpoint
CREATE INDEX "leg_resources_registration_date_idx" ON "rag"."leg_resources" USING btree ((("metadata"->>'registrationDate')));--> statement-breakpoint
CREATE INDEX "leg_resources_status_idx" ON "rag"."leg_resources" USING btree ((("metadata"->>'status')));--> statement-breakpoint
CREATE INDEX "leg_resources_section_status_idx" ON "rag"."leg_resources" USING btree ((("metadata"->>'sectionStatus')));--> statement-breakpoint
CREATE INDEX "leg_resources_act_id_idx" ON "rag"."leg_resources" USING btree ((("metadata"->>'actId')));--> statement-breakpoint
CREATE INDEX "leg_resources_regulation_id_idx" ON "rag"."leg_resources" USING btree ((("metadata"->>'regulationId')));--> statement-breakpoint
CREATE INDEX "leg_resources_section_label_idx" ON "rag"."leg_resources" USING btree ((("metadata"->>'sectionLabel')));--> statement-breakpoint
CREATE INDEX "leg_resources_status_amended_idx" ON "rag"."leg_resources" USING btree ((("metadata"->>'status')),(("metadata"->>'lastAmendedDate')));--> statement-breakpoint
ALTER TABLE "rag"."leg_resources" DROP COLUMN "section_id";--> statement-breakpoint
ALTER TABLE "rag"."leg_resources" ADD CONSTRAINT "leg_resources_resource_key_unique" UNIQUE("resource_key");--> statement-breakpoint
ALTER TABLE "rag"."leg_resources" ADD CONSTRAINT "leg_resources_source_type_check" CHECK ("rag"."leg_resources"."source_type" IN ('act', 'act_section', 'regulation', 'regulation_section', 'defined_term', 'preamble', 'treaty', 'cross_reference', 'table_of_provisions', 'signature_block', 'related_provisions', 'footnote', 'schedule', 'appendix', 'marginal_note'));