CREATE TABLE "email_confirmations" (
	"id" serial PRIMARY KEY NOT NULL,
	"explorer_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"address_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_confirmations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "news_clicks" (
	"issue_date" date NOT NULL,
	"slug" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "news_clicks_issue_date_slug_pk" PRIMARY KEY("issue_date","slug")
);
--> statement-breakpoint
CREATE TABLE "news_issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"issue_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"body" jsonb,
	"report" jsonb,
	"plan" jsonb,
	"sent_body" jsonb,
	"skip_reason" text,
	"dry_run_at" timestamp with time zone,
	"send_started_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_issues_issue_date_unique" UNIQUE("issue_date"),
	CONSTRAINT "news_issues_status" CHECK ("news_issues"."status" in ('draft', 'sent', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "news_plans" (
	"issue_date" date PRIMARY KEY NOT NULL,
	"plan" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_sends" (
	"id" serial PRIMARY KEY NOT NULL,
	"issue_id" integer NOT NULL,
	"explorer_id" integer NOT NULL,
	"chunk" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"resend_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_settings_one" CHECK ("news_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "explorers" ADD COLUMN "email_token" text;--> statement-breakpoint
ALTER TABLE "email_confirmations" ADD CONSTRAINT "email_confirmations_explorer_id_explorers_id_fk" FOREIGN KEY ("explorer_id") REFERENCES "public"."explorers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_sends" ADD CONSTRAINT "news_sends_issue_id_news_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."news_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_sends" ADD CONSTRAINT "news_sends_explorer_id_explorers_id_fk" FOREIGN KEY ("explorer_id") REFERENCES "public"."explorers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_confirmations_explorer" ON "email_confirmations" USING btree ("explorer_id","created_at");--> statement-breakpoint
CREATE INDEX "email_confirmations_address" ON "email_confirmations" USING btree ("address_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "news_sends_once" ON "news_sends" USING btree ("issue_id","explorer_id");--> statement-breakpoint
CREATE INDEX "news_sends_chunk" ON "news_sends" USING btree ("issue_id","chunk");--> statement-breakpoint
CREATE INDEX "news_sends_created" ON "news_sends" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "explorers" ADD CONSTRAINT "explorers_email_token_unique" UNIQUE("email_token");