ALTER TABLE "legislation"."acts" ADD COLUMN "reversed_short_title" text;--> statement-breakpoint
ALTER TABLE "legislation"."acts" ADD COLUMN "consolidate_flag" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "legislation"."regulations" ADD COLUMN "reversed_short_title" text;--> statement-breakpoint
ALTER TABLE "legislation"."regulations" ADD COLUMN "consolidate_flag" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "legislation"."regulations" ADD COLUMN "recommendations" jsonb;--> statement-breakpoint
ALTER TABLE "legislation"."regulations" ADD COLUMN "notices" jsonb;--> statement-breakpoint
ALTER TABLE "legislation"."sections" ADD COLUMN "internal_references" jsonb;--> statement-breakpoint
ALTER TABLE "legislation"."sections" ADD COLUMN "provision_heading" jsonb;