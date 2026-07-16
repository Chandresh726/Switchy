DROP INDEX `companies_careers_url_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `companies_careers_url_unique` ON `companies` (`careers_url`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_education` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`institution` text NOT NULL,
	`degree` text NOT NULL,
	`field` text,
	`start_date` text,
	`end_date` text,
	`gpa` text,
	`honors` text,
	FOREIGN KEY (`profile_id`) REFERENCES `profile`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_education`("id", "profile_id", "institution", "degree", "field", "start_date", "end_date", "gpa", "honors") SELECT "id", "profile_id", "institution", "degree", "field", "start_date", "end_date", "gpa", "honors" FROM `education`;--> statement-breakpoint
DROP TABLE `education`;--> statement-breakpoint
ALTER TABLE `__new_education` RENAME TO `education`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `education_profile_id_idx` ON `education` (`profile_id`);--> statement-breakpoint
CREATE TABLE `__new_experience` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`location` text,
	`start_date` text NOT NULL,
	`end_date` text,
	`description` text,
	`highlights` text,
	FOREIGN KEY (`profile_id`) REFERENCES `profile`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_experience`("id", "profile_id", "company", "title", "location", "start_date", "end_date", "description", "highlights") SELECT "id", "profile_id", "company", "title", "location", "start_date", "end_date", "description", "highlights" FROM `experience`;--> statement-breakpoint
DROP TABLE `experience`;--> statement-breakpoint
ALTER TABLE `__new_experience` RENAME TO `experience`;--> statement-breakpoint
CREATE INDEX `experience_profile_id_idx` ON `experience` (`profile_id`);--> statement-breakpoint
CREATE TABLE `__new_resumes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`file_name` text NOT NULL,
	`file_path` text NOT NULL,
	`parsed_data` text NOT NULL,
	`ai_run_id` text,
	`parser_version` text,
	`validation_warnings` text,
	`version` integer NOT NULL,
	`is_current` integer DEFAULT false NOT NULL,
	`storage_state` text DEFAULT 'ready' NOT NULL,
	`staging_path` text,
	`created_at` integer,
	FOREIGN KEY (`profile_id`) REFERENCES `profile`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ai_run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "resumes_storage_state_check" CHECK("__new_resumes"."storage_state" in ('staging', 'ready', 'deleting', 'missing'))
);
--> statement-breakpoint
INSERT INTO `__new_resumes`("id", "profile_id", "file_name", "file_path", "parsed_data", "ai_run_id", "parser_version", "validation_warnings", "version", "is_current", "storage_state", "staging_path", "created_at") SELECT "id", "profile_id", "file_name", "file_path", "parsed_data", "ai_run_id", "parser_version", "validation_warnings", "version", "is_current", "storage_state", "staging_path", "created_at" FROM `resumes`;--> statement-breakpoint
DROP TABLE `resumes`;--> statement-breakpoint
ALTER TABLE `__new_resumes` RENAME TO `resumes`;--> statement-breakpoint
CREATE UNIQUE INDEX `resumes_profile_version_unique` ON `resumes` (`profile_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `resumes_one_current_per_profile_unique` ON `resumes` (`profile_id`) WHERE "resumes"."is_current" = 1;--> statement-breakpoint
CREATE INDEX `resumes_profile_version_idx` ON `resumes` (`profile_id`,`version`);--> statement-breakpoint
CREATE TABLE `__new_skills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`name` text NOT NULL,
	`category` text,
	FOREIGN KEY (`profile_id`) REFERENCES `profile`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_skills`("id", "profile_id", "name", "category") SELECT "id", "profile_id", "name", "category" FROM `skills`;--> statement-breakpoint
DROP TABLE `skills`;--> statement-breakpoint
ALTER TABLE `__new_skills` RENAME TO `skills`;--> statement-breakpoint
CREATE INDEX `skills_profile_id_idx` ON `skills` (`profile_id`);--> statement-breakpoint
CREATE TABLE `__new_profile` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`singleton_key` text DEFAULT 'local' NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`location` text,
	`preferred_country` text,
	`preferred_city` text,
	`linkedin_url` text,
	`github_url` text,
	`portfolio_url` text,
	`resume_path` text,
	`summary` text,
	`created_at` integer,
	`updated_at` integer,
	CONSTRAINT "profile_singleton_key_check" CHECK("__new_profile"."singleton_key" = 'local')
);
--> statement-breakpoint
INSERT INTO `__new_profile`("id", "singleton_key", "name", "email", "phone", "location", "preferred_country", "preferred_city", "linkedin_url", "github_url", "portfolio_url", "resume_path", "summary", "created_at", "updated_at") SELECT "id", "singleton_key", "name", "email", "phone", "location", "preferred_country", "preferred_city", "linkedin_url", "github_url", "portfolio_url", "resume_path", "summary", "created_at", "updated_at" FROM `profile`;--> statement-breakpoint
DROP TABLE `profile`;--> statement-breakpoint
ALTER TABLE `__new_profile` RENAME TO `profile`;--> statement-breakpoint
CREATE UNIQUE INDEX `profile_singleton_key_unique` ON `profile` (`singleton_key`);--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`external_id` text,
	`title` text NOT NULL,
	`description` text,
	`description_format` text DEFAULT 'plain' NOT NULL,
	`url` text NOT NULL,
	`location` text,
	`location_type` text,
	`salary` text,
	`department` text,
	`employment_type` text,
	`seniority_level` text,
	`ai_fingerprint` text,
	`status` text DEFAULT 'new' NOT NULL,
	`match_score` real,
	`match_reasons` text,
	`matched_skills` text,
	`missing_skills` text,
	`recommendations` text,
	`posted_date` integer,
	`discovered_at` integer,
	`updated_at` integer,
	`archived_at` integer,
	`archive_source` text,
	`viewed_at` integer,
	`applied_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "jobs_status_check" CHECK("__new_jobs"."status" in ('new', 'viewed', 'interested', 'applied', 'rejected', 'archived')),
	CONSTRAINT "jobs_match_score_check" CHECK("__new_jobs"."match_score" is null or ("__new_jobs"."match_score" >= 0 and "__new_jobs"."match_score" <= 100))
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "company_id", "external_id", "title", "description", "description_format", "url", "location", "location_type", "salary", "department", "employment_type", "seniority_level", "ai_fingerprint", "status", "match_score", "match_reasons", "matched_skills", "missing_skills", "recommendations", "posted_date", "discovered_at", "updated_at", "archived_at", "archive_source", "viewed_at", "applied_at") SELECT "id", "company_id", "external_id", "title", "description", "description_format", "url", "location", "location_type", "salary", "department", "employment_type", "seniority_level", "ai_fingerprint", "status", "match_score", "match_reasons", "matched_skills", "missing_skills", "recommendations", "posted_date", "discovered_at", "updated_at", "archived_at", "archive_source", "viewed_at", "applied_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
CREATE INDEX `jobs_company_id_idx` ON `jobs` (`company_id`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_match_score_idx` ON `jobs` (`match_score`);--> statement-breakpoint
CREATE INDEX `jobs_ai_fingerprint_idx` ON `jobs` (`ai_fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_company_external_id_unique` ON `jobs` (`company_id`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_company_url_unique` ON `jobs` (`company_id`,`url`);--> statement-breakpoint
CREATE TABLE `__new_connection_import_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`source` text DEFAULT 'linkedin' NOT NULL,
	`total_rows` integer DEFAULT 0 NOT NULL,
	`inserted_rows` integer DEFAULT 0 NOT NULL,
	`updated_rows` integer DEFAULT 0 NOT NULL,
	`deactivated_rows` integer DEFAULT 0 NOT NULL,
	`invalid_rows` integer DEFAULT 0 NOT NULL,
	`unmatched_company_rows` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`error_message` text,
	CONSTRAINT "people_import_total_rows_check" CHECK("__new_connection_import_sessions"."total_rows" >= 0),
	CONSTRAINT "people_import_inserted_rows_check" CHECK("__new_connection_import_sessions"."inserted_rows" >= 0),
	CONSTRAINT "people_import_updated_rows_check" CHECK("__new_connection_import_sessions"."updated_rows" >= 0),
	CONSTRAINT "people_import_deactivated_rows_check" CHECK("__new_connection_import_sessions"."deactivated_rows" >= 0),
	CONSTRAINT "people_import_invalid_rows_check" CHECK("__new_connection_import_sessions"."invalid_rows" >= 0),
	CONSTRAINT "people_import_unmatched_rows_check" CHECK("__new_connection_import_sessions"."unmatched_company_rows" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_connection_import_sessions`("id", "file_name", "source", "total_rows", "inserted_rows", "updated_rows", "deactivated_rows", "invalid_rows", "unmatched_company_rows", "started_at", "completed_at", "status", "error_message") SELECT "id", "file_name", "source", "total_rows", "inserted_rows", "updated_rows", "deactivated_rows", "invalid_rows", "unmatched_company_rows", "started_at", "completed_at", "status", "error_message" FROM `connection_import_sessions`;--> statement-breakpoint
DROP TABLE `connection_import_sessions`;--> statement-breakpoint
ALTER TABLE `__new_connection_import_sessions` RENAME TO `connection_import_sessions`;--> statement-breakpoint
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
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "scrape_match_outbox_attempt_count_check" CHECK("__new_scrape_match_outbox"."attempt_count" >= 0),
	CONSTRAINT "scrape_match_outbox_max_attempts_check" CHECK("__new_scrape_match_outbox"."max_attempts" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_scrape_match_outbox`("id", "scraping_log_id", "company_id", "job_ids_json", "status", "attempt_count", "max_attempts", "available_at", "worker_id", "lease_expires_at", "last_error", "created_at", "updated_at", "completed_at") SELECT "id", "scraping_log_id", "company_id", "job_ids_json", "status", "attempt_count", "max_attempts", "available_at", "worker_id", "lease_expires_at", "last_error", "created_at", "updated_at", "completed_at" FROM `scrape_match_outbox`;--> statement-breakpoint
DROP TABLE `scrape_match_outbox`;--> statement-breakpoint
ALTER TABLE `__new_scrape_match_outbox` RENAME TO `scrape_match_outbox`;--> statement-breakpoint
CREATE INDEX `scrape_match_outbox_pending_idx` ON `scrape_match_outbox` (`status`,`available_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `scrape_match_outbox_lease_idx` ON `scrape_match_outbox` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `scrape_match_outbox_log_unique` ON `scrape_match_outbox` (`scraping_log_id`);--> statement-breakpoint
CREATE TABLE `__new_scrape_queue_items` (
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
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "scrape_queue_attempt_count_check" CHECK("__new_scrape_queue_items"."attempt_count" >= 0),
	CONSTRAINT "scrape_queue_max_attempts_check" CHECK("__new_scrape_queue_items"."max_attempts" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_scrape_queue_items`("id", "session_id", "company_id", "status", "priority", "attempt_count", "max_attempts", "available_at", "worker_id", "locked_at", "lease_expires_at", "cancel_requested", "last_error", "result_json", "started_at", "completed_at", "created_at", "updated_at") SELECT "id", "session_id", "company_id", "status", "priority", "attempt_count", "max_attempts", "available_at", "worker_id", "locked_at", "lease_expires_at", "cancel_requested", "last_error", "result_json", "started_at", "completed_at", "created_at", "updated_at" FROM `scrape_queue_items`;--> statement-breakpoint
DROP TABLE `scrape_queue_items`;--> statement-breakpoint
ALTER TABLE `__new_scrape_queue_items` RENAME TO `scrape_queue_items`;--> statement-breakpoint
CREATE INDEX `scrape_queue_claim_idx` ON `scrape_queue_items` (`status`,`available_at`,`priority`,`created_at`);--> statement-breakpoint
CREATE INDEX `scrape_queue_session_status_idx` ON `scrape_queue_items` (`session_id`,`status`);--> statement-breakpoint
CREATE INDEX `scrape_queue_lease_idx` ON `scrape_queue_items` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `scrape_queue_session_company_unique` ON `scrape_queue_items` (`session_id`,`company_id`);--> statement-breakpoint
CREATE TABLE `__new_scrape_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger_source` text NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`companies_total` integer DEFAULT 0,
	`companies_completed` integer DEFAULT 0,
	`total_jobs_found` integer DEFAULT 0,
	`total_jobs_added` integer DEFAULT 0,
	`total_jobs_filtered` integer DEFAULT 0,
	`total_jobs_archived` integer DEFAULT 0,
	`skip_reason` text,
	`scheduled_for_at` integer,
	`started_at` integer,
	`completed_at` integer,
	CONSTRAINT "scrape_sessions_companies_total_check" CHECK("__new_scrape_sessions"."companies_total" is null or "__new_scrape_sessions"."companies_total" >= 0),
	CONSTRAINT "scrape_sessions_companies_completed_check" CHECK("__new_scrape_sessions"."companies_completed" is null or "__new_scrape_sessions"."companies_completed" >= 0),
	CONSTRAINT "scrape_sessions_jobs_found_check" CHECK("__new_scrape_sessions"."total_jobs_found" is null or "__new_scrape_sessions"."total_jobs_found" >= 0),
	CONSTRAINT "scrape_sessions_jobs_added_check" CHECK("__new_scrape_sessions"."total_jobs_added" is null or "__new_scrape_sessions"."total_jobs_added" >= 0),
	CONSTRAINT "scrape_sessions_jobs_filtered_check" CHECK("__new_scrape_sessions"."total_jobs_filtered" is null or "__new_scrape_sessions"."total_jobs_filtered" >= 0),
	CONSTRAINT "scrape_sessions_jobs_archived_check" CHECK("__new_scrape_sessions"."total_jobs_archived" is null or "__new_scrape_sessions"."total_jobs_archived" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_scrape_sessions`("id", "trigger_source", "status", "companies_total", "companies_completed", "total_jobs_found", "total_jobs_added", "total_jobs_filtered", "total_jobs_archived", "skip_reason", "scheduled_for_at", "started_at", "completed_at") SELECT "id", "trigger_source", "status", "companies_total", "companies_completed", "total_jobs_found", "total_jobs_added", "total_jobs_filtered", "total_jobs_archived", "skip_reason", "scheduled_for_at", "started_at", "completed_at" FROM `scrape_sessions`;--> statement-breakpoint
DROP TABLE `scrape_sessions`;--> statement-breakpoint
ALTER TABLE `__new_scrape_sessions` RENAME TO `scrape_sessions`;--> statement-breakpoint
CREATE TABLE `__new_scraping_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer,
	`session_id` text,
	`trigger_source` text,
	`status` text NOT NULL,
	`jobs_found` integer DEFAULT 0,
	`jobs_added` integer DEFAULT 0,
	`jobs_updated` integer DEFAULT 0,
	`jobs_filtered` integer DEFAULT 0,
	`jobs_archived` integer DEFAULT 0,
	`platform` text,
	`error_message` text,
	`duration` integer,
	`started_at` integer,
	`completed_at` integer,
	`matcher_status` text,
	`matcher_jobs_total` integer,
	`matcher_jobs_completed` integer,
	`matcher_duration` integer,
	`matcher_error_count` integer DEFAULT 0,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `scrape_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "scraping_logs_jobs_found_check" CHECK("__new_scraping_logs"."jobs_found" is null or "__new_scraping_logs"."jobs_found" >= 0),
	CONSTRAINT "scraping_logs_jobs_added_check" CHECK("__new_scraping_logs"."jobs_added" is null or "__new_scraping_logs"."jobs_added" >= 0),
	CONSTRAINT "scraping_logs_jobs_updated_check" CHECK("__new_scraping_logs"."jobs_updated" is null or "__new_scraping_logs"."jobs_updated" >= 0),
	CONSTRAINT "scraping_logs_jobs_filtered_check" CHECK("__new_scraping_logs"."jobs_filtered" is null or "__new_scraping_logs"."jobs_filtered" >= 0),
	CONSTRAINT "scraping_logs_jobs_archived_check" CHECK("__new_scraping_logs"."jobs_archived" is null or "__new_scraping_logs"."jobs_archived" >= 0),
	CONSTRAINT "scraping_logs_duration_check" CHECK("__new_scraping_logs"."duration" is null or "__new_scraping_logs"."duration" >= 0),
	CONSTRAINT "scraping_logs_matcher_jobs_total_check" CHECK("__new_scraping_logs"."matcher_jobs_total" is null or "__new_scraping_logs"."matcher_jobs_total" >= 0),
	CONSTRAINT "scraping_logs_matcher_jobs_completed_check" CHECK("__new_scraping_logs"."matcher_jobs_completed" is null or "__new_scraping_logs"."matcher_jobs_completed" >= 0),
	CONSTRAINT "scraping_logs_matcher_duration_check" CHECK("__new_scraping_logs"."matcher_duration" is null or "__new_scraping_logs"."matcher_duration" >= 0),
	CONSTRAINT "scraping_logs_matcher_error_count_check" CHECK("__new_scraping_logs"."matcher_error_count" is null or "__new_scraping_logs"."matcher_error_count" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_scraping_logs`("id", "company_id", "session_id", "trigger_source", "status", "jobs_found", "jobs_added", "jobs_updated", "jobs_filtered", "jobs_archived", "platform", "error_message", "duration", "started_at", "completed_at", "matcher_status", "matcher_jobs_total", "matcher_jobs_completed", "matcher_duration", "matcher_error_count") SELECT "id", "company_id", "session_id", "trigger_source", "status", "jobs_found", "jobs_added", "jobs_updated", "jobs_filtered", "jobs_archived", "platform", "error_message", "duration", "started_at", "completed_at", "matcher_status", "matcher_jobs_total", "matcher_jobs_completed", "matcher_duration", "matcher_error_count" FROM `scraping_logs`;--> statement-breakpoint
DROP TABLE `scraping_logs`;--> statement-breakpoint
ALTER TABLE `__new_scraping_logs` RENAME TO `scraping_logs`;--> statement-breakpoint
CREATE INDEX `scraping_logs_session_id_idx` ON `scraping_logs` (`session_id`);--> statement-breakpoint
CREATE INDEX `scraping_logs_company_id_idx` ON `scraping_logs` (`company_id`);