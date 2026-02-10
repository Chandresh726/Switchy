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
