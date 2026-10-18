CREATE TYPE "public"."storeroom_type" AS ENUM('cold_room', 'dry_store', 'bar');--> statement-breakpoint
CREATE TABLE "storerooms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"type" "storeroom_type" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"tax_id" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "storerooms_name_unique" ON "storerooms" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_tax_id_unique" ON "suppliers" USING btree ("tax_id");