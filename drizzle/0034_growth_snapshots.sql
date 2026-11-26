CREATE TABLE "growth_snapshots" (
	"week_start" date PRIMARY KEY NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"backfilled" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email_claimed_at" timestamp with time zone,
	"email_sent_at" timestamp with time zone,
	"resend_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_snapshots_monday" CHECK (extract(isodow from "growth_snapshots"."week_start") = 1)
);
