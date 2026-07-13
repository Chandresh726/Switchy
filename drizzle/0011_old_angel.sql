CREATE TABLE `scrape_queue_items` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`company_id` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`available_at` integer NOT NULL,
	`worker_id` text,
	`locked_at` integer,
	`lease_expires_at` integer,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`last_error` text,
	`result_json` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `scrape_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scrape_queue_claim_idx` ON `scrape_queue_items` (`status`,`available_at`,`priority`,`created_at`);--> statement-breakpoint
CREATE INDEX `scrape_queue_session_status_idx` ON `scrape_queue_items` (`session_id`,`status`);--> statement-breakpoint
CREATE INDEX `scrape_queue_lease_idx` ON `scrape_queue_items` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `scrape_queue_session_company_unique` ON `scrape_queue_items` (`session_id`,`company_id`);