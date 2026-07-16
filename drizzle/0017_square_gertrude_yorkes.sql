ALTER TABLE `jobs` ADD `ai_fingerprint` text;--> statement-breakpoint
CREATE INDEX `jobs_ai_fingerprint_idx` ON `jobs` (`ai_fingerprint`);--> statement-breakpoint
ALTER TABLE `match_logs` ADD `match_result_id` text REFERENCES match_results(id);