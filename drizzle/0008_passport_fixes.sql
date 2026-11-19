ALTER TABLE "news_issues" DROP CONSTRAINT "news_issues_status";--> statement-breakpoint
ALTER TABLE "news_issues" ADD COLUMN "rendered" jsonb;--> statement-breakpoint
ALTER TABLE "news_sends" ADD COLUMN "key_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "news_settings" ADD COLUMN "lock_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "news_settings" ADD COLUMN "lock_owner" text;--> statement-breakpoint
CREATE INDEX "explorers_email" ON "explorers" USING btree ("email");--> statement-breakpoint
ALTER TABLE "news_issues" ADD CONSTRAINT "news_issues_status" CHECK ("news_issues"."status" in ('draft', 'sent', 'skipped', 'failed'));--> statement-breakpoint
ALTER TABLE "news_sends" ADD CONSTRAINT "news_sends_status" CHECK ("news_sends"."status" in ('queued', 'sending', 'sent', 'skipped', 'failed'));