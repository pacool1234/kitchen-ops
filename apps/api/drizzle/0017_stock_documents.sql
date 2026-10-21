CREATE TYPE "public"."waste_reason" AS ENUM('expired', 'spoiled', 'broken', 'prep_error', 'other');--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'waste';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'count';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'transfer';--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_posted_complete";--> statement-breakpoint
ALTER TABLE "document_lines" ALTER COLUMN "unit_price" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "storeroom_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "to_storeroom_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "waste_reason" "waste_reason";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "counted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "request_sha256" text;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_storeroom_id_storerooms_id_fk" FOREIGN KEY ("storeroom_id") REFERENCES "public"."storerooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_to_storeroom_id_storerooms_id_fk" FOREIGN KEY ("to_storeroom_id") REFERENCES "public"."storerooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_stock_storeroom" CHECK (coalesce("documents"."type"::text in ('waste', 'count', 'transfer'), false) = ("documents"."storeroom_id" is not null));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_waste_reason" CHECK (coalesce("documents"."type"::text = 'waste', false) = ("documents"."waste_reason" is not null));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_waste_note" CHECK ("documents"."note" is null or "documents"."type"::text = 'waste');--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_transfer_destination" CHECK (coalesce("documents"."type"::text = 'transfer', false) = ("documents"."to_storeroom_id" is not null));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_transfer_elsewhere" CHECK ("documents"."to_storeroom_id" is null or "documents"."to_storeroom_id" <> "documents"."storeroom_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_count_counted_at" CHECK (coalesce("documents"."type"::text = 'count', false) = ("documents"."counted_at" is not null));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_request_sha256" CHECK ("documents"."request_sha256" is null or "documents"."type"::text in ('waste', 'count', 'transfer'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_posted_complete" CHECK ("documents"."status"::text <> 'posted' or ("documents"."type" is not null and "documents"."date" is not null and ("documents"."supplier_id" is not null or "documents"."type"::text in ('waste', 'count', 'transfer'))));