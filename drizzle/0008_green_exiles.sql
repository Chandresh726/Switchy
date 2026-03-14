CREATE TABLE `company_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_normalized` text NOT NULL,
	`mapped_company_id` integer NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`mapped_company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `company_aliases_mapped_company_id_idx` ON `company_aliases` (`mapped_company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `company_aliases_company_normalized_unique` ON `company_aliases` (`company_normalized`);