ALTER TABLE `companies` ADD `normalized_careers_url` text;--> statement-breakpoint
CREATE UNIQUE INDEX `companies_normalized_careers_url_unique` ON `companies` (`normalized_careers_url`);