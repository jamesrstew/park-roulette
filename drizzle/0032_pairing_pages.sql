CREATE TABLE "pairing_pages" (
	"slug" text PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"theme" text NOT NULL,
	"pairs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"born_at" timestamp with time zone NOT NULL,
	"changed_at" timestamp with time zone,
	"shown_key" text DEFAULT '' NOT NULL,
	"angle" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pairing_places" (
	"place_id" text PRIMARY KEY NOT NULL,
	"name" text,
	"status" text DEFAULT 'ok' NOT NULL,
	"refreshed_at" timestamp with time zone,
	"tried_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "places_usage" ADD COLUMN "details" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pairing_pages_post" ON "pairing_pages" USING btree ("post_id");