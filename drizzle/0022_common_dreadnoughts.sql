CREATE TABLE `ai_model_capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_record_id` text NOT NULL,
	`model_id` text NOT NULL,
	`backend_version` text NOT NULL,
	`probe_version` text NOT NULL,
	`text_status` text NOT NULL,
	`streaming_status` text NOT NULL,
	`native_structured_status` text NOT NULL,
	`portable_structured_status` text NOT NULL,
	`structured_strategy` text,
	`error_code` text,
	`error_message` text,
	`checked_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`provider_record_id`) REFERENCES `aiProviders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_model_capabilities_provider_checked_idx` ON `ai_model_capabilities` (`provider_record_id`,`checked_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_model_capabilities_provider_model_version_unique` ON `ai_model_capabilities` (`provider_record_id`,`model_id`,`backend_version`,`probe_version`);--> statement-breakpoint
ALTER TABLE `match_results` ADD `match_policy_version` text;--> statement-breakpoint
ALTER TABLE `match_results` ADD `match_run_id` text REFERENCES ai_runs(id);