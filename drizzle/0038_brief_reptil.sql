ALTER TABLE `scraping_logs` ADD `fetch_duration` integer;--> statement-breakpoint
ALTER TABLE `scraping_logs` ADD `processing_duration` integer;--> statement-breakpoint
ALTER TABLE `scraping_logs` ADD `persistence_duration` integer;