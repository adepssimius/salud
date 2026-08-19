CREATE TABLE "care_document_statements" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"file_id" text,
	"holder_name" text,
	"holder_phone" text,
	"set_by_user_id" text NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "er_brief_snapshots" ADD COLUMN "file_ids" text;--> statement-breakpoint
ALTER TABLE "care_document_statements" ADD CONSTRAINT "care_document_statements_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_document_statements" ADD CONSTRAINT "care_document_statements_file_id_file_assets_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_document_statements" ADD CONSTRAINT "care_document_statements_set_by_user_id_users_id_fk" FOREIGN KEY ("set_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;