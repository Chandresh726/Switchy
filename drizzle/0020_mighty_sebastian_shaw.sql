CREATE TABLE `ai_work_items` (
	`id` text PRIMARY KEY NOT NULL,
	`work_type` text NOT NULL,
	`match_session_id` text,
	`scraping_log_id` integer,
	`company_id` integer,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`available_at` integer NOT NULL,
	`worker_id` text,
	`locked_at` integer,
	`lease_expires_at` integer,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`result_json` text,
	`last_error_code` text,
	`last_error` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`match_session_id`) REFERENCES `match_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scraping_log_id`) REFERENCES `scraping_logs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `ai_work_items_claim_idx` ON `ai_work_items` (`work_type`,`status`,`available_at`,`priority`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_work_items_session_status_idx` ON `ai_work_items` (`match_session_id`,`status`);--> statement-breakpoint
CREATE INDEX `ai_work_items_scraping_log_idx` ON `ai_work_items` (`scraping_log_id`);--> statement-breakpoint
CREATE INDEX `ai_work_items_company_status_idx` ON `ai_work_items` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `ai_work_items_lease_idx` ON `ai_work_items` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_work_items_session_work_unique` ON `ai_work_items` (`match_session_id`,`work_type`);