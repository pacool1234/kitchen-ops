CREATE TYPE "public"."extraction_failure" AS ENUM('model_error', 'model_unreachable', 'storage_error', 'unreadable', 'interrupted', 'unexpected');--> statement-breakpoint
CREATE TYPE "public"."extraction_outcome" AS ENUM('extracted', 'needs_review', 'rejected', 'failed');--> statement-breakpoint
CREATE TABLE "extraction_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"document_id" uuid NOT NULL,
	"job_id" text NOT NULL,
	"try" integer NOT NULL,
	"outcome" "extraction_outcome" NOT NULL,
	"failure_reason" "extraction_failure",
	"model" text,
	"prompt_version" text,
	"model_calls" integer DEFAULT 0 NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" integer,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_attempts_try_positive" CHECK ("extraction_attempts"."try" > 0)
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "draft" jsonb;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "check_failures" jsonb;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "failure_reason" "extraction_failure";--> statement-breakpoint
ALTER TABLE "extraction_attempts" ADD CONSTRAINT "extraction_attempts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extraction_attempts_document_idx" ON "extraction_attempts" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_failure_reason_when_failed" CHECK (("documents"."status" = 'failed') = ("documents"."failure_reason" is not null));