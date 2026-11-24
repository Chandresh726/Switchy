PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
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
	`ai_fingerprint` text,
	`status` text DEFAULT 'new' NOT NULL,
	`posted_date` integer,
	`discovered_at` integer,
	`updated_at` integer,
	`archived_at` integer,
	`archive_source` text,
	`viewed_at` integer,
	`applied_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "jobs_status_check" CHECK("__new_jobs"."status" in ('new', 'viewed', 'interested', 'applied', 'rejected', 'archived'))
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "company_id", "external_id", "title", "description", "description_format", "url", "location", "location_type", "salary", "department", "employment_type", "seniority_level", "ai_fingerprint", "status", "posted_date", "discovered_at", "updated_at", "archived_at", "archive_source", "viewed_at", "applied_at") SELECT "id", "company_id", "external_id", "title", "description", "description_format", "url", "location", "location_type", "salary", "department", "employment_type", "seniority_level", "ai_fingerprint", "status", "posted_date", "discovered_at", "updated_at", "archived_at", "archive_source", "viewed_at", "applied_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `jobs_company_id_idx` ON `jobs` (`company_id`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_status_discovered_id_idx` ON `jobs` (`status`,`discovered_at`,`id`);--> statement-breakpoint
CREATE INDEX `jobs_stale_archive_idx` ON `jobs` (`status`,`posted_date`,`discovered_at`);--> statement-breakpoint
CREATE INDEX `jobs_company_discovered_id_idx` ON `jobs` (`company_id`,`discovered_at`,`id`);--> statement-breakpoint
CREATE INDEX `jobs_discovered_id_idx` ON `jobs` (`discovered_at`,`id`);--> statement-breakpoint
CREATE INDEX `jobs_ai_fingerprint_idx` ON `jobs` (`ai_fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_company_external_id_unique` ON `jobs` (`company_id`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_company_url_unique` ON `jobs` (`company_id`,`url`);--> statement-breakpoint
CREATE TABLE `__new_match_results` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` integer NOT NULL,
	`candidate_snapshot_id` text,
	`job_analysis_id` text,
	`candidate_fingerprint` text NOT NULL,
	`job_fingerprint` text NOT NULL,
	`scoring_policy_version` text NOT NULL,
	`match_policy_version` text,
	`score` real NOT NULL,
	`breakdown_json` text NOT NULL,
	`evidence_json` text NOT NULL,
	`confidence` real NOT NULL,
	`source` text NOT NULL,
	`adjudication_run_id` text,
	`match_run_id` text,
	`is_stale` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_snapshot_id`) REFERENCES `candidate_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`job_analysis_id`) REFERENCES `job_analyses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`adjudication_run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`match_run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "match_results_score_check" CHECK("__new_match_results"."score" >= 0 and "__new_match_results"."score" <= 100)
);
--> statement-breakpoint
INSERT INTO `__new_match_results`("id", "job_id", "candidate_snapshot_id", "job_analysis_id", "candidate_fingerprint", "job_fingerprint", "scoring_policy_version", "match_policy_version", "score", "breakdown_json", "evidence_json", "confidence", "source", "adjudication_run_id", "match_run_id", "is_stale", "created_at") SELECT "id", "job_id", "candidate_snapshot_id", "job_analysis_id", "candidate_fingerprint", "job_fingerprint", "scoring_policy_version", "match_policy_version", "score", "breakdown_json", "evidence_json", "confidence", "source", "adjudication_run_id", "match_run_id", "is_stale", "created_at" FROM `match_results`;--> statement-breakpoint
DROP TABLE `match_results`;--> statement-breakpoint
ALTER TABLE `__new_match_results` RENAME TO `match_results`;--> statement-breakpoint
CREATE INDEX `match_results_job_created_idx` ON `match_results` (`job_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `match_results_presentation_idx` ON `match_results` (`job_id`,`candidate_fingerprint`,`is_stale`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `match_results_freshness_idx` ON `match_results` (`job_id`,`candidate_fingerprint`,`job_fingerprint`,`scoring_policy_version`,`is_stale`);--> statement-breakpoint
CREATE UNIQUE INDEX `match_results_artifact_unique` ON `match_results` (`job_id`,`candidate_fingerprint`,`job_fingerprint`,`scoring_policy_version`);