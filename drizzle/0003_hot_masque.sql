ALTER TABLE `scrape_sessions` ADD `total_jobs_archived` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `scraping_logs` ADD `jobs_archived` integer DEFAULT 0;