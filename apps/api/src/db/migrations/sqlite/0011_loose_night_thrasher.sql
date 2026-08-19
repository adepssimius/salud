CREATE TABLE `chart_overlay_defaults` (
	`id` text PRIMARY KEY NOT NULL,
	`analyte_id` text NOT NULL,
	`kind` text DEFAULT 'medication_tag' NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`analyte_id`) REFERENCES `analytes`(`id`) ON UPDATE no action ON DELETE no action
);
