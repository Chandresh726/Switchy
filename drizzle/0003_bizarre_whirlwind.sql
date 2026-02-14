CREATE TABLE `ai_interactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`interaction_type` text NOT NULL,
	`prompt` text NOT NULL,
	`response` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
