CREATE TABLE "park_evidence_checks" (
	"url" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"missing_quotes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unknown_streak" integer DEFAULT 0 NOT NULL,
	"miss_streak" integer DEFAULT 0 NOT NULL,
	"notified_at" timestamp with time zone,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "park_evidence_checks_status" CHECK ("park_evidence_checks"."status" in ('ok', 'missing', 'unknown'))
);
