-- "No playground" used to be stored as status = 'no_playground'. It's now a
-- correction (play = 'none') that keeps the park on the list. Data-only and
-- idempotent: it touches only rows still carrying the legacy status.
UPDATE "parks"
SET "play" = 'none',
    "status" = 'active',
    "sources" = array(SELECT DISTINCT unnest("sources" || ARRAY['crowd:play']::text[]))
WHERE "status" = 'no_playground';
