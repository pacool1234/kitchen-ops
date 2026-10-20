CREATE TYPE "public"."movement_kind" AS ENUM('receipt', 'waste', 'count', 'transfer-out', 'transfer-in');--> statement-breakpoint
ALTER TYPE "public"."document_status" ADD VALUE 'posted';--> statement-breakpoint
CREATE TABLE "document_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"unit" text NOT NULL,
	"unit_price" numeric(18, 6) NOT NULL,
	"discount_percent" numeric(5, 2),
	"vat_rate" numeric(5, 2),
	"storeroom_id" uuid,
	"bills_line_id" uuid,
	"adjustment" boolean DEFAULT false NOT NULL,
	CONSTRAINT "document_lines_position_positive" CHECK ("document_lines"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "movements_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"product_id" uuid NOT NULL,
	"storeroom_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"unit_cost" numeric(18, 6) NOT NULL,
	"document_line_id" uuid NOT NULL,
	"kind" "movement_kind" NOT NULL,
	"reverses" uuid,
	"corrects" uuid,
	"adjustment" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "reverses" uuid;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_storeroom_id_storerooms_id_fk" FOREIGN KEY ("storeroom_id") REFERENCES "public"."storerooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_bills_line_id_document_lines_id_fk" FOREIGN KEY ("bills_line_id") REFERENCES "public"."document_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_storeroom_id_storerooms_id_fk" FOREIGN KEY ("storeroom_id") REFERENCES "public"."storerooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_document_line_id_document_lines_id_fk" FOREIGN KEY ("document_line_id") REFERENCES "public"."document_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_reverses_movements_id_fk" FOREIGN KEY ("reverses") REFERENCES "public"."movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_corrects_movements_id_fk" FOREIGN KEY ("corrects") REFERENCES "public"."movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_lines_document_position_unique" ON "document_lines" USING btree ("document_id","position");--> statement-breakpoint
CREATE INDEX "document_lines_bills_line_idx" ON "document_lines" USING btree ("bills_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "movements_sequence_unique" ON "movements" USING btree ("sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "movements_reverses_unique" ON "movements" USING btree ("reverses");--> statement-breakpoint
CREATE UNIQUE INDEX "movements_corrects_unique" ON "movements" USING btree ("corrects");--> statement-breakpoint
CREATE INDEX "movements_product_storeroom_idx" ON "movements" USING btree ("product_id","storeroom_id","sequence");--> statement-breakpoint
CREATE INDEX "movements_document_line_idx" ON "movements" USING btree ("document_line_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_reverses_documents_id_fk" FOREIGN KEY ("reverses") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_reverses_unique" ON "documents" USING btree ("reverses");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_posted_complete" CHECK ("documents"."status"::text <> 'posted' or ("documents"."type" is not null and "documents"."supplier_id" is not null and "documents"."date" is not null));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_reversal_posted" CHECK ("documents"."reverses" is null or "documents"."status"::text = 'posted');