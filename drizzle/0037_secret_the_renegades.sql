PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_runs` (
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
	`provider_config_fingerprint` text,
	`runtime_instance_id` text,
	`cache_status` text DEFAULT 'miss' NOT NULL,
	`quality_result` text DEFAULT 'not_checked' NOT NULL,
	`warnings_json` text,
	`metadata_json` text,
	`error_code` text,
	`error_message` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT "ai_runs_capability_check" CHECK("__new_ai_runs"."capability" in ('job_analysis', 'match_adjudication', 'match_evaluation', 'writing_cover_letter', 'writing_referral', 'writing_recruiter_follow_up', 'resume_parse')),
	CONSTRAINT "ai_runs_status_check" CHECK("__new_ai_runs"."status" in ('running', 'succeeded', 'failed', 'cancelled', 'abandoned')),
	CONSTRAINT "ai_runs_attempt_count_check" CHECK("__new_ai_runs"."attempt_count" >= 0),
	CONSTRAINT "ai_runs_token_counts_check" CHECK(("__new_ai_runs"."input_tokens" is null or "__new_ai_runs"."input_tokens" >= 0)
      and ("__new_ai_runs"."input_no_cache_tokens" is null or "__new_ai_runs"."input_no_cache_tokens" >= 0)
      and ("__new_ai_runs"."input_cache_read_tokens" is null or "__new_ai_runs"."input_cache_read_tokens" >= 0)
      and ("__new_ai_runs"."input_cache_write_tokens" is null or "__new_ai_runs"."input_cache_write_tokens" >= 0)
      and ("__new_ai_runs"."output_tokens" is null or "__new_ai_runs"."output_tokens" >= 0)
      and ("__new_ai_runs"."output_text_tokens" is null or "__new_ai_runs"."output_text_tokens" >= 0)
      and ("__new_ai_runs"."output_reasoning_tokens" is null or "__new_ai_runs"."output_reasoning_tokens" >= 0)
      and ("__new_ai_runs"."total_tokens" is null or "__new_ai_runs"."total_tokens" >= 0)),
	CONSTRAINT "ai_runs_duration_check" CHECK("__new_ai_runs"."duration_ms" is null or "__new_ai_runs"."duration_ms" >= 0),
	CONSTRAINT "ai_runs_subject_pair_check" CHECK(("__new_ai_runs"."subject_type" is null) = ("__new_ai_runs"."subject_id" is null)),
	CONSTRAINT "ai_runs_completion_check" CHECK(("__new_ai_runs"."status" = 'running' and "__new_ai_runs"."completed_at" is null)
      or ("__new_ai_runs"."status" <> 'running' and "__new_ai_runs"."completed_at" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_ai_runs`("id", "capability", "subject_type", "subject_id", "provider_record_id", "provider", "model_id", "prompt_version", "schema_version", "policy_version", "input_fingerprint", "status", "attempt_count", "input_tokens", "input_no_cache_tokens", "input_cache_read_tokens", "input_cache_write_tokens", "output_tokens", "output_text_tokens", "output_reasoning_tokens", "total_tokens", "duration_ms", "finish_reason", "provider_request_id", "provider_config_fingerprint", "runtime_instance_id", "cache_status", "quality_result", "warnings_json", "metadata_json", "error_code", "error_message", "started_at", "completed_at", "created_at") SELECT "id", "capability", "subject_type", "subject_id", "provider_record_id", "provider", "model_id", "prompt_version", "schema_version", "policy_version", "input_fingerprint", "status", "attempt_count", "input_tokens", "input_no_cache_tokens", "input_cache_read_tokens", "input_cache_write_tokens", "output_tokens", "output_text_tokens", "output_reasoning_tokens", "total_tokens", "duration_ms", "finish_reason", "provider_request_id", "provider_config_fingerprint", "runtime_instance_id", "cache_status", "quality_result", "warnings_json", "metadata_json", "error_code", "error_message", "started_at", "completed_at", "created_at" FROM `ai_runs`;--> statement-breakpoint
DROP TABLE `ai_runs`;--> statement-breakpoint
ALTER TABLE `__new_ai_runs` RENAME TO `ai_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ai_runs_capability_created_idx` ON `ai_runs` (`capability`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_runs_subject_idx` ON `ai_runs` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `ai_runs_status_created_idx` ON `ai_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_runs_created_at_idx` ON `ai_runs` (`created_at`);