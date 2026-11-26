ALTER TABLE `jobs` ADD `source_updated_at` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `last_seen_at` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `details_fetched_at` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `description_quality` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `source_locations` text;