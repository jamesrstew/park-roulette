CREATE TABLE "newsletter_issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"message_id" text NOT NULL,
	"subject" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_issues_message" ON "newsletter_issues" USING btree ("source","message_id");--> statement-breakpoint
CREATE INDEX "newsletter_issues_sent" ON "newsletter_issues" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "newsletter_issues_received" ON "newsletter_issues" USING btree ("received_at");