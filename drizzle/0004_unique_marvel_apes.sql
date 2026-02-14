CREATE TABLE `ai_generated_content` (
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
CREATE TABLE `ai_generation_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content_id` integer NOT NULL,
	`variant` text NOT NULL,
	`user_prompt` text,
	`parent_variant_id` integer,
	`created_at` integer,
	FOREIGN KEY (`content_id`) REFERENCES `ai_generated_content`(`id`) ON UPDATE no action ON DELETE cascade
);
