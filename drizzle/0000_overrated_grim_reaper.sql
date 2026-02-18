CREATE TABLE `aiGeneratedContent` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`settings_snapshot` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aiGeneratedContentJobTypeUnique` ON `aiGeneratedContent` (`job_id`,`type`);--> statement-breakpoint
CREATE TABLE `aiGenerationHistory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content_id` integer NOT NULL,
	`variant` text NOT NULL,
	`user_prompt` text,
	`parent_variant_id` integer,
	`created_at` integer,
	FOREIGN KEY (`content_id`) REFERENCES `aiGeneratedContent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_variant_id`) REFERENCES `aiGenerationHistory`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `aiProviders` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`api_key` text,
	`is_active` integer DEFAULT true,
	`is_default` integer DEFAULT false,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`careers_url` text NOT NULL,
	`logo_url` text,
	`platform` text,
	`board_token` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_scraped_at` integer,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `companies_careers_url_idx` ON `companies` (`careers_url`);--> statement-breakpoint
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
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`external_id` text,
	`title` text NOT NULL,
	`description` text,
	`description_format` text DEFAULT 'plain' NOT NULL,
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
CREATE INDEX `jobs_company_id_idx` ON `jobs` (`company_id`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_match_score_idx` ON `jobs` (`match_score`);--> statement-breakpoint
CREATE TABLE `match_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text,
	`job_id` integer,
	`status` text NOT NULL,
	`score` real,
	`attempt_count` integer DEFAULT 1,
	`error_type` text,
	`error_message` text,
	`duration` integer,
	`model_used` text,
	`completed_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `match_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `match_logs_session_id_idx` ON `match_logs` (`session_id`);--> statement-breakpoint
CREATE TABLE `match_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger_source` text NOT NULL,
	`company_id` integer,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`jobs_total` integer DEFAULT 0,
	`jobs_completed` integer DEFAULT 0,
	`jobs_succeeded` integer DEFAULT 0,
	`jobs_failed` integer DEFAULT 0,
	`error_count` integer DEFAULT 0,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
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
CREATE TABLE `resumes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer,
	`file_name` text NOT NULL,
	`file_path` text NOT NULL,
	`parsed_data` text NOT NULL,
	`version` integer NOT NULL,
	`is_current` integer DEFAULT false NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`profile_id`) REFERENCES `profile`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scrape_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger_source` text NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`companies_total` integer DEFAULT 0,
	`companies_completed` integer DEFAULT 0,
	`total_jobs_found` integer DEFAULT 0,
	`total_jobs_added` integer DEFAULT 0,
	`total_jobs_filtered` integer DEFAULT 0,
	`started_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
CREATE TABLE `scraping_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer,
	`session_id` text,
	`trigger_source` text,
	`status` text NOT NULL,
	`jobs_found` integer DEFAULT 0,
	`jobs_added` integer DEFAULT 0,
	`jobs_updated` integer DEFAULT 0,
	`jobs_filtered` integer DEFAULT 0,
	`platform` text,
	`error_message` text,
	`duration` integer,
	`started_at` integer,
	`completed_at` integer,
	`matcher_status` text,
	`matcher_jobs_total` integer,
	`matcher_jobs_completed` integer,
	`matcher_duration` integer,
	`matcher_error_count` integer DEFAULT 0,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `scrape_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scraping_logs_session_id_idx` ON `scraping_logs` (`session_id`);--> statement-breakpoint
CREATE INDEX `scraping_logs_company_id_idx` ON `scraping_logs` (`company_id`);--> statement-breakpoint
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
