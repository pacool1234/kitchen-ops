CREATE TYPE "public"."document_file_kind" AS ENUM('pdf', 'xml', 'image');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('queued', 'reading', 'ready_for_review', 'failed');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('delivery-note', 'invoice');--> statement-breakpoint
CREATE TABLE "document_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "document_file_kind" NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_files_position_positive" CHECK ("document_files"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"status" "document_status" DEFAULT 'queued' NOT NULL,
	"type" "document_type",
	"supplier_id" uuid,
	"number" text,
	"date" date,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_files_sha256_unique" ON "document_files" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "document_files_storage_key_unique" ON "document_files" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "document_files_document_position_unique" ON "document_files" USING btree ("document_id","position");--> statement-breakpoint
CREATE INDEX "documents_status_created_idx" ON "documents" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "documents_created_idx" ON "documents" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;