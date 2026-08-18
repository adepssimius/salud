CREATE TABLE "adverse_reactions" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"description" text NOT NULL,
	"occurred_at" timestamp with time zone,
	"recorded_by_user_id" text NOT NULL,
	"severity" text NOT NULL,
	"scope_type" text NOT NULL,
	"medication_id" text,
	"embodiment_id" text,
	"tag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advisories" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"source_type" text,
	"source_id" text,
	"context_type" text,
	"context_id" text,
	"payload" text,
	"acknowledged_by_user_id" text,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analyte_ranges" (
	"id" text PRIMARY KEY NOT NULL,
	"analyte_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"kind" text DEFAULT 'custom' NOT NULL,
	"label" text NOT NULL,
	"low" double precision,
	"high" double precision,
	"ref_text" text,
	"effective_from" timestamp with time zone NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"unit" text,
	"panel" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "care_team_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"permissions" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conditions" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"name" text NOT NULL,
	"diagnosis_text" text,
	"status" text NOT NULL,
	"baselines" text,
	"devices" text,
	"contacts" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"condition_id" text,
	"name" text NOT NULL,
	"started_at_type" text NOT NULL,
	"started_at_id" text NOT NULL,
	"ended_at_type" text,
	"ended_at_id" text,
	"status" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes_events_pivot" (
	"id" text PRIMARY KEY NOT NULL,
	"episode_id" text NOT NULL,
	"event_type" text NOT NULL,
	"event_id" text NOT NULL,
	"starts_episode" boolean DEFAULT false NOT NULL,
	"resolves_episode" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "er_brief_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"episode_id" text,
	"token" text NOT NULL,
	"payload" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "er_brief_snapshots_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "file_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"bucket" text NOT NULL,
	"path" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"original_name" text,
	"patient_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intervention_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"type" text NOT NULL,
	"medication_id" text,
	"medication_embodiment_id" text,
	"episode_id" text,
	"condition_id" text,
	"label" text NOT NULL,
	"dose_mg" double precision,
	"dose_ml" double precision,
	"pill_count" double precision,
	"body_location" text,
	"side" text,
	"dressing_type" text,
	"frequency_hours" double precision,
	"explicit_times" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_after_occurrences" integer,
	"end_at" timestamp with time zone,
	"notes" text,
	"status" text NOT NULL,
	"next_due_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interventions" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"schedule_id" text,
	"notes" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medication_embodiments" (
	"id" text PRIMARY KEY NOT NULL,
	"medication_id" text NOT NULL,
	"label" text NOT NULL,
	"concentration_mg_per_ml" double precision,
	"strength_mg_per_unit" double precision,
	"unit_type" text NOT NULL,
	"notes" text,
	"at_home" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"running_low" boolean DEFAULT false NOT NULL,
	"running_low_flagged_by_user_id" text,
	"running_low_flagged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "medication_guidelines" (
	"id" text PRIMARY KEY NOT NULL,
	"medication_id" text NOT NULL,
	"medication_embodiment_id" text,
	"source" text NOT NULL,
	"type" text NOT NULL,
	"mg_per_kg" double precision,
	"max_mg_per_dose" double precision,
	"max_mg_per_day" double precision,
	"min_interval_hours" double precision,
	"age_min_months" integer,
	"age_max_months" integer,
	"dose_mg" double precision,
	"dose_ml" double precision,
	"pill_count" double precision,
	"frequency_per_day" integer,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "medications" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"brand_names" text,
	"description" text,
	"tags" text,
	"default_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observation_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"observation_id" text NOT NULL,
	"type" text NOT NULL,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"text" text,
	"unit_preference_at_entry" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"date_of_birth" text NOT NULL,
	"sex_at_birth" text NOT NULL,
	"notes" text,
	"latest_weight_kg" double precision,
	"latest_weight_recorded_at" timestamp with time zone,
	"owned_by_user_id" text NOT NULL,
	"code_status" text,
	"code_status_set_by_user_id" text,
	"code_status_set_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "protocols" (
	"id" text PRIMARY KEY NOT NULL,
	"condition_id" text NOT NULL,
	"name" text NOT NULL,
	"trigger_metric" text NOT NULL,
	"trigger_operator" text NOT NULL,
	"trigger_value" double precision NOT NULL,
	"instruction_text" text NOT NULL,
	"source_text" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"snapshot" text NOT NULL,
	"edited_by_user_id" text NOT NULL,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"oidc_subject" text,
	"display_name" text NOT NULL,
	"preferred_temp_unit" text NOT NULL,
	"preferred_length_unit" text NOT NULL,
	"preferred_weight_unit" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_oidc_subject_unique" UNIQUE("oidc_subject")
);
--> statement-breakpoint
ALTER TABLE "adverse_reactions" ADD CONSTRAINT "adverse_reactions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adverse_reactions" ADD CONSTRAINT "adverse_reactions_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adverse_reactions" ADD CONSTRAINT "adverse_reactions_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adverse_reactions" ADD CONSTRAINT "adverse_reactions_embodiment_id_medication_embodiments_id_fk" FOREIGN KEY ("embodiment_id") REFERENCES "public"."medication_embodiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisories" ADD CONSTRAINT "advisories_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisories" ADD CONSTRAINT "advisories_acknowledged_by_user_id_users_id_fk" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyte_ranges" ADD CONSTRAINT "analyte_ranges_analyte_id_analytes_id_fk" FOREIGN KEY ("analyte_id") REFERENCES "public"."analytes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyte_ranges" ADD CONSTRAINT "analyte_ranges_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_team_memberships" ADD CONSTRAINT "care_team_memberships_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_team_memberships" ADD CONSTRAINT "care_team_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_condition_id_conditions_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."conditions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes_events_pivot" ADD CONSTRAINT "episodes_events_pivot_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "er_brief_snapshots" ADD CONSTRAINT "er_brief_snapshots_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "er_brief_snapshots" ADD CONSTRAINT "er_brief_snapshots_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "er_brief_snapshots" ADD CONSTRAINT "er_brief_snapshots_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervention_schedules" ADD CONSTRAINT "intervention_schedules_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervention_schedules" ADD CONSTRAINT "intervention_schedules_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervention_schedules" ADD CONSTRAINT "intervention_schedules_medication_embodiment_id_medication_embodiments_id_fk" FOREIGN KEY ("medication_embodiment_id") REFERENCES "public"."medication_embodiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervention_schedules" ADD CONSTRAINT "intervention_schedules_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervention_schedules" ADD CONSTRAINT "intervention_schedules_condition_id_conditions_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."conditions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervention_schedules" ADD CONSTRAINT "intervention_schedules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_schedule_id_intervention_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."intervention_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_embodiments" ADD CONSTRAINT "medication_embodiments_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_embodiments" ADD CONSTRAINT "medication_embodiments_running_low_flagged_by_user_id_users_id_fk" FOREIGN KEY ("running_low_flagged_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_guidelines" ADD CONSTRAINT "medication_guidelines_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_guidelines" ADD CONSTRAINT "medication_guidelines_medication_embodiment_id_medication_embodiments_id_fk" FOREIGN KEY ("medication_embodiment_id") REFERENCES "public"."medication_embodiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_entries" ADD CONSTRAINT "observation_entries_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_owned_by_user_id_users_id_fk" FOREIGN KEY ("owned_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_code_status_set_by_user_id_users_id_fk" FOREIGN KEY ("code_status_set_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_condition_id_conditions_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."conditions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_edited_by_user_id_users_id_fk" FOREIGN KEY ("edited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;