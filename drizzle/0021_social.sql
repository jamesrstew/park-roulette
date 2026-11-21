CREATE TABLE "social_dm_replies" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"ext_id" text NOT NULL,
	"post_id" integer,
	"status" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_dm_replies_ext_id_unique" UNIQUE("ext_id"),
	CONSTRAINT "social_dm_replies_status" CHECK ("social_dm_replies"."status" in ('sending', 'sent', 'failed', 'dry_run'))
);
--> statement-breakpoint
CREATE TABLE "social_photo_checks" (
	"src" text NOT NULL,
	"sha256" text NOT NULL,
	"verdict" text NOT NULL,
	"note" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_photo_checks_src_sha256_pk" PRIMARY KEY("src","sha256"),
	CONSTRAINT "social_photo_checks_verdict" CHECK ("social_photo_checks"."verdict" in ('clear', 'people', 'unsure'))
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"slot_date" date NOT NULL,
	"publish_at" timestamp with time zone NOT NULL,
	"origin" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"body" jsonb NOT NULL,
	"spec" jsonb NOT NULL,
	"media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"caption" text,
	"report" jsonb,
	"child_ids" text[],
	"container_id" text,
	"ig_media_id" text,
	"fb_post_id" text,
	"reason" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_posts_kind" CHECK ("social_posts"."kind" in ('park_post', 'unpack', 'teaser', 'story')),
	CONSTRAINT "social_posts_status" CHECK ("social_posts"."status" in ('queued', 'creating', 'publishing', 'published', 'skipped', 'failed', 'dry_run', 'replaced'))
);
--> statement-breakpoint
ALTER TABLE "news_retros" DROP CONSTRAINT "news_retros_kind";--> statement-breakpoint
ALTER TABLE "news_settings" ADD COLUMN "social_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "news_settings" ADD COLUMN "social_dry_run" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "news_settings" ADD COLUMN "social_lock_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "news_settings" ADD COLUMN "social_lock_owner" text;--> statement-breakpoint
ALTER TABLE "news_settings" ADD COLUMN "social_daily_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_dm_replies" ADD CONSTRAINT "social_dm_replies_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_dm_replies_created" ON "social_dm_replies" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_slot" ON "social_posts" USING btree ("kind","slot_date") WHERE "social_posts"."status" <> 'replaced';--> statement-breakpoint
CREATE INDEX "social_posts_due" ON "social_posts" USING btree ("status","publish_at");--> statement-breakpoint
ALTER TABLE "news_retros" ADD CONSTRAINT "news_retros_kind" CHECK ("news_retros"."kind" in ('writer', 'events', 'maintainer', 'social'));