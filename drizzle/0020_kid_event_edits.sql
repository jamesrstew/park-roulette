CREATE TABLE "kid_event_edits" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"slug" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb NOT NULL,
	"by_explorer_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kid_event_edits_action" CHECK ("kid_event_edits"."action" in ('trim', 'split', 'remove'))
);
--> statement-breakpoint
CREATE INDEX "kid_event_edits_event" ON "kid_event_edits" USING btree ("event_id");