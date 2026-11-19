CREATE TABLE "email_subscribers" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text,
	"email_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"explorer_id" integer,
	"token" text,
	"confirmed_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"source" text NOT NULL,
	"consent_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_subscribers_token_unique" UNIQUE("token"),
	CONSTRAINT "email_subscribers_status" CHECK ("email_subscribers"."status" in ('pending', 'confirmed', 'stopped')),
	CONSTRAINT "email_subscribers_stopped_no_email" CHECK ("email_subscribers"."status" <> 'stopped' or "email_subscribers"."email" is null)
);
--> statement-breakpoint
CREATE TABLE "news_salts" (
	"period" integer PRIMARY KEY NOT NULL,
	"salt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_opt_outs" (
	"phone" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_consents" ALTER COLUMN "explorer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_confirmations" ALTER COLUMN "explorer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "news_sends" ALTER COLUMN "explorer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_consents" ADD COLUMN "subscriber_id" integer;--> statement-breakpoint
ALTER TABLE "contact_consents" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "email_confirmations" ADD COLUMN "subscriber_id" integer;--> statement-breakpoint
ALTER TABLE "email_confirmations" ADD COLUMN "purpose" text DEFAULT 'subscribe' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_confirmations" ADD COLUMN "ip_hash" text;--> statement-breakpoint
ALTER TABLE "news_sends" ADD COLUMN "subscriber_id" integer;--> statement-breakpoint
ALTER TABLE "email_subscribers" ADD CONSTRAINT "email_subscribers_explorer_id_explorers_id_fk" FOREIGN KEY ("explorer_id") REFERENCES "public"."explorers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_subscribers_live" ON "email_subscribers" USING btree ("email") WHERE "email_subscribers"."status" in ('pending', 'confirmed');--> statement-breakpoint
CREATE INDEX "email_subscribers_explorer" ON "email_subscribers" USING btree ("explorer_id");--> statement-breakpoint
CREATE INDEX "email_subscribers_status" ON "email_subscribers" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_subscriber_id_email_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."email_subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_confirmations" ADD CONSTRAINT "email_confirmations_subscriber_id_email_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."email_subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_sends" ADD CONSTRAINT "news_sends_subscriber_id_email_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."email_subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_consents_address" ON "contact_consents" USING btree ("channel","address");--> statement-breakpoint
CREATE INDEX "email_confirmations_ip" ON "email_confirmations" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "news_sends_once_subscriber" ON "news_sends" USING btree ("issue_id","subscriber_id");--> statement-breakpoint
-- Backfill (hand-written): every confirmed account email becomes a
-- confirmed subscriber, keeping its confirmed_at, consent version, source
-- and unsubscribe token. One row per address (a couple sharing an inbox):
-- the earliest confirmer's account. Unconfirmed explorers are left out.
INSERT INTO "email_subscribers" ("email", "email_hash", "status", "explorer_id", "token", "confirmed_at", "source", "consent_version", "created_at", "updated_at")
SELECT DISTINCT ON (lower(trim(e."email")))
  lower(trim(e."email")),
  'sha256:' || encode(sha256(convert_to(lower(trim(e."email")), 'UTF8')), 'hex'),
  'confirmed',
  e."id",
  coalesce(e."email_token", translate(encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'base64'), '+/=', '-_')),
  e."email_confirmed_at",
  coalesce((SELECT c."source" FROM "contact_consents" c WHERE c."explorer_id" = e."id" AND c."channel" = 'email' AND c."action" IN ('opt_in', 'change') ORDER BY c."id" DESC LIMIT 1), 'settings'),
  coalesce((SELECT c."consent_version" FROM "contact_consents" c WHERE c."explorer_id" = e."id" AND c."channel" = 'email' AND c."action" IN ('opt_in', 'change', 'confirm') ORDER BY c."id" DESC LIMIT 1), 'email-2026-11-19'),
  e."email_confirmed_at",
  now()
FROM "explorers" e
WHERE e."email" IS NOT NULL AND e."email_opt_in" AND e."email_confirmed_at" IS NOT NULL AND NOT e."is_kid"
ORDER BY lower(trim(e."email")), e."email_confirmed_at", e."id";
--> statement-breakpoint
UPDATE "news_sends" s SET "subscriber_id" = es."id"
FROM "email_subscribers" es
WHERE es."explorer_id" = s."explorer_id" AND s."subscriber_id" IS NULL;
--> statement-breakpoint
-- The dry-run check, enforced: confirmed explorers' distinct addresses must
-- equal confirmed subscriber rows, or the whole migration rolls back.
DO $$
DECLARE want int; got int;
BEGIN
  SELECT count(DISTINCT lower(trim("email"))) INTO want FROM "explorers"
    WHERE "email" IS NOT NULL AND "email_opt_in" AND "email_confirmed_at" IS NOT NULL AND NOT "is_kid";
  SELECT count(*) INTO got FROM "email_subscribers" WHERE "status" = 'confirmed';
  IF want <> got THEN
    RAISE EXCEPTION 'email_subscribers backfill: % confirmed addresses, % rows', want, got;
  END IF;
END $$;
