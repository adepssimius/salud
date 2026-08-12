CREATE TABLE `analyte_ranges` (
	`id` text PRIMARY KEY NOT NULL,
	`analyte_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`kind` text DEFAULT 'custom' NOT NULL,
	`label` text NOT NULL,
	`low` real,
	`high` real,
	`ref_text` text,
	`effective_from` integer NOT NULL,
	`source` text,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`analyte_id`) REFERENCES `analytes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP TABLE `analyte_goals`;--> statement-breakpoint
DROP TABLE `analyte_reference_ranges`;