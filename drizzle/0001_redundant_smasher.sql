DROP TABLE `job_requirements`;--> statement-breakpoint
DROP TABLE `matcher_errors`;--> statement-breakpoint
CREATE INDEX `companies_careers_url_idx` ON `companies` (`careers_url`);--> statement-breakpoint
ALTER TABLE `companies` DROP COLUMN `scrape_frequency`;--> statement-breakpoint
CREATE INDEX `jobs_company_id_idx` ON `jobs` (`company_id`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_match_score_idx` ON `jobs` (`match_score`);--> statement-breakpoint
CREATE INDEX `match_logs_session_id_idx` ON `match_logs` (`session_id`);--> statement-breakpoint
CREATE INDEX `scraping_logs_session_id_idx` ON `scraping_logs` (`session_id`);--> statement-breakpoint
CREATE INDEX `scraping_logs_company_id_idx` ON `scraping_logs` (`company_id`);