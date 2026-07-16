ALTER TABLE `profile` ADD `singleton_key` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `resumes` ADD `storage_state` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `resumes` ADD `staging_path` text;