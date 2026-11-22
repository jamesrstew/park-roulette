ALTER TABLE "social_posts" ADD COLUMN "echo_status" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "echo_media" jsonb;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "echo_container_id" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "echo_media_id" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "echo_reason" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "echo_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_echo_status" CHECK ("social_posts"."echo_status" in ('creating', 'publishing', 'published', 'skipped', 'failed', 'dry_run'));