CREATE TABLE "rag"."leg_resources" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"section_id" varchar(191) NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rag"."leg_embeddings" RENAME COLUMN "section_id" TO "resource_id";--> statement-breakpoint
DROP INDEX "rag"."leg_embeddings_section_id_idx";--> statement-breakpoint
ALTER TABLE "rag"."leg_embeddings" ADD COLUMN "tsv" "tsvector";--> statement-breakpoint
CREATE INDEX "leg_resources_section_id_idx" ON "rag"."leg_resources" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "leg_resources_metadata_gin" ON "rag"."leg_resources" USING gin ("metadata");--> statement-breakpoint
ALTER TABLE "rag"."leg_embeddings" ADD CONSTRAINT "leg_embeddings_resource_id_leg_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "rag"."leg_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leg_embeddings_resource_id_idx" ON "rag"."leg_embeddings" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "leg_embeddings_tsv_idx" ON "rag"."leg_embeddings" USING gin ("tsv");