CREATE TABLE "event_hides" (
	"crew_id" integer NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_hides_crew_id_slug_pk" PRIMARY KEY("crew_id","slug")
);
--> statement-breakpoint
CREATE TABLE "event_saves" (
	"crew_id" integer NOT NULL,
	"slug" text NOT NULL,
	"occ" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_saves_crew_id_slug_occ_pk" PRIMARY KEY("crew_id","slug","occ")
);
--> statement-breakpoint
ALTER TABLE "event_hides" ADD CONSTRAINT "event_hides_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_saves" ADD CONSTRAINT "event_saves_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE cascade ON UPDATE no action;