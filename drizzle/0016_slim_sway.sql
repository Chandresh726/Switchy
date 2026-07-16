CREATE TABLE `candidate_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`source_profile_id` integer,
	`fingerprint` text NOT NULL,
	`snapshot_version` text NOT NULL,
	`evidence_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `candidate_snapshots_source_profile_idx` ON `candidate_snapshots` (`source_profile_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_snapshots_fingerprint_version_unique` ON `candidate_snapshots` (`fingerprint`,`snapshot_version`);--> statement-breakpoint
CREATE TABLE `job_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`job_fingerprint` text NOT NULL,
	`extractor_version` text NOT NULL,
	`evidence_json` text NOT NULL,
	`ai_run_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ai_run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `job_analyses_created_at_idx` ON `job_analyses` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_analyses_fingerprint_extractor_unique` ON `job_analyses` (`job_fingerprint`,`extractor_version`);--> statement-breakpoint
CREATE TABLE `match_results` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` integer NOT NULL,
	`candidate_snapshot_id` text,
	`job_analysis_id` text,
	`candidate_fingerprint` text NOT NULL,
	`job_fingerprint` text NOT NULL,
	`scoring_policy_version` text NOT NULL,
	`score` real NOT NULL,
	`breakdown_json` text NOT NULL,
	`evidence_json` text NOT NULL,
	`confidence` real NOT NULL,
	`source` text NOT NULL,
	`adjudication_run_id` text,
	`is_stale` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_snapshot_id`) REFERENCES `candidate_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`job_analysis_id`) REFERENCES `job_analyses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`adjudication_run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `match_results_job_created_idx` ON `match_results` (`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `match_results_freshness_idx` ON `match_results` (`job_id`,`candidate_fingerprint`,`job_fingerprint`,`scoring_policy_version`,`is_stale`);--> statement-breakpoint
CREATE UNIQUE INDEX `match_results_artifact_unique` ON `match_results` (`job_id`,`candidate_fingerprint`,`job_fingerprint`,`scoring_policy_version`);