ALTER TABLE "sms_program_sends" DROP CONSTRAINT "sms_program_sends_status";--> statement-breakpoint
ALTER TABLE "sms_program_sends" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "news_settings" ADD COLUMN "texts_guardrail_cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sms_program_sends" ADD COLUMN "delivery_status" text;--> statement-breakpoint
ALTER TABLE "sms_program_sends" ADD COLUMN "error_code" integer;--> statement-breakpoint
CREATE INDEX "sms_program_sends_sid" ON "sms_program_sends" USING btree ("twilio_sid");--> statement-breakpoint
ALTER TABLE "sms_program_sends" ADD CONSTRAINT "sms_program_sends_status" CHECK ("sms_program_sends"."status" in ('sending', 'sent', 'failed', 'skipped', 'dry_run', 'logged'));