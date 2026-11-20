CREATE TABLE "sms_program_sends" (
	"id" serial PRIMARY KEY NOT NULL,
	"issue_date" date NOT NULL,
	"phone" text NOT NULL,
	"status" text NOT NULL,
	"body" text,
	"twilio_sid" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "sms_program_sends_status" CHECK ("sms_program_sends"."status" in ('sending', 'sent', 'failed', 'skipped', 'dry_run'))
);
--> statement-breakpoint
ALTER TABLE "news_settings" ADD COLUMN "texts_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "news_settings" ADD COLUMN "texts_dry_run" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "news_settings" ADD COLUMN "texts_paused_reason" text;--> statement-breakpoint
ALTER TABLE "news_settings" ADD COLUMN "texts_lock_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "news_settings" ADD COLUMN "texts_lock_owner" text;--> statement-breakpoint
CREATE UNIQUE INDEX "sms_program_sends_once" ON "sms_program_sends" USING btree ("issue_date","phone");--> statement-breakpoint
CREATE INDEX "sms_program_sends_phone" ON "sms_program_sends" USING btree ("phone","sent_at");