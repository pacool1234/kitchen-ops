CREATE TABLE "invoice_line_bills" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"delivery_note_line_id" uuid,
	"received" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_line_bills_position_positive" CHECK ("invoice_line_bills"."position" > 0),
	CONSTRAINT "invoice_line_bills_one_choice" CHECK (("invoice_line_bills"."delivery_note_line_id" is not null) <> "invoice_line_bills"."received")
);
--> statement-breakpoint
ALTER TABLE "invoice_line_bills" ADD CONSTRAINT "invoice_line_bills_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_bills" ADD CONSTRAINT "invoice_line_bills_delivery_note_line_id_document_lines_id_fk" FOREIGN KEY ("delivery_note_line_id") REFERENCES "public"."document_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_line_bills_document_position_unique" ON "invoice_line_bills" USING btree ("document_id","position");--> statement-breakpoint
CREATE INDEX "invoice_line_bills_delivery_note_line_idx" ON "invoice_line_bills" USING btree ("delivery_note_line_id");