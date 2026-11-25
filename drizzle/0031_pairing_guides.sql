CREATE TABLE "pairing_guides" (
	"slug" text PRIMARY KEY NOT NULL,
	"refreshed_at" timestamp with time zone,
	"tried_at" timestamp with time zone,
	"changed_at" timestamp with time zone,
	"pairs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"place_ids" text[] DEFAULT '{}'::text[] NOT NULL
);
