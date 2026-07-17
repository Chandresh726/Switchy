CREATE INDEX `jobs_status_discovered_id_idx` ON `jobs` (`status`,`discovered_at`,`id`);--> statement-breakpoint
CREATE INDEX `jobs_company_discovered_id_idx` ON `jobs` (`company_id`,`discovered_at`,`id`);--> statement-breakpoint
CREATE INDEX `match_logs_session_completed_id_idx` ON `match_logs` (`session_id`,`completed_at`,`id`);--> statement-breakpoint
CREATE INDEX `match_sessions_started_id_idx` ON `match_sessions` (`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `match_sessions_company_started_id_idx` ON `match_sessions` (`company_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `people_import_sessions_started_id_idx` ON `connection_import_sessions` (`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `scrape_sessions_started_id_idx` ON `scrape_sessions` (`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `scraping_logs_session_started_id_idx` ON `scraping_logs` (`session_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `scraping_logs_company_started_id_idx` ON `scraping_logs` (`company_id`,`started_at`,`id`);