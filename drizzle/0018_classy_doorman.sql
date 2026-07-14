ALTER TABLE `aiGenerationHistory` ADD `ai_run_id` text REFERENCES ai_runs(id);--> statement-breakpoint
ALTER TABLE `aiGenerationHistory` ADD `source` text DEFAULT 'generated' NOT NULL;--> statement-breakpoint
ALTER TABLE `aiGenerationHistory` ADD `selected_at` integer;--> statement-breakpoint
ALTER TABLE `aiGenerationHistory` ADD `copied_at` integer;--> statement-breakpoint
ALTER TABLE `aiGenerationHistory` ADD `discarded_at` integer;--> statement-breakpoint
ALTER TABLE `aiGenerationHistory` ADD `edit_distance` integer;--> statement-breakpoint
ALTER TABLE `aiGenerationHistory` ADD `edit_distance_ratio` real;