CREATE TABLE `schedule_skips` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`slot_at` integer NOT NULL,
	`reason` text NOT NULL,
	`recorded_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `intervention_schedules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `intervention_schedules` ADD `missed_dose_action` text;--> statement-breakpoint
ALTER TABLE `intervention_schedules` ADD `missed_dose_cutoff_hours` real;--> statement-breakpoint
ALTER TABLE `intervention_schedules` ADD `missed_dose_course_effect` text;--> statement-breakpoint
ALTER TABLE `intervention_schedules` ADD `missed_dose_note` text;