CREATE TYPE "public"."suggestion_outcome" AS ENUM('suggested', 'failed');--> statement-breakpoint
CREATE TABLE "line_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"call_id" uuid NOT NULL,
	"supplier_code" text,
	"description" text,
	"product_id" uuid
);
--> statement-breakpoint
CREATE TABLE "suggestion_calls" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"document_id" uuid NOT NULL,
	"outcome" "suggestion_outcome" NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model_calls" integer NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" integer,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "line_suggestions" ADD CONSTRAINT "line_suggestions_call_id_suggestion_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."suggestion_calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_suggestions" ADD CONSTRAINT "line_suggestions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_calls" ADD CONSTRAINT "suggestion_calls_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "line_suggestions_call_idx" ON "line_suggestions" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "suggestion_calls_document_idx" ON "suggestion_calls" USING btree ("document_id");