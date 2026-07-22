CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`type` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'AUD' NOT NULL,
	`merchant` text NOT NULL,
	`category` text NOT NULL,
	`account` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
