PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`oidc_subject` text,
	`display_name` text NOT NULL,
	`preferred_temp_unit` text NOT NULL,
	`preferred_length_unit` text NOT NULL,
	`preferred_weight_unit` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL
);
--> statement-breakpoint
-- Hand-corrected: drizzle-kit generated this SELECT listing `oidc_subject` against the OLD
-- `users` table, which doesn't have that column yet -- it's the one being added by this very
-- migration. Every existing row becomes NULL for it, same as any brand-new nullable column.
INSERT INTO `__new_users`("id", "email", "password_hash", "oidc_subject", "display_name", "preferred_temp_unit", "preferred_length_unit", "preferred_weight_unit", "created_at", "updated_at") SELECT "id", "email", "password_hash", NULL, "display_name", "preferred_temp_unit", "preferred_length_unit", "preferred_weight_unit", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_oidc_subject_unique` ON `users` (`oidc_subject`);