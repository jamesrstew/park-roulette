CREATE TABLE "alert_log" (
	"key" text PRIMARY KEY NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"suppressed" integer DEFAULT 0 NOT NULL
);
