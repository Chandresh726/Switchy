CREATE TABLE `scrape_match_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`scraping_log_id` integer NOT NULL,
	`company_id` integer NOT NULL,
	`job_ids_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`available_at` integer NOT NULL,
	`worker_id` text,
	`lease_expires_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`scraping_log_id`) REFERENCES `scraping_logs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scrape_match_outbox_pending_idx` ON `scrape_match_outbox` (`status`,`available_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `scrape_match_outbox_lease_idx` ON `scrape_match_outbox` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `scrape_match_outbox_log_unique` ON `scrape_match_outbox` (`scraping_log_id`);