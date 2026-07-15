import type { ReasoningEffort } from "@/lib/ai/providers/types";
import type { ProviderModelDefinition } from "@/lib/ai/providers/model-catalog";

export interface ProviderModelsState {
  models: ProviderModelDefinition[];
  loading: boolean;
  isRefreshing: boolean;
  isStale: boolean;
  error?: string;
}

export interface SettingsRecord {
  matcher_model: string;
  matcher_provider_id: string;
  resume_parser_model: string;
  resume_parser_provider_id: string;
  matcher_reasoning_effort: string;
  matcher_accepted_location_types: string;
  matcher_accepted_employment_types: string;
  resume_parser_reasoning_effort: string;
  matcher_batch_size: string;
  matcher_max_retries: string;
  matcher_concurrency_limit: string;
  matcher_timeout_ms: string;
  matcher_auto_match_after_scrape: string;
  scheduler_enabled: string;
  scheduler_cron: string;
  scraper_max_parallel_scrapes: string;
  scraper_keep_device_awake: string;
  scraper_history_retention_days: string;
  scraper_filter_country?: string;
  scraper_filter_city?: string;
  scraper_filter_title_keywords?: string;
  referral_tone?: string;
  referral_length?: string;
  follow_up_tone?: string;
  follow_up_length?: string;
  cover_letter_tone?: string;
  cover_letter_length?: string;
  cover_letter_focus?: string;
  ai_writing_model?: string;
  ai_writing_provider_id?: string;
  ai_writing_reasoning_effort?: string;
  codex_cli_executable?: string;
  opencode_cli_executable?: string;
}

export interface ProviderSettingsListItem {
  id: string;
  provider: string;
  isActive: boolean;
  hasApiKey: boolean;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
  kind: "api_key" | "local_cli";
  connectionStatus?: import("@/lib/ai/local-cli/types").LocalCLIConnectionStatus;
  selectable: boolean;
  cliVersion?: string;
  statusMessage?: string;
  lastCheckedAt?: string;
}

export type { ReasoningEffort };
