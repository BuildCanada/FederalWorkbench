ALTER TABLE "legislation"."acts" ADD COLUMN "preamble" jsonb;--> statement-breakpoint
ALTER TABLE "legislation"."acts" ADD COLUMN "related_provisions" jsonb;--> statement-breakpoint
ALTER TABLE "legislation"."acts" ADD COLUMN "treaties" jsonb;--> statement-breakpoint
ALTER TABLE "legislation"."regulations" ADD COLUMN "enabling_authorities" jsonb;--> statement-breakpoint
ALTER TABLE "legislation"."regulations" ADD COLUMN "related_provisions" jsonb;--> statement-breakpoint
ALTER TABLE "legislation"."regulations" ADD COLUMN "treaties" jsonb;--> statement-breakpoint
ALTER TABLE "legislation"."sections" ADD COLUMN "change_type" varchar(10);