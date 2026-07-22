CREATE TABLE `connection_import_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`kind` text NOT NULL,
	`reason` text NOT NULL,
	`source_record_key` text,
	`created_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `connection_import_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "people_import_issue_row_number_check" CHECK("connection_import_issues"."row_number" > 0)
);
--> statement-breakpoint
CREATE INDEX `people_import_issues_session_row_idx` ON `connection_import_issues` (`session_id`,`row_number`,`id`);--> statement-breakpoint
CREATE TABLE `person_source_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`source` text NOT NULL,
	`source_record_key` text NOT NULL,
	`stable_identity_key` text,
	`identity_kind` text,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`full_name` text NOT NULL,
	`profile_url` text NOT NULL,
	`profile_url_normalized` text,
	`email` text,
	`email_normalized` text,
	`company_raw` text,
	`company_normalized` text,
	`position` text,
	`connected_on` integer,
	`source_notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_import_session_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`person_id`) REFERENCES `linkedin_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_import_session_id`) REFERENCES `connection_import_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `person_source_records_person_idx` ON `person_source_records` (`person_id`);--> statement-breakpoint
CREATE INDEX `person_source_records_stable_identity_idx` ON `person_source_records` (`stable_identity_key`);--> statement-breakpoint
CREATE INDEX `person_source_records_profile_url_idx` ON `person_source_records` (`profile_url_normalized`);--> statement-breakpoint
CREATE INDEX `person_source_records_email_idx` ON `person_source_records` (`email_normalized`);--> statement-breakpoint
CREATE INDEX `person_source_records_source_active_idx` ON `person_source_records` (`source`,`is_active`);--> statement-breakpoint
CREATE INDEX `person_source_records_import_session_idx` ON `person_source_records` (`last_import_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `person_source_records_source_key_unique` ON `person_source_records` (`source`,`source_record_key`);--> statement-breakpoint
ALTER TABLE `linkedin_connections` ADD `archived_at` integer;--> statement-breakpoint
CREATE INDEX `people_archived_at_idx` ON `linkedin_connections` (`archived_at`);--> statement-breakpoint
ALTER TABLE `connection_import_sessions` ADD `unchanged_rows` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `connection_import_sessions` ADD `reactivated_rows` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `connection_import_sessions` ADD `duplicate_rows` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `connection_import_sessions` ADD `import_mode` text DEFAULT 'merge' NOT NULL;