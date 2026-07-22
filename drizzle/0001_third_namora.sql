CREATE TABLE `auth_attempts` (
	`client_key` text PRIMARY KEY NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`window_started` integer NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL
);
