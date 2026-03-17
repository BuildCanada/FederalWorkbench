ALTER TABLE "legislation"."sections" ADD COLUMN "content_flags" jsonb;--> statement-breakpoint
CREATE INDEX "sections_content_flags_gin_idx" ON "legislation"."sections" USING gin ("content_flags");