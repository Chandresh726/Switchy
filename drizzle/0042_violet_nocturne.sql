DROP INDEX `match_results_job_created_idx`;--> statement-breakpoint
CREATE INDEX `match_results_presentation_idx` ON `match_results` (`job_id`,`candidate_fingerprint`,`is_stale`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `match_results_job_created_idx` ON `match_results` (`job_id`,`created_at`,`id`);