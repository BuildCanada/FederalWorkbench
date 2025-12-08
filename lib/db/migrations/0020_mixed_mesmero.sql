CREATE TYPE "legislation"."consolidated_number_official" AS ENUM('yes', 'no');--> statement-breakpoint
CREATE TYPE "legislation"."short_title_status" AS ENUM('official', 'unofficial');--> statement-breakpoint
ALTER TABLE "legislation"."acts" ADD COLUMN "consolidated_number_official" "legislation"."consolidated_number_official";--> statement-breakpoint
ALTER TABLE "legislation"."acts" ADD COLUMN "short_title_status" "legislation"."short_title_status";--> statement-breakpoint
ALTER TABLE "legislation"."sections" ADD COLUMN "schedule_originating_ref" varchar(255);