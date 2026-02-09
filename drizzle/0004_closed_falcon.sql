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
ALTER TABLE `companies` DROP COLUMN `description`;--> statement-breakpoint
ALTER TABLE `companies` DROP COLUMN `location`;--> statement-breakpoint
ALTER TABLE `companies` DROP COLUMN `industry`;--> statement-breakpoint
ALTER TABLE `companies` DROP COLUMN `size`;