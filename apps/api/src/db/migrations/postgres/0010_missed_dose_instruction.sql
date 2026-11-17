CREATE TABLE "schedule_skips" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"slot_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intervention_schedules" ADD COLUMN "missed_dose_action" text;--> statement-breakpoint
ALTER TABLE "intervention_schedules" ADD COLUMN "missed_dose_cutoff_hours" double precision;--> statement-breakpoint
ALTER TABLE "intervention_schedules" ADD COLUMN "missed_dose_course_effect" text;--> statement-breakpoint
ALTER TABLE "intervention_schedules" ADD COLUMN "missed_dose_note" text;--> statement-breakpoint
ALTER TABLE "schedule_skips" ADD CONSTRAINT "schedule_skips_schedule_id_intervention_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."intervention_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_skips" ADD CONSTRAINT "schedule_skips_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;