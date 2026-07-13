PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scrape_match_outbox` (
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
	FOREIGN KEY (`id`) REFERENCES `match_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scraping_log_id`) REFERENCES `scraping_logs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_scrape_match_outbox`("id", "scraping_log_id", "company_id", "job_ids_json", "status", "attempt_count", "max_attempts", "available_at", "worker_id", "lease_expires_at", "last_error", "created_at", "updated_at", "completed_at") SELECT "id", "scraping_log_id", "company_id", "job_ids_json", "status", "attempt_count", "max_attempts", "available_at", "worker_id", "lease_expires_at", "last_error", "created_at", "updated_at", "completed_at" FROM `scrape_match_outbox`;--> statement-breakpoint
DROP TABLE `scrape_match_outbox`;--> statement-breakpoint
ALTER TABLE `__new_scrape_match_outbox` RENAME TO `scrape_match_outbox`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `scrape_match_outbox_pending_idx` ON `scrape_match_outbox` (`status`,`available_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `scrape_match_outbox_lease_idx` ON `scrape_match_outbox` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `scrape_match_outbox_log_unique` ON `scrape_match_outbox` (`scraping_log_id`);