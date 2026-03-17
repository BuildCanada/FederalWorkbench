ALTER TABLE "legislation"."acts" ADD COLUMN "signature_blocks" jsonb;--> statement-breakpoint
ALTER TABLE "legislation"."acts" ADD COLUMN "table_of_provisions" jsonb;--> statement-breakpoint
ALTER TABLE "legislation"."regulations" ADD COLUMN "signature_blocks" jsonb;--> statement-breakpoint
ALTER TABLE "legislation"."regulations" ADD COLUMN "table_of_provisions" jsonb;--> statement-breakpoint
ALTER TABLE "legislation"."sections" ADD COLUMN "formatting_attributes" jsonb;