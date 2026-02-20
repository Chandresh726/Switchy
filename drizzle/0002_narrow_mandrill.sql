CREATE UNIQUE INDEX `jobs_company_external_id_unique` ON `jobs` (`company_id`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_company_url_unique` ON `jobs` (`company_id`,`url`);