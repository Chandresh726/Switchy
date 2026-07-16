ALTER TABLE `resumes` ADD `ai_run_id` text REFERENCES ai_runs(id);--> statement-breakpoint
ALTER TABLE `resumes` ADD `parser_version` text;--> statement-breakpoint
ALTER TABLE `resumes` ADD `validation_warnings` text;