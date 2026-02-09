CREATE TABLE `matcher_errors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`scraping_log_id` integer,
	`attempt_number` integer NOT NULL,
	`error_type` text NOT NULL,
	`error_message` text NOT NULL,
	`occurred_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scraping_log_id`) REFERENCES `scraping_logs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `scraping_logs` ADD `matcher_error_count` integer DEFAULT 0;