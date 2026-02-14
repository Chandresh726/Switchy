-- Rename ai_generated_content to aiGeneratedContent
ALTER TABLE `ai_generated_content` RENAME TO `aiGeneratedContent`;

-- Rename ai_generation_history to aiGenerationHistory
ALTER TABLE `ai_generation_history` RENAME TO `aiGenerationHistory`;

-- Update unique constraint name
DROP INDEX IF EXISTS `ai_generated_content_job_type_unique`;
CREATE UNIQUE INDEX IF NOT EXISTS `aiGeneratedContentJobTypeUnique` ON `aiGeneratedContent` (`job_id`,`type`);
