CREATE TABLE "kid_event_handins" (
	"id" serial PRIMARY KEY NOT NULL,
	"stored" integer NOT NULL,
	"created" integer NOT NULL,
	"cut" integer NOT NULL,
	"blocked" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_lessons" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"host" text,
	"fingerprint" text NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"regressed" boolean DEFAULT false NOT NULL,
	"pr_url" text,
	"note" text,
	"closed_at" timestamp with time zone,
	"compliance" boolean DEFAULT false NOT NULL,
	CONSTRAINT "news_lessons_category" CHECK ("news_lessons"."category" in ('validator', 'source', 'data', 'rule_conflict', 'idea')),
	CONSTRAINT "news_lessons_status" CHECK ("news_lessons"."status" in ('open', 'needs_james', 'fix_proposed', 'fixed', 'wontfix'))
);
--> statement-breakpoint
CREATE TABLE "news_retros" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"issue_date" date,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_retros_kind" CHECK ("news_retros"."kind" in ('writer', 'events', 'maintainer'))
);
--> statement-breakpoint
CREATE INDEX "kid_event_handins_created" ON "kid_event_handins" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "news_lessons_fingerprint" ON "news_lessons" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "news_lessons_status" ON "news_lessons" USING btree ("status","last_seen");--> statement-breakpoint
CREATE INDEX "news_retros_created" ON "news_retros" USING btree ("created_at");