CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`careers_url` text NOT NULL,
	`logo_url` text,
	`platform` text,
	`description` text,
	`location` text,
	`industry` text,
	`size` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_scraped_at` integer,
	`scrape_frequency` integer DEFAULT 6,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `education` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer,
	`institution` text NOT NULL,
	`degree` text NOT NULL,
	`field` text,
	`start_date` text,
	`end_date` text,
	`gpa` text,
	`honors` text,
	FOREIGN KEY (`profile_id`) REFERENCES `profile`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `experience` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`location` text,
	`start_date` text NOT NULL,
	`end_date` text,
	`description` text,
	`highlights` text,
	FOREIGN KEY (`profile_id`) REFERENCES `profile`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `job_requirements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`requirement` text NOT NULL,
	`type` text,
	`category` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`external_id` text,
	`title` text NOT NULL,
	`description` text,
	`url` text NOT NULL,
	`location` text,
	`location_type` text,
	`salary` text,
	`department` text,
	`employment_type` text,
	`seniority_level` text,
	`status` text DEFAULT 'new' NOT NULL,
	`match_score` real,
	`match_reasons` text,
	`matched_skills` text,
	`missing_skills` text,
	`recommendations` text,
	`posted_date` integer,
	`discovered_at` integer,
	`updated_at` integer,
	`viewed_at` integer,
	`applied_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`location` text,
	`preferred_country` text,
	`preferred_city` text,
	`linkedin_url` text,
	`github_url` text,
	`portfolio_url` text,
	`resume_path` text,
	`summary` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `scraping_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer,
	`status` text NOT NULL,
	`jobs_found` integer DEFAULT 0,
	`jobs_added` integer DEFAULT 0,
	`jobs_updated` integer DEFAULT 0,
	`error_message` text,
	`duration` integer,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer,
	`name` text NOT NULL,
	`category` text,
	`proficiency` integer DEFAULT 3 NOT NULL,
	`years_of_experience` real,
	FOREIGN KEY (`profile_id`) REFERENCES `profile`(`id`) ON UPDATE no action ON DELETE cascade
);
