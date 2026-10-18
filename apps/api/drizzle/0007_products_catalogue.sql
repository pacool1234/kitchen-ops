CREATE TYPE "public"."product_category" AS ENUM('produce', 'meat', 'fish', 'dairy', 'bakery', 'dry_goods', 'frozen', 'drinks', 'cleaning', 'other');--> statement-breakpoint
CREATE TABLE "supplier_products" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"product_id" uuid NOT NULL,
	"pack_quantity" numeric(18, 6) NOT NULL,
	"pack_unit" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_products_pack_quantity_positive" CHECK ("supplier_products"."pack_quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "unit_conversions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"factor" integer NOT NULL,
	CONSTRAINT "unit_conversions_factor_positive" CHECK ("unit_conversions"."factor" > 0)
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category" "product_category" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "default_storeroom_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_products_supplier_code_unique" ON "supplier_products" USING btree ("supplier_id","code");--> statement-breakpoint
CREATE INDEX "supplier_products_product_idx" ON "supplier_products" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_conversions_product_unit_unique" ON "unit_conversions" USING btree ("product_id",lower("unit"));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_default_storeroom_id_storerooms_id_fk" FOREIGN KEY ("default_storeroom_id") REFERENCES "public"."storerooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_name_unique" ON "products" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "products_default_storeroom_idx" ON "products" USING btree ("default_storeroom_id");