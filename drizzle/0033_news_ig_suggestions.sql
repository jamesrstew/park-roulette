CREATE TABLE "news_ig_dm_seen" (
	"message_id" text PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_ig_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"sender" text NOT NULL,
	"sender_id" text NOT NULL,
	"permalink" text NOT NULL,
	"shortcode" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"account" text,
	"media_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"note" text,
	"used_issue_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_ig_suggestions_status_check" CHECK ("news_ig_suggestions"."status" in ('open', 'used', 'expired', 'retired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "news_ig_suggestions_message" ON "news_ig_suggestions" USING btree ("message_id","shortcode");--> statement-breakpoint
CREATE INDEX "news_ig_suggestions_status" ON "news_ig_suggestions" USING btree ("status","sent_at");