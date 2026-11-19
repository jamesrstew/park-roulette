CREATE TABLE "news_chunk_state" (
	"issue_id" integer NOT NULL,
	"chunk" integer NOT NULL,
	"attempts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"one_by_one" boolean DEFAULT false NOT NULL,
	CONSTRAINT "news_chunk_state_issue_id_chunk_pk" PRIMARY KEY("issue_id","chunk")
);
--> statement-breakpoint
ALTER TABLE "news_chunk_state" ADD CONSTRAINT "news_chunk_state_issue_id_news_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."news_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill (James, release 1 review H1): every account that said yes to
-- park emails before email_subscribers becomes a pending subscriber row,
-- linked to the account. No email is sent: settings, the Park picks card
-- and onboarding show "Waiting to confirm" with "Send the link again".
-- Addresses are normalized like addressHash (all whitespace out,
-- lowercase). source = 'migrated' keeps these rows from the 7-day purge
-- for 30 days. Additive and idempotent: an address that already has a
-- live row is skipped.
INSERT INTO "email_subscribers" ("email", "email_hash", "status", "explorer_id", "source", "consent_version")
SELECT DISTINCT ON (n.email)
  n.email,
  'sha256:' || encode(sha256(convert_to(n.email, 'UTF8')), 'hex'),
  'pending',
  n.id,
  'migrated',
  'email-2026-11-20'
FROM (
  SELECT e."id", lower(regexp_replace(e."email", '\s', '', 'g')) AS email
  FROM "explorers" e
  WHERE e."email_opt_in" = true
    AND e."email" IS NOT NULL
    AND e."is_kid" = false
) n
WHERE n.email LIKE '%_@_%'
  AND NOT EXISTS (
    SELECT 1 FROM "email_subscribers" s
    WHERE s."email" = n.email AND s."status" IN ('pending', 'confirmed')
  )
  AND NOT EXISTS (
    SELECT 1 FROM "email_subscribers" s
    WHERE s."explorer_id" = n.id AND s."status" IN ('pending', 'confirmed')
  )
ORDER BY n.email, n.id;
