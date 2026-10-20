ALTER TABLE "document_lines" ADD COLUMN "supplier_product_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "copy_of" uuid;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_supplier_product_id_supplier_products_id_fk" FOREIGN KEY ("supplier_product_id") REFERENCES "public"."supplier_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_copy_of_documents_id_fk" FOREIGN KEY ("copy_of") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_copy_of_unique" ON "documents" USING btree ("copy_of");