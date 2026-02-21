CREATE TABLE `connection_import_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`total_rows` integer DEFAULT 0 NOT NULL,
	`inserted_rows` integer DEFAULT 0 NOT NULL,
	`updated_rows` integer DEFAULT 0 NOT NULL,
	`deactivated_rows` integer DEFAULT 0 NOT NULL,
	`invalid_rows` integer DEFAULT 0 NOT NULL,
	`unmatched_company_rows` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`error_message` text
);
--> statement-breakpoint
CREATE TABLE `linkedin_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identity_key` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`full_name` text NOT NULL,
	`profile_url` text NOT NULL,
	`profile_url_normalized` text NOT NULL,
	`email` text,
	`company_raw` text,
	`company_normalized` text,
	`position` text,
	`connected_on` integer,
	`mapped_company_id` integer,
	`is_starred` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`notes` text,
	`last_seen_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`mapped_company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `linkedin_connections_identity_key_unique` ON `linkedin_connections` (`identity_key`);--> statement-breakpoint
CREATE INDEX `linkedin_connections_mapped_company_idx` ON `linkedin_connections` (`mapped_company_id`);--> statement-breakpoint
CREATE INDEX `linkedin_connections_active_idx` ON `linkedin_connections` (`is_active`);--> statement-breakpoint
CREATE INDEX `linkedin_connections_star_idx` ON `linkedin_connections` (`is_starred`);--> statement-breakpoint
CREATE INDEX `linkedin_connections_company_norm_idx` ON `linkedin_connections` (`company_normalized`);