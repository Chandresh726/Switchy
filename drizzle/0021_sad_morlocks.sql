CREATE INDEX `ai_runs_created_at_idx` ON `ai_runs` (`created_at`);--> statement-breakpoint
CREATE INDEX `match_logs_model_completed_idx` ON `match_logs` (`model_used`,`completed_at`);