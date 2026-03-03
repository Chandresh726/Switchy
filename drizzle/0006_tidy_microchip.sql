ALTER TABLE `connection_import_sessions` ADD `source` text DEFAULT 'linkedin' NOT NULL;--> statement-breakpoint
ALTER TABLE `linkedin_connections` ADD `source` text DEFAULT 'linkedin' NOT NULL;--> statement-breakpoint
ALTER TABLE `linkedin_connections` ADD `source_record_key` text;--> statement-breakpoint
ALTER TABLE `linkedin_connections` ADD `role_tag` text;--> statement-breakpoint
ALTER TABLE `linkedin_connections` ADD `role_tag_source` text;--> statement-breakpoint
CREATE INDEX `people_source_record_key_idx` ON `linkedin_connections` (`source_record_key`);--> statement-breakpoint
CREATE INDEX `people_source_active_idx` ON `linkedin_connections` (`source`,`is_active`);--> statement-breakpoint
CREATE INDEX `people_mapped_company_active_idx` ON `linkedin_connections` (`mapped_company_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `people_role_tag_active_idx` ON `linkedin_connections` (`role_tag`,`is_active`);