CREATE TABLE "contact_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"explorer_id" integer NOT NULL,
	"channel" text NOT NULL,
	"action" text NOT NULL,
	"address" text NOT NULL,
	"consent_version" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "explorers" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "explorers" ADD COLUMN "email_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "explorers" ADD COLUMN "email_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "explorers" ADD COLUMN "park_news_asked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_explorer_id_explorers_id_fk" FOREIGN KEY ("explorer_id") REFERENCES "public"."explorers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_consents_explorer" ON "contact_consents" USING btree ("explorer_id");