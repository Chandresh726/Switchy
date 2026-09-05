CREATE INDEX `ai_runs_provider_record_created_idx` ON `ai_runs` (`provider_record_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_company_status_posted_idx` ON `jobs` (`company_id`,`status`,`posted_date`,`id`);--> statement-breakpoint
CREATE INDEX `jobs_location_type_idx` ON `jobs` (`location_type`);--> statement-breakpoint
CREATE INDEX `jobs_posted_date_idx` ON `jobs` (`posted_date`);--> statement-breakpoint
CREATE INDEX `match_logs_job_session_status_idx` ON `match_logs` (`job_id`,`session_id`,`status`);