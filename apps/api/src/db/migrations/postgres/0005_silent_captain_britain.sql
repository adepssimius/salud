CREATE TABLE "chart_overlay_defaults" (
	"id" text PRIMARY KEY NOT NULL,
	"analyte_id" text NOT NULL,
	"kind" text DEFAULT 'medication_tag' NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chart_overlay_defaults" ADD CONSTRAINT "chart_overlay_defaults_analyte_id_analytes_id_fk" FOREIGN KEY ("analyte_id") REFERENCES "public"."analytes"("id") ON DELETE no action ON UPDATE no action;