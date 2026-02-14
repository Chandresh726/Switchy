PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_generation_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content_id` integer NOT NULL,
	`variant` text NOT NULL,
	`user_prompt` text,
	`parent_variant_id` integer,
	`created_at` integer,
	FOREIGN KEY (`content_id`) REFERENCES `ai_generated_content`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_variant_id`) REFERENCES `ai_generation_history`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_ai_generation_history`("id", "content_id", "variant", "user_prompt", "parent_variant_id", "created_at") SELECT "id", "content_id", "variant", "user_prompt", "parent_variant_id", "created_at" FROM `ai_generation_history`;--> statement-breakpoint
DROP TABLE `ai_generation_history`;--> statement-breakpoint
ALTER TABLE `__new_ai_generation_history` RENAME TO `ai_generation_history`;--> statement-breakpoint
PRAGMA foreign_keys=ON;