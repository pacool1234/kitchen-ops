CREATE TYPE "public"."user_locale" AS ENUM('es', 'en');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locale" "user_locale" DEFAULT 'es' NOT NULL;