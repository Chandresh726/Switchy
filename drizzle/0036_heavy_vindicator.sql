PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_aiGeneratedContent` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`current_variant_id` integer,
	`settings_snapshot` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_variant_id`) REFERENCES `aiGenerationHistory`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_generated_content_current_variant_check" CHECK("__new_aiGeneratedContent"."current_variant_id" is null or "__new_aiGeneratedContent"."current_variant_id" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_aiGeneratedContent`("id", "job_id", "type", "content", "current_variant_id", "settings_snapshot", "created_at", "updated_at") SELECT "id", "job_id", "type", "content", "current_variant_id", "settings_snapshot", "created_at", "updated_at" FROM `aiGeneratedContent`;--> statement-breakpoint
DROP TABLE `aiGeneratedContent`;--> statement-breakpoint
ALTER TABLE `__new_aiGeneratedContent` RENAME TO `aiGeneratedContent`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `aiGeneratedContentJobTypeUnique` ON `aiGeneratedContent` (`job_id`,`type`);