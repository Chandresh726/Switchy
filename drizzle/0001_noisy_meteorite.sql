CREATE TABLE `scrape_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger_source` text NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`companies_total` integer DEFAULT 0,
	`companies_completed` integer DEFAULT 0,
	`total_jobs_found` integer DEFAULT 0,
	`total_jobs_added` integer DEFAULT 0,
	`total_jobs_filtered` integer DEFAULT 0,
	`started_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
ALTER TABLE `companies` ADD `board_token` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `clean_description` text;--> statement-breakpoint
ALTER TABLE `scraping_logs` ADD `session_id` text REFERENCES scrape_sessions(id);--> statement-breakpoint
ALTER TABLE `scraping_logs` ADD `trigger_source` text;--> statement-breakpoint
ALTER TABLE `scraping_logs` ADD `jobs_filtered` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `scraping_logs` ADD `platform` text;--> statement-breakpoint
ALTER TABLE `scraping_logs` ADD `matcher_status` text;--> statement-breakpoint
ALTER TABLE `scraping_logs` ADD `matcher_jobs_total` integer;--> statement-breakpoint
ALTER TABLE `scraping_logs` ADD `matcher_jobs_completed` integer;--> statement-breakpoint
ALTER TABLE `scraping_logs` ADD `matcher_duration` integer;