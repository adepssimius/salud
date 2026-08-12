CREATE TABLE `analyte_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`analyte_id` text NOT NULL,
	`goal_low` real,
	`goal_high` real,
	`note` text,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`analyte_id`) REFERENCES `analytes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `analyte_reference_ranges` (
	`id` text PRIMARY KEY NOT NULL,
	`analyte_id` text NOT NULL,
	`ref_low` real,
	`ref_high` real,
	`ref_text` text,
	`effective_from` integer NOT NULL,
	`source` text,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`analyte_id`) REFERENCES `analytes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `analytes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`unit` text,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL
);
