CREATE TABLE `match_session_jobs` (
	`session_id` text NOT NULL,
	`job_id` integer NOT NULL,
	`analysis_status` text DEFAULT 'queued' NOT NULL,
	`match_status` text DEFAULT 'blocked' NOT NULL,
	`job_analysis_id` text,
	`analysis_run_id` text,
	`match_run_id` text,
	`match_result_id` text,
	`error_stage` text,
	`error_code` text,
	`error_message` text,
	`analysis_started_at` integer,
	`analysis_completed_at` integer,
	`match_started_at` integer,
	`match_completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `job_id`),
	FOREIGN KEY (`session_id`) REFERENCES `match_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_analysis_id`) REFERENCES `job_analyses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`analysis_run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`match_run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`match_result_id`) REFERENCES `match_results`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `match_session_jobs_session_pipeline_idx` ON `match_session_jobs` (`session_id`,`analysis_status`,`match_status`);--> statement-breakpoint
CREATE INDEX `match_session_jobs_job_idx` ON `match_session_jobs` (`job_id`);