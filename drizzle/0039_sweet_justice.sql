CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`scrape_session_id` text NOT NULL,
	`threshold` integer NOT NULL,
	`match_count` integer NOT NULL,
	`best_job_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`delivered_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`scrape_session_id`) REFERENCES `scrape_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`best_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "notification_deliveries_status_check" CHECK("notification_deliveries"."status" in ('pending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "notification_deliveries_threshold_check" CHECK("notification_deliveries"."threshold" >= 0 and "notification_deliveries"."threshold" <= 100),
	CONSTRAINT "notification_deliveries_match_count_check" CHECK("notification_deliveries"."match_count" >= 0),
	CONSTRAINT "notification_deliveries_attempt_count_check" CHECK("notification_deliveries"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `notification_deliveries_status_idx` ON `notification_deliveries` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_deliveries_scrape_session_unique` ON `notification_deliveries` (`scrape_session_id`);--> statement-breakpoint
CREATE INDEX `scrape_sessions_notification_candidate_idx` ON `scrape_sessions` (`trigger_source`,`status`,`completed_at`);