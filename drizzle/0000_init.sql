CREATE TABLE "crews" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"join_code" text NOT NULL,
	"friend_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crews_join_code_unique" UNIQUE("join_code"),
	CONSTRAINT "crews_friend_code_unique" UNIQUE("friend_code")
);
--> statement-breakpoint
CREATE TABLE "explorers" (
	"id" serial PRIMARY KEY NOT NULL,
	"crew_id" integer NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"avatar" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" integer NOT NULL,
	"url" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parks" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"address" text,
	"kind" text DEFAULT 'park' NOT NULL,
	"features" text[] DEFAULT '{}'::text[] NOT NULL,
	"confidence" text DEFAULT 'unverified' NOT NULL,
	"sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"status_note" text,
	"added_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parks_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"park_id" integer NOT NULL,
	"explorer_id" integer NOT NULL,
	"rating_tenths" integer NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_range" CHECK ("reviews"."rating_tenths" between 0 and 50)
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" serial PRIMARY KEY NOT NULL,
	"park_id" integer NOT NULL,
	"crew_id" integer NOT NULL,
	"logged_by" integer NOT NULL,
	"visited_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "explorers" ADD CONSTRAINT "explorers_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parks" ADD CONSTRAINT "parks_added_by_explorers_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."explorers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_park_id_parks_id_fk" FOREIGN KEY ("park_id") REFERENCES "public"."parks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_explorer_id_explorers_id_fk" FOREIGN KEY ("explorer_id") REFERENCES "public"."explorers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_park_id_parks_id_fk" FOREIGN KEY ("park_id") REFERENCES "public"."parks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_logged_by_explorers_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."explorers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "explorers_crew_name" ON "explorers" USING btree ("crew_id",lower("name"));--> statement-breakpoint
CREATE INDEX "media_review" ON "media" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "parks_city" ON "parks" USING btree ("city");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_park_explorer" ON "reviews" USING btree ("park_id","explorer_id");--> statement-breakpoint
CREATE INDEX "visits_crew" ON "visits" USING btree ("crew_id");--> statement-breakpoint
CREATE INDEX "visits_park" ON "visits" USING btree ("park_id");