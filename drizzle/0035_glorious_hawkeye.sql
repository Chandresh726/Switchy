CREATE TABLE `ai_cache_events` (
	`id` text PRIMARY KEY NOT NULL,
	`capability` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`source_run_id` text,
	`artifact_type` text NOT NULL,
	`artifact_id` text NOT NULL,
	`session_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `match_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_cache_events_capability_check" CHECK("ai_cache_events"."capability" in ('job_analysis', 'match_adjudication', 'match_evaluation', 'writing_cover_letter', 'writing_referral', 'writing_recruiter_follow_up', 'resume_parse'))
);
--> statement-breakpoint
CREATE INDEX `ai_cache_events_capability_created_idx` ON `ai_cache_events` (`capability`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_cache_events_subject_created_idx` ON `ai_cache_events` (`subject_type`,`subject_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_cache_events_session_idx` ON `ai_cache_events` (`session_id`);--> statement-breakpoint
CREATE TABLE `ai_generation_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variant_id` integer NOT NULL,
	`action` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `aiGenerationHistory`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_generation_events_action_check" CHECK("ai_generation_events"."action" in ('selected', 'copied', 'discarded')),
	CONSTRAINT "ai_generation_events_source_check" CHECK("ai_generation_events"."source" in ('generated', 'initial_load', 'navigation', 'copy', 'discard'))
);
--> statement-breakpoint
CREATE INDEX `ai_generation_events_variant_created_idx` ON `ai_generation_events` (`variant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_generation_events_action_created_idx` ON `ai_generation_events` (`action`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_run_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`input_tokens` integer,
	`input_no_cache_tokens` integer,
	`input_cache_read_tokens` integer,
	`input_cache_write_tokens` integer,
	`output_tokens` integer,
	`output_text_tokens` integer,
	`output_reasoning_tokens` integer,
	`total_tokens` integer,
	`duration_ms` integer,
	`finish_reason` text,
	`provider_request_id` text,
	`warning_codes_json` text,
	`error_code` text,
	`error_message` text,
	`retry_delay_ms` integer,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_run_attempts_number_check" CHECK("ai_run_attempts"."attempt_number" > 0),
	CONSTRAINT "ai_run_attempts_status_check" CHECK("ai_run_attempts"."status" in ('running', 'succeeded', 'failed', 'cancelled', 'abandoned')),
	CONSTRAINT "ai_run_attempts_duration_check" CHECK("ai_run_attempts"."duration_ms" is null or "ai_run_attempts"."duration_ms" >= 0),
	CONSTRAINT "ai_run_attempts_retry_delay_check" CHECK("ai_run_attempts"."retry_delay_ms" is null or "ai_run_attempts"."retry_delay_ms" >= 0),
	CONSTRAINT "ai_run_attempts_token_counts_check" CHECK(("ai_run_attempts"."input_tokens" is null or "ai_run_attempts"."input_tokens" >= 0)
      and ("ai_run_attempts"."input_no_cache_tokens" is null or "ai_run_attempts"."input_no_cache_tokens" >= 0)
      and ("ai_run_attempts"."input_cache_read_tokens" is null or "ai_run_attempts"."input_cache_read_tokens" >= 0)
      and ("ai_run_attempts"."input_cache_write_tokens" is null or "ai_run_attempts"."input_cache_write_tokens" >= 0)
      and ("ai_run_attempts"."output_tokens" is null or "ai_run_attempts"."output_tokens" >= 0)
      and ("ai_run_attempts"."output_text_tokens" is null or "ai_run_attempts"."output_text_tokens" >= 0)
      and ("ai_run_attempts"."output_reasoning_tokens" is null or "ai_run_attempts"."output_reasoning_tokens" >= 0)
      and ("ai_run_attempts"."total_tokens" is null or "ai_run_attempts"."total_tokens" >= 0)),
	CONSTRAINT "ai_run_attempts_completion_check" CHECK(("ai_run_attempts"."status" = 'running' and "ai_run_attempts"."completed_at" is null)
      or ("ai_run_attempts"."status" <> 'running' and "ai_run_attempts"."completed_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `ai_run_attempts_run_idx` ON `ai_run_attempts` (`run_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `ai_run_attempts_status_started_idx` ON `ai_run_attempts` (`status`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_run_attempts_run_attempt_unique` ON `ai_run_attempts` (`run_id`,`attempt_number`);--> statement-breakpoint
ALTER TABLE `aiGeneratedContent` ADD `current_variant_id` integer REFERENCES aiGenerationHistory(id);--> statement-breakpoint
ALTER TABLE `ai_runs` ADD `input_no_cache_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_runs` ADD `input_cache_read_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_runs` ADD `input_cache_write_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_runs` ADD `output_text_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_runs` ADD `output_reasoning_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_runs` ADD `provider_request_id` text;--> statement-breakpoint
ALTER TABLE `ai_runs` ADD `provider_config_fingerprint` text;--> statement-breakpoint
ALTER TABLE `ai_runs` ADD `runtime_instance_id` text;