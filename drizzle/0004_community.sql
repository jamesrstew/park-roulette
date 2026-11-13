CREATE TABLE "park_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"park_id" integer NOT NULL,
	"topic" text NOT NULL,
	"value" text NOT NULL,
	"families" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "park_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"park_id" integer NOT NULL,
	"crew_id" integer NOT NULL,
	"explorer_id" integer NOT NULL,
	"topic" text NOT NULL,
	"value" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" integer NOT NULL,
	"reporter_id" integer NOT NULL,
	"reporter_crew_id" integer NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "parks" DROP CONSTRAINT "parks_added_by_explorers_id_fk";
--> statement-breakpoint
ALTER TABLE "explorers" ADD COLUMN "is_kid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "explorers" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "explorers" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parks" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "visibility" text DEFAULT 'members' NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "park_changes" ADD CONSTRAINT "park_changes_park_id_parks_id_fk" FOREIGN KEY ("park_id") REFERENCES "public"."parks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "park_votes" ADD CONSTRAINT "park_votes_park_id_parks_id_fk" FOREIGN KEY ("park_id") REFERENCES "public"."parks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "park_votes" ADD CONSTRAINT "park_votes_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "park_votes" ADD CONSTRAINT "park_votes_explorer_id_explorers_id_fk" FOREIGN KEY ("explorer_id") REFERENCES "public"."explorers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_reporter_id_explorers_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."explorers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_reporter_crew_id_crews_id_fk" FOREIGN KEY ("reporter_crew_id") REFERENCES "public"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "park_changes_created" ON "park_changes" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "park_votes_once" ON "park_votes" USING btree ("park_id","crew_id","topic");--> statement-breakpoint
CREATE INDEX "park_votes_park" ON "park_votes" USING btree ("park_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_reports_once" ON "review_reports" USING btree ("review_id","reporter_crew_id");--> statement-breakpoint
CREATE INDEX "review_reports_open" ON "review_reports" USING btree ("resolved_at");--> statement-breakpoint
ALTER TABLE "parks" ADD CONSTRAINT "parks_added_by_explorers_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."explorers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_visibility" CHECK ("reviews"."visibility" in ('public', 'members', 'family'));--> statement-breakpoint
-- Every park that exists today is already on everyone's list.
UPDATE "parks" SET "approved_at" = "created_at" WHERE "approved_at" IS NULL;
--> statement-breakpoint
-- Park notes stop naming who changed them (names can be kids').
UPDATE "parks" SET "status_note" = regexp_replace("status_note", ' \([A-Z][A-Za-z''-]{0,39}\)$', '') WHERE "status_note" ~ ' \([A-Z][A-Za-z''-]{0,39}\)$';
