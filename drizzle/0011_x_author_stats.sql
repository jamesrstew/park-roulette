CREATE TABLE "x_author_stats" (
	"author_id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"name" text,
	"followers" integer,
	"followers_peak" integer,
	"samples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_floor_at" timestamp with time zone,
	"added_from" text DEFAULT 'seed' NOT NULL,
	"roundups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"flagged_reason" text,
	"flagged_at" timestamp with time zone,
	"dropped_reason" text,
	"dropped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
