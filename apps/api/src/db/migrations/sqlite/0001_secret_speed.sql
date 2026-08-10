PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_adverse_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`description` text NOT NULL,
	`occurred_at` integer,
	`recorded_by_user_id` text NOT NULL,
	`severity` text NOT NULL,
	`scope_type` text NOT NULL,
	`medication_id` text,
	`embodiment_id` text,
	`tag` text,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`embodiment_id`) REFERENCES `medication_embodiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_adverse_reactions`("id", "patient_id", "description", "occurred_at", "recorded_by_user_id", "severity", "scope_type", "medication_id", "embodiment_id", "tag", "created_at", "updated_at") SELECT "id", "patient_id", "description", "occurred_at", "recorded_by_user_id", "severity", "scope_type", "medication_id", "embodiment_id", "tag", "created_at", "updated_at" FROM `adverse_reactions`;--> statement-breakpoint
DROP TABLE `adverse_reactions`;--> statement-breakpoint
ALTER TABLE `__new_adverse_reactions` RENAME TO `adverse_reactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;