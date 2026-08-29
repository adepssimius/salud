CREATE TABLE `oidc_handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`redeemed_at` integer,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oidc_handoffs_code_hash_unique` ON `oidc_handoffs` (`code_hash`);