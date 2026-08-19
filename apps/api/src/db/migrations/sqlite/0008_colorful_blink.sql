CREATE TABLE `care_document_statements` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`file_id` text,
	`holder_name` text,
	`holder_phone` text,
	`set_by_user_id` text NOT NULL,
	`set_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`seq` integer NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`set_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `er_brief_snapshots` ADD `file_ids` text;