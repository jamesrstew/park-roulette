-- Single opt-in (James, November 2026): every pending sign-up, migrated
-- ones included, is on the list now. No email is sent to them. Each gets
-- its unsubscribe token (random, base64url, 43 characters, the shape the
-- app makes) and a consent row recording that its earlier yes carried
-- over (details {"carried_over": true}, at the row's own consent version).
WITH up AS (
  UPDATE "email_subscribers"
  SET "status" = 'confirmed',
      "confirmed_at" = coalesce("confirmed_at", now()),
      "token" = coalesce(
        "token",
        rtrim(translate(encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'base64'), '+/', '-_'), '=')
      ),
      "updated_at" = now()
  WHERE "status" = 'pending' AND "email" IS NOT NULL
  RETURNING "id", "explorer_id", "email", "consent_version"
)
INSERT INTO "contact_consents" ("explorer_id", "subscriber_id", "channel", "action", "address", "consent_version", "source", "details")
SELECT up."explorer_id", up."id", 'email', 'carried_over', up."email", up."consent_version", 'single_opt_in_migration', '{"carried_over": true}'::jsonb
FROM up;
