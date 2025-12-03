CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`preferred_temp_unit` text NOT NULL,
	`preferred_length_unit` text NOT NULL,
	`preferred_weight_unit` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
--> statement-breakpoint
CREATE TABLE `patients` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`date_of_birth` text NOT NULL,
	`sex_at_birth` text NOT NULL,
	`notes` text,
	`latest_weight_kg` real,
	`latest_weight_recorded_at` integer,
	`owned_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`owned_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `care_team_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`permissions` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`name` text NOT NULL,
	`started_at_observation_id` text,
	`resolved_at_observation_id` text,
	`status` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`recorded_by_user_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`text` text,
	`unit_preference_at_entry` text,
	`symptom_tags` text,
	`episode_tags` text,
	`resolves_episode_ids` text,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `observation_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`observation_id` text NOT NULL,
	`type` text NOT NULL,
	`metadata` text,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`observation_id`) REFERENCES `observations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `interventions` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`recorded_by_user_id` text NOT NULL,
	`performed_at` integer NOT NULL,
	`type` text NOT NULL,
	`intervention_schedule_id` text,
	`episode_tags` text,
	`resolves_episode_ids` text,
	`notes` text,
	`metadata` text,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`intervention_schedule_id`) REFERENCES `intervention_schedules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `medications` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`tags` text,
	`default_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `medication_embodiments` (
	`id` text PRIMARY KEY NOT NULL,
	`medication_id` text NOT NULL,
	`label` text NOT NULL,
	`concentration_mg_per_ml` real,
	`strength_mg_per_unit` real,
	`unit_type` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `medication_guidelines` (
	`id` text PRIMARY KEY NOT NULL,
	`medication_id` text NOT NULL,
	`medication_embodiment_id` text,
	`source` text NOT NULL,
	`type` text NOT NULL,
	`mg_per_kg` real,
	`max_mg_per_dose` real,
	`max_mg_per_day` real,
	`min_interval_hours` real,
	`age_min_months` integer,
	`age_max_months` integer,
	`dose_mg` real,
	`dose_ml` real,
	`pill_count` real,
	`frequency_per_day` integer,
	`notes` text,
	FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_embodiment_id`) REFERENCES `medication_embodiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `intervention_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`type` text NOT NULL,
	`medication_id` text,
	`medication_embodiment_id` text,
	`episode_id` text,
	`label` text NOT NULL,
	`dose_mg` real,
	`dose_ml` real,
	`pill_count` real,
	`body_location` text,
	`side` text,
	`dressing_type` text,
	`frequency_hours` real,
	`explicit_times` text,
	`start_at` integer NOT NULL,
	`end_after_occurrences` integer,
	`end_at` integer,
	`notes` text,
	`status` text NOT NULL,
	`next_due_at` integer,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_embodiment_id`) REFERENCES `medication_embodiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `symptom_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`category` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `file_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket` text NOT NULL,
	`path` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
