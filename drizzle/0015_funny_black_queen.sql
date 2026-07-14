CREATE TABLE `ai_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`capability` text NOT NULL,
	`subject_type` text,
	`subject_id` text,
	`provider_record_id` text NOT NULL,
	`provider` text NOT NULL,
	`model_id` text NOT NULL,
	`prompt_version` text NOT NULL,
	`schema_version` text NOT NULL,
	`policy_version` text NOT NULL,
	`input_fingerprint` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`duration_ms` integer,
	`finish_reason` text,
	`cache_status` text DEFAULT 'miss' NOT NULL,
	`quality_result` text DEFAULT 'not_checked' NOT NULL,
	`warnings_json` text,
	`metadata_json` text,
	`error_code` text,
	`error_message` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_runs_capability_created_idx` ON `ai_runs` (`capability`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_runs_subject_idx` ON `ai_runs` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `ai_runs_status_created_idx` ON `ai_runs` (`status`,`created_at`);