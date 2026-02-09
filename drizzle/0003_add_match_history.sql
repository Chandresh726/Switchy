-- Match Sessions table - Track batch match operations
CREATE TABLE `match_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger_source` text NOT NULL,
	`company_id` integer,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`jobs_total` integer DEFAULT 0,
	`jobs_completed` integer DEFAULT 0,
	`jobs_succeeded` integer DEFAULT 0,
	`jobs_failed` integer DEFAULT 0,
	`error_count` integer DEFAULT 0,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint

-- Match Logs table - Per-job match results with history
CREATE TABLE `match_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text,
	`job_id` integer,
	`status` text NOT NULL,
	`score` real,
	`attempt_count` integer DEFAULT 1,
	`error_type` text,
	`error_message` text,
	`duration` integer,
	`model_used` text,
	`completed_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `match_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

-- Add indexes for better query performance
CREATE INDEX `match_sessions_status_idx` ON `match_sessions` (`status`);
--> statement-breakpoint
CREATE INDEX `match_sessions_company_id_idx` ON `match_sessions` (`company_id`);
--> statement-breakpoint
CREATE INDEX `match_logs_session_id_idx` ON `match_logs` (`session_id`);
--> statement-breakpoint
CREATE INDEX `match_logs_job_id_idx` ON `match_logs` (`job_id`);
--> statement-breakpoint

-- Insert default matcher settings
INSERT OR IGNORE INTO `settings` (`key`, `value`, `updated_at`) VALUES
	('matcher_concurrency_limit', '3', strftime('%s', 'now') * 1000),
	('matcher_timeout_ms', '30000', strftime('%s', 'now') * 1000),
	('matcher_backoff_base_delay', '2000', strftime('%s', 'now') * 1000),
	('matcher_backoff_max_delay', '32000', strftime('%s', 'now') * 1000),
	('matcher_circuit_breaker_threshold', '10', strftime('%s', 'now') * 1000),
	('matcher_circuit_breaker_reset_timeout', '60000', strftime('%s', 'now') * 1000),
	('matcher_auto_match_after_scrape', 'true', strftime('%s', 'now') * 1000);
