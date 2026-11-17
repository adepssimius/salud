CREATE TABLE `schedule_episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`episode_id` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `intervention_schedules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- Hand-added: carry every existing schedule → episode link into the join table before the column
-- goes. Only links to an episode that exists and belongs to the schedule's own patient — the rule
-- the service now enforces (data-model.md → "Data integrity rules"). The id is a random v4-shaped
-- uuid; nothing reads its format.
INSERT INTO `schedule_episodes`(`id`, `schedule_id`, `episode_id`, `created_at`)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
       s.`id`, s.`episode_id`, s.`created_at`
FROM `intervention_schedules` s
JOIN `episodes` e ON e.`id` = s.`episode_id` AND e.`patient_id` = s.`patient_id`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_intervention_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`type` text NOT NULL,
	`medication_id` text,
	`medication_embodiment_id` text,
	`condition_id` text,
	`label` text NOT NULL,
	`dose_mg` real,
	`dose_ml` real,
	`pill_count` real,
	`body_location` text,
	`side` text,
	`dressing_type` text,
	`frequency_hours` real,
	`explicit_times` text,
	`time_zone` text,
	`missed_dose_action` text,
	`missed_dose_cutoff_hours` real,
	`missed_dose_course_effect` text,
	`missed_dose_note` text,
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
	FOREIGN KEY (`condition_id`) REFERENCES `conditions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_intervention_schedules`("id", "patient_id", "type", "medication_id", "medication_embodiment_id", "condition_id", "label", "dose_mg", "dose_ml", "pill_count", "body_location", "side", "dressing_type", "frequency_hours", "explicit_times", "time_zone", "missed_dose_action", "missed_dose_cutoff_hours", "missed_dose_course_effect", "missed_dose_note", "start_at", "end_after_occurrences", "end_at", "notes", "status", "next_due_at", "created_by_user_id", "created_at", "updated_at") SELECT "id", "patient_id", "type", "medication_id", "medication_embodiment_id", "condition_id", "label", "dose_mg", "dose_ml", "pill_count", "body_location", "side", "dressing_type", "frequency_hours", "explicit_times", "time_zone", "missed_dose_action", "missed_dose_cutoff_hours", "missed_dose_course_effect", "missed_dose_note", "start_at", "end_after_occurrences", "end_at", "notes", "status", "next_due_at", "created_by_user_id", "created_at", "updated_at" FROM `intervention_schedules`;--> statement-breakpoint
DROP TABLE `intervention_schedules`;--> statement-breakpoint
ALTER TABLE `__new_intervention_schedules` RENAME TO `intervention_schedules`;--> statement-breakpoint
PRAGMA foreign_keys=ON;