CREATE TABLE "sms_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"phone" text NOT NULL,
	"ip" text NOT NULL,
	"known" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "explorers" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "explorers" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "explorers" ADD COLUMN "session_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "sms_events_phone" ON "sms_events" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "sms_events_ip" ON "sms_events" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "sms_events_created" ON "sms_events" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "explorers" ADD CONSTRAINT "explorers_phone_unique" UNIQUE("phone");