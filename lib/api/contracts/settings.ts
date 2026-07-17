import { z } from "zod";

const settingTextInputSchema = z.string().max(20_000);
const settingIntegerInputSchema = z.union([
  z.number().int(),
  z.string().regex(/^\d+$/),
]);
const settingBooleanInputSchema = z.union([
  z.boolean(),
  z.enum(["true", "false"]),
]);

export const settingsUpdateBodySchema = z.object({
  job_analysis_model: settingTextInputSchema,
  job_analysis_provider_id: settingTextInputSchema,
  job_analysis_reasoning_effort: settingTextInputSchema,
  matcher_model: settingTextInputSchema,
  matcher_provider_id: settingTextInputSchema,
  matcher_reasoning_effort: settingTextInputSchema,
  resume_parser_model: settingTextInputSchema,
  resume_parser_provider_id: settingTextInputSchema,
  resume_parser_reasoning_effort: settingTextInputSchema,
  matcher_batch_size: settingIntegerInputSchema,
  matcher_max_retries: settingIntegerInputSchema,
  matcher_concurrency_limit: settingIntegerInputSchema,
  matcher_timeout_ms: settingIntegerInputSchema,
  matcher_backoff_base_delay: settingIntegerInputSchema,
  matcher_backoff_max_delay: settingIntegerInputSchema,
  matcher_auto_match_after_scrape: settingBooleanInputSchema,
  scheduler_enabled: settingBooleanInputSchema,
  scheduler_cron: z.string().trim().min(1).max(500),
  scraper_max_parallel_scrapes: settingIntegerInputSchema,
  scraper_keep_device_awake: settingBooleanInputSchema,
  scraper_history_retention_days: settingIntegerInputSchema,
  scraper_filter_country: settingTextInputSchema,
  scraper_filter_city: settingTextInputSchema,
  scraper_filter_title_keywords: z.union([
    settingTextInputSchema,
    z.array(z.string().max(500)).max(500),
  ]),
  referral_tone: settingTextInputSchema,
  referral_length: settingTextInputSchema,
  follow_up_tone: settingTextInputSchema,
  follow_up_length: settingTextInputSchema,
  cover_letter_tone: settingTextInputSchema,
  cover_letter_length: settingTextInputSchema,
  cover_letter_focus: z.union([
    settingTextInputSchema,
    z.array(z.string().max(100)).max(10),
  ]),
  ai_writing_model: settingTextInputSchema,
  ai_writing_provider_id: settingTextInputSchema,
  ai_writing_reasoning_effort: settingTextInputSchema,
  codex_cli_executable: z.string().max(4_000),
  opencode_cli_executable: z.string().max(4_000),
}).partial().strict()
  .transform((value) => Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ))
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one known setting is required",
  });

export const settingsResponseSchema = z.object({
  job_analysis_model: z.string(),
  job_analysis_provider_id: z.string(),
  job_analysis_reasoning_effort: z.string(),
  matcher_model: z.string(),
  matcher_provider_id: z.string(),
  resume_parser_model: z.string(),
  resume_parser_provider_id: z.string(),
  matcher_reasoning_effort: z.string(),
  resume_parser_reasoning_effort: z.string(),
  matcher_batch_size: z.string(),
  matcher_max_retries: z.string(),
  matcher_concurrency_limit: z.string(),
  matcher_timeout_ms: z.string(),
  matcher_backoff_base_delay: z.string(),
  matcher_backoff_max_delay: z.string(),
  matcher_auto_match_after_scrape: z.string(),
  scheduler_enabled: z.string(),
  scheduler_cron: z.string(),
  scraper_max_parallel_scrapes: z.string(),
  scraper_keep_device_awake: z.string(),
  scraper_history_retention_days: z.string(),
  scraper_filter_country: z.string(),
  scraper_filter_city: z.string(),
  scraper_filter_title_keywords: z.string(),
  referral_tone: z.string(),
  referral_length: z.string(),
  follow_up_tone: z.string(),
  follow_up_length: z.string(),
  cover_letter_tone: z.string(),
  cover_letter_length: z.string(),
  cover_letter_focus: z.string(),
  ai_writing_model: z.string(),
  ai_writing_provider_id: z.string(),
  ai_writing_reasoning_effort: z.string(),
  codex_cli_executable: z.string(),
  opencode_cli_executable: z.string(),
});

const providerSettingsListItemSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  isActive: z.boolean(),
  hasApiKey: z.boolean(),
  createdAt: z.union([z.string(), z.date()]).nullable(),
  updatedAt: z.union([z.string(), z.date()]).nullable(),
  kind: z.enum(["api_key", "local_cli"]),
  connectionStatus: z
    .enum([
      "ready",
      "not_installed",
      "not_authenticated",
      "no_models",
      "incompatible",
      "error",
    ])
    .optional(),
  selectable: z.boolean(),
  cliVersion: z.string().optional(),
  statusMessage: z.string().optional(),
  lastCheckedAt: z.string().optional(),
});

export const providerSettingsListSchema = z.array(providerSettingsListItemSchema);

const reasoningControlSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("provider_default") }),
  z.object({
    kind: z.literal("effort"),
    options: z.array(
      z.object({
        value: z.string(),
        label: z.string().optional(),
        description: z.string().optional(),
      })
    ),
    defaultValue: z.string().optional(),
  }),
]);

const providerModelSchema = z.object({
  modelId: z.string(),
  label: z.string(),
  description: z.string(),
  supportsReasoning: z.boolean(),
  reasoningControl: reasoningControlSchema,
  group: z.string().optional(),
  upstreamProvider: z.string().optional(),
  supportedReasoningEfforts: z.array(z.string()).optional(),
  defaultReasoningEffort: z.string().optional(),
  isDefault: z.boolean().optional(),
});

export const providerModelsResponseSchema = z.object({
  providerId: z.string(),
  provider: z.enum([
    "anthropic",
    "openai",
    "gemini_api_key",
    "openrouter",
    "cerebras",
    "groq",
    "nvidia",
    "codex_cli",
    "opencode_cli",
  ]),
  models: z.array(providerModelSchema),
  fetchedAt: z.string(),
  isStale: z.boolean(),
  source: z.enum(["live", "cache"]),
  warning: z.string().optional(),
});

export const providerCreateResponseSchema = z.object({
  autoConfiguredDefaults: z.boolean().optional(),
  autoConfiguredModelId: z.string().optional(),
  autoConfiguredWarning: z.string().optional(),
});

export const clearMatchDataResponseSchema = z.object({
  jobsCleared: z.number().int().nonnegative(),
});

export const clearAiContentResponseSchema = z.object({
  success: z.boolean(),
  contentDeleted: z.number().int().nonnegative(),
  historyDeleted: z.number().int().nonnegative(),
  message: z.string(),
});

export const unmatchedJobsCountResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  days: z.number().int().positive(),
});

export const queuedMatchResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  status: z.enum(["queued", "completed"]),
  sessionId: z.string(),
});

export type Settings = z.infer<typeof settingsResponseSchema>;
export type ProviderSettingsListItem = z.infer<typeof providerSettingsListItemSchema>;
export type ProviderModelsResponse = z.infer<typeof providerModelsResponseSchema>;
export type ProviderModelOption = ProviderModelsResponse["models"][number];
export type ClearMatchDataResponse = z.infer<typeof clearMatchDataResponseSchema>;
export type ClearAIContentResponse = z.infer<typeof clearAiContentResponseSchema>;
export type UnmatchedJobsCountResponse = z.infer<typeof unmatchedJobsCountResponseSchema>;
export type QueuedMatchResponse = z.infer<typeof queuedMatchResponseSchema>;
