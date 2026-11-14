"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { clearAllAIContent } from "@/lib/api/clients/ai";
import { getReadiness, getRuntimeHealth } from "@/lib/api/clients/health";
import { clearJobMatchData, clearJobs } from "@/lib/api/clients/jobs";
import {
  createProvider,
  deleteProvider,
  getLocalCLIStatus,
  getProviderModels,
  getProviders,
  updateProvider,
  updateProviderApiKey,
} from "@/lib/api/clients/providers";
import {
  getUnmatchedJobsCount,
  queueUnmatchedJobs,
} from "@/lib/api/clients/runtime";
import { getSettings, patchSettings } from "@/lib/api/clients/settings";
import { AI_MODEL_FEATURES, resolveFeatureModel } from "@/components/settings/feature-model-settings";
import { useSettingsAutosave } from "@/components/settings/use-settings-autosave";
import { AppearanceSection } from "@/components/settings/appearance-section";
import { MatcherFallbackSettings, type FallbackSettings } from "@/components/settings/matcher-fallback-settings";
import { MatcherSection } from "@/components/settings/matcher-section";
import { NotificationsSection } from "@/components/settings/notifications-section";
import { PowerSettings } from "@/components/settings/power-settings";
import { ScraperSettings } from "@/components/settings/scraper-settings";
import { DangerZone } from "@/components/settings/danger-zone";
import { ResumeParserSection } from "@/components/settings/resume-parser-section";
import { SystemInfo } from "@/components/settings/system-info";
import { AIWritingSection, type AIWritingSettings } from "@/components/settings/ai-writing-section";
import { AIProvidersManager } from "@/components/settings/ai-providers-manager";
import {
  hasInvalidReasoningSelection,
  resolveReasoningSelection,
} from "@/components/settings/reasoning-effort-control";
import { ApiErrorState } from "@/components/ui/api-error-state";
import { getProviderMetadata } from "@/lib/ai/providers/metadata";
import {
  isLocalCLIProvider,
  type AIProvider,
  type LocalCLIProvider,
} from "@/lib/ai/providers/types";
import { APP_VERSION, DB_PATH } from "@/lib/constants";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useMatchSession } from "@/lib/hooks/use-match-session";
import type {
  ProviderModelsResponse,
  ProviderSettingsListItem,
  Settings,
} from "@/lib/api/contracts/settings";
import type {
  ProviderCreateBody,
  ProviderPatchBody,
} from "@/lib/api/contracts/providers";
import type {
  ProviderModelsState,
  ReasoningEffort,
} from "@/lib/settings/types";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/error-presentation";

const PROVIDER_MODELS_STALE_TIME_MS = 15 * 60 * 1000;
const LOCAL_CLI_STATUS_STALE_TIME_MS = 30_000;
const DEFAULT_SCRAPER_MAX_PARALLEL_SCRAPES = 3;
const DEFAULT_SCRAPER_HISTORY_RETENTION_DAYS = 60;
const DEFAULT_SCRAPER_STALE_JOB_ARCHIVE_DAYS = 60;

function clampScraperParallelScrapes(value: number): number {
  return Math.min(10, Math.max(1, value));
}

function clampScraperHistoryRetentionDays(value: number): number {
  return Math.min(3_650, Math.max(7, value));
}

function clampScraperStaleJobArchiveDays(value: number): number {
  return Math.min(3_650, Math.max(7, value));
}

interface MatcherLocalEdits {
  fallbackSettings?: Partial<FallbackSettings>;
  jobAnalysisModel?: string;
  jobAnalysisProviderId?: string;
  jobAnalysisReasoningEffort?: ReasoningEffort;
  matcherModel?: string;
  matcherProviderId?: string;
  matcherReasoningEffort?: ReasoningEffort;
  batchSize?: number;
  maxRetries?: number;
  concurrencyLimit?: number;
  timeoutMs?: number;
  autoMatchAfterScrape?: boolean;
}

interface ResumeParserLocalEdits {
  resumeParserModel?: string;
  resumeParserProviderId?: string;
  resumeParserReasoningEffort?: ReasoningEffort;
}

interface ScraperLocalEdits {
  schedulerEnabled?: boolean;
  schedulerCron?: string;
  maxParallelScrapes?: number;
  historyRetentionDays?: number;
  staleJobArchiveDays?: number;
  filterCountry?: string;
  filterCity?: string;
  filterTitleKeywords?: string[];
}

interface AIWritingLocalEdits {
  referralTone?: string;
  referralLength?: string;
  followUpTone?: string;
  followUpLength?: string;
  coverLetterTone?: string;
  coverLetterLength?: string;
  coverLetterFocus?: string[];
  aiWritingModel?: string;
  aiWritingProviderId?: string;
  aiWritingReasoningEffort?: ReasoningEffort;
}

function SettingsHeader() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
      <p className="mt-1 text-muted-foreground">Configure your Switchy preferences and manage data</p>
    </div>
  );
}

function SettingsContent() {
  const queryClient = useQueryClient();
  const router = useRouter();

  const [matcherLocalEdits, setMatcherLocalEdits] = useState<MatcherLocalEdits>({});
  const [resumeParserLocalEdits, setResumeParserLocalEdits] = useState<ResumeParserLocalEdits>({});
  const [powerLocalEdits, setPowerLocalEdits] = useState<{ keepDeviceAwake?: boolean }>({});
  const [scraperLocalEdits, setScraperLocalEdits] = useState<ScraperLocalEdits>({});
  const [aiWritingLocalEdits, setAIWritingLocalEdits] = useState<AIWritingLocalEdits>({});
  const [unmatchedWindowDays, setUnmatchedWindowDays] = useState(5);
  const debouncedUnmatchedWindowDays = useDebounce(unmatchedWindowDays, 250);
  const lastModelReconciliationRef = useRef<string | null>(null);
  const failedModelReconciliationRef = useRef<string | null>(null);

  const settingsQuery = useQuery<Settings>({
    queryKey: queryKeys.settings.detail(),
    queryFn: getSettings,
  });

  const fetchProviderModels = async (
    providerId: string,
    forceRefresh = false
  ): Promise<ProviderModelsResponse> => {
    return getProviderModels(providerId, forceRefresh ? { refresh: "1" } : {});
  };

  const providersQuery = useQuery<ProviderSettingsListItem[]>({
    queryKey: queryKeys.providers.list(),
    queryFn: getProviders,
  });
  const settings = settingsQuery.data;
  const providerRecords = useMemo(() => providersQuery.data ?? [], [providersQuery.data]);
  const localCLIProviders = useMemo(
    () => providerRecords.filter(
      (provider): provider is ProviderSettingsListItem & {
        kind: "local_cli";
        provider: LocalCLIProvider;
      } => provider.kind === "local_cli" && isLocalCLIProvider(provider.provider)
    ),
    [providerRecords]
  );
  const localCLIStatusQueries = useQueries({
    queries: localCLIProviders.map((provider) => ({
      queryKey: queryKeys.providers.status(provider.id),
      queryFn: () => getLocalCLIStatus(provider.provider),
      staleTime: LOCAL_CLI_STATUS_STALE_TIME_MS,
      retry: 1,
    })),
  });
  const providers = useMemo(() => {
    const statusQueriesByProviderId = new Map(
      localCLIProviders.map((provider, index) => [
        provider.id,
        localCLIStatusQueries[index],
      ])
    );

    return providerRecords.map((provider) => {
      if (provider.kind !== "local_cli") return provider;

      const statusQuery = statusQueriesByProviderId.get(provider.id);
      const connection = statusQuery?.data;
      if (connection) {
        return {
          ...provider,
          connectionStatus: connection.status,
          selectable: connection.selectable,
          cliVersion: connection.cliVersion,
          statusMessage: connection.statusMessage,
          lastCheckedAt: connection.lastCheckedAt,
        };
      }
      if (statusQuery?.isError) {
        return {
          ...provider,
          connectionStatus: "error" as const,
          selectable: false,
          statusMessage: getApiErrorMessage(statusQuery.error, "Failed to check local CLI"),
        };
      }
      return provider;
    });
  }, [localCLIProviders, localCLIStatusQueries, providerRecords]);
  const readinessQuery = useQuery({
    queryKey: queryKeys.runtime.readiness(),
    queryFn: getReadiness,
    refetchInterval: 15_000,
  });
  const runtimeHealthQuery = useQuery({
    queryKey: queryKeys.runtime.diagnostics(),
    queryFn: getRuntimeHealth,
    refetchInterval: 15_000,
  });

  const providerModelsQueries = useQueries({
    queries: providers.map((provider) => ({
      queryKey: queryKeys.providers.model(provider.id),
      queryFn: async () => fetchProviderModels(provider.id),
      enabled: Boolean(provider.id) && (provider.kind === "api_key" || provider.selectable),
      staleTime: PROVIDER_MODELS_STALE_TIME_MS,
      retry: 1,
    })),
  });

  const providerModelsById = useMemo<Record<string, ProviderModelsState>>(() => {
    const state: Record<string, ProviderModelsState> = {};

    providers.forEach((provider, index) => {
      const query = providerModelsQueries[index];
      const data = query?.data;
      const queryError = query?.error
        ? getApiErrorMessage(query.error, "Failed to load provider models")
        : undefined;
      const warning = data?.warning;

      state[provider.id] = {
        models: data?.models ?? [],
        loading: Boolean(query?.isFetching && !data),
        isRefreshing: Boolean(query?.isFetching && data),
        isStale: data?.isStale ?? false,
        error: queryError ?? warning ?? (
          provider.kind === "local_cli" && !provider.selectable
            ? provider.statusMessage
            : undefined
        ),
      };
    });

    return state;
  }, [providerModelsQueries, providers]);

  const refreshProviderModels = async (providerId: string): Promise<void> => {
    try {
      const models = await fetchProviderModels(providerId, true);
      queryClient.setQueryData(queryKeys.providers.model(providerId), models);
      toast.success("Model list refreshed");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to refresh model list"));
    }
  };

  const saveCLIExecutablePaths = useCallback(async (paths: { codex: string; opencode: string }) => {
    await patchSettings({
        codex_cli_executable: paths.codex,
        opencode_cli_executable: paths.opencode,
      });
    await cacheOwnership.providerMutation(queryClient);
  }, [queryClient]);

  const isInitialLoading = settingsQuery.isLoading || providersQuery.isLoading;

  const addProviderMutation = useMutation({
    mutationFn: async (input: ProviderCreateBody) => {
      return createProvider(input);
    },
    onSuccess: (data) => {
      void cacheOwnership.providerMutation(queryClient);

      if (data.autoConfiguredWarning) {
        toast.warning(data.autoConfiguredWarning);
      } else if (data.autoConfiguredDefaults) {
        toast.success(
          data.autoConfiguredModelId
            ? `Provider added. Default model set to ${data.autoConfiguredModelId}`
            : "Provider added and defaults auto-configured"
        );
      } else {
        toast.success("Provider added successfully");
      }
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to add provider")),
  });

  const deleteProviderMutation = useMutation({
    mutationFn: deleteProvider,
    onSuccess: () => {
      void cacheOwnership.providerMutation(queryClient);
      toast.success("Provider deleted successfully");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to delete provider")),
  });

  const updateProviderApiKeyMutation = useMutation({
    mutationFn: ({ id, apiKey }: { id: string; apiKey?: string | null }) =>
      updateProviderApiKey(id, { apiKey }),
    onSuccess: () => {
      void cacheOwnership.providerMutation(queryClient);
      toast.success("Provider API key updated");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to update provider API key")),
  });

  const updateProviderMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ProviderPatchBody }) =>
      updateProvider(id, input),
    onSuccess: () => {
      void cacheOwnership.providerMutation(queryClient);
      toast.success("Provider connection updated");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to update provider connection")),
  });

  const featureModels = useMemo(
    () => ({
      job_analysis: resolveFeatureModel(
        "job_analysis",
        {
          providerId: matcherLocalEdits.jobAnalysisProviderId,
          modelId: matcherLocalEdits.jobAnalysisModel,
          reasoningEffort: matcherLocalEdits.jobAnalysisReasoningEffort,
        },
        settings,
        providers,
        providerModelsById,
      ),
      matcher: resolveFeatureModel(
        "matcher",
        {
          providerId: matcherLocalEdits.matcherProviderId,
          modelId: matcherLocalEdits.matcherModel,
          reasoningEffort: matcherLocalEdits.matcherReasoningEffort,
        },
        settings,
        providers,
        providerModelsById,
      ),
      resume_parser: resolveFeatureModel(
        "resume_parser",
        {
          providerId: resumeParserLocalEdits.resumeParserProviderId,
          modelId: resumeParserLocalEdits.resumeParserModel,
          reasoningEffort: resumeParserLocalEdits.resumeParserReasoningEffort,
        },
        settings,
        providers,
        providerModelsById,
      ),
      ai_writing: resolveFeatureModel(
        "ai_writing",
        {
          providerId: aiWritingLocalEdits.aiWritingProviderId,
          modelId: aiWritingLocalEdits.aiWritingModel,
          reasoningEffort: aiWritingLocalEdits.aiWritingReasoningEffort,
        },
        settings,
        providers,
        providerModelsById,
      ),
    }),
    [
      settings,
      providers,
      providerModelsById,
      matcherLocalEdits,
      resumeParserLocalEdits,
      aiWritingLocalEdits,
    ],
  );

  const derivedValues = useMemo(() => {
    return {
      jobAnalysisModel: featureModels.job_analysis.modelId,
      jobAnalysisProviderId: featureModels.job_analysis.providerId,
      jobAnalysisReasoningEffort: featureModels.job_analysis.reasoningEffort,
      matcherModel: featureModels.matcher.modelId,
      matcherProviderId: featureModels.matcher.providerId,
      matcherReasoningEffort: featureModels.matcher.reasoningEffort,
      resumeParserModel: featureModels.resume_parser.modelId,
      resumeParserProviderId: featureModels.resume_parser.providerId,
      resumeParserReasoningEffort: featureModels.resume_parser.reasoningEffort,
      aiWritingModel: featureModels.ai_writing.modelId,
      aiWritingProviderId: featureModels.ai_writing.providerId,
      aiWritingReasoningEffort: featureModels.ai_writing.reasoningEffort,
      batchSize: matcherLocalEdits.batchSize ?? parseInt(settings?.matcher_batch_size || "2", 10),
      maxRetries: matcherLocalEdits.maxRetries ?? parseInt(settings?.matcher_max_retries || "3", 10),
      concurrencyLimit: matcherLocalEdits.concurrencyLimit ?? parseInt(settings?.matcher_concurrency_limit || "3", 10),
      timeoutMs:
        matcherLocalEdits.timeoutMs ??
        parseInt(settings?.matcher_timeout_ms || "120000", 10),
      autoMatchAfterScrape:
        matcherLocalEdits.autoMatchAfterScrape ??
        (settings?.matcher_auto_match_after_scrape !== "false"),
      schedulerEnabled:
        scraperLocalEdits.schedulerEnabled ??
        (settings?.scheduler_enabled !== "false"),
      schedulerCron:
        scraperLocalEdits.schedulerCron ??
        (settings?.scheduler_cron || "0 */6 * * *"),
      maxParallelScrapes:
        scraperLocalEdits.maxParallelScrapes ??
        clampScraperParallelScrapes(
          parseInt(
            settings?.scraper_max_parallel_scrapes ||
              String(DEFAULT_SCRAPER_MAX_PARALLEL_SCRAPES),
            10
          ) || DEFAULT_SCRAPER_MAX_PARALLEL_SCRAPES
        ),
      keepDeviceAwake:
        powerLocalEdits.keepDeviceAwake ??
        (settings?.scraper_keep_device_awake !== "false"),
      historyRetentionDays:
        scraperLocalEdits.historyRetentionDays ??
        clampScraperHistoryRetentionDays(
          parseInt(
            settings?.scraper_history_retention_days ||
              String(DEFAULT_SCRAPER_HISTORY_RETENTION_DAYS),
            10
          ) || DEFAULT_SCRAPER_HISTORY_RETENTION_DAYS
        ),
      staleJobArchiveDays:
        scraperLocalEdits.staleJobArchiveDays ??
        clampScraperStaleJobArchiveDays(
          parseInt(
            settings?.scraper_stale_job_archive_days ||
              String(DEFAULT_SCRAPER_STALE_JOB_ARCHIVE_DAYS),
            10
          ) || DEFAULT_SCRAPER_STALE_JOB_ARCHIVE_DAYS
        ),
      filterCountry: scraperLocalEdits.filterCountry ?? (settings?.scraper_filter_country || "India"),
      filterCity: scraperLocalEdits.filterCity ?? (settings?.scraper_filter_city || ""),
      filterTitleKeywords: (() => {
        if (scraperLocalEdits.filterTitleKeywords !== undefined) return scraperLocalEdits.filterTitleKeywords;
        const raw = settings?.scraper_filter_title_keywords;
        if (!raw) return [];
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string").map((v) => String(v).trim()).filter(Boolean) : [];
        } catch {
          return [];
        }
      })(),
      referralTone: aiWritingLocalEdits.referralTone ?? (settings?.referral_tone || "professional"),
      referralLength: aiWritingLocalEdits.referralLength ?? (settings?.referral_length || "medium"),
      followUpTone: aiWritingLocalEdits.followUpTone ?? (settings?.follow_up_tone || "professional"),
      followUpLength: aiWritingLocalEdits.followUpLength ?? (settings?.follow_up_length || "medium"),
      coverLetterTone: aiWritingLocalEdits.coverLetterTone ?? (settings?.cover_letter_tone || "professional"),
      coverLetterLength: aiWritingLocalEdits.coverLetterLength ?? (settings?.cover_letter_length || "medium"),
      coverLetterFocus: aiWritingLocalEdits.coverLetterFocus ?? (() => {
        const stored = settings?.cover_letter_focus;
        if (!stored) return ["skills", "experience", "cultural_fit"];
        try {
          const parsed = JSON.parse(stored);
          return Array.isArray(parsed) ? parsed : ["skills", "experience", "cultural_fit"];
        } catch {
          return ["skills", "experience", "cultural_fit"];
        }
      })(),
    };
  }, [settings, matcherLocalEdits, scraperLocalEdits, powerLocalEdits, aiWritingLocalEdits, featureModels]);

  const {
    jobAnalysisModel, jobAnalysisProviderId, jobAnalysisReasoningEffort,
    matcherModel, matcherProviderId, resumeParserModel, resumeParserProviderId, matcherReasoningEffort, resumeParserReasoningEffort, batchSize, maxRetries, concurrencyLimit, timeoutMs,
    autoMatchAfterScrape, schedulerEnabled, schedulerCron, maxParallelScrapes, keepDeviceAwake, historyRetentionDays, staleJobArchiveDays, filterCountry, filterCity, filterTitleKeywords,
    aiWritingModel, aiWritingProviderId, aiWritingReasoningEffort, referralTone, referralLength,
    followUpTone, followUpLength, coverLetterTone, coverLetterLength, coverLetterFocus
  } = derivedValues;

  const providerOptions = useMemo(() => {
    const configuredProviderIds = new Set([
      settings?.job_analysis_provider_id,
      settings?.matcher_provider_id,
      settings?.resume_parser_provider_id,
      settings?.ai_writing_provider_id,
    ].filter(Boolean));
    return providers.filter(
      (provider) => provider.selectable || configuredProviderIds.has(provider.id)
    ).map((provider) => {
      const meta = getProviderMetadata(provider.provider as AIProvider);
      return {
        id: provider.id,
        provider: provider.provider,
        name: provider.displayName ?? meta.displayName,
        isActive: provider.isActive,
      };
    });
  }, [providers, settings]);

  const getProviderModelsState = (providerId: string): ProviderModelsState => {
    return providerModelsById[providerId] ?? {
      models: [],
      loading: false,
      isRefreshing: false,
      isStale: false,
    };
  };

  const jobAnalysisModelsState = getProviderModelsState(jobAnalysisProviderId);
  const matcherModelsState = getProviderModelsState(matcherProviderId);
  const resumeParserModelsState = getProviderModelsState(resumeParserProviderId);
  const aiWritingModelsState = getProviderModelsState(aiWritingProviderId);

  const reconcileModelsMutation = useMutation({
    mutationFn: ({ updates }: { updates: Record<string, string>; features: string[]; signature: string }) =>
      patchSettings(updates),
    onSuccess: (_data, variables) => {
      lastModelReconciliationRef.current = null;
      failedModelReconciliationRef.current = null;
      const updatedFeatures = Array.from(new Set(variables.features));
      if (updatedFeatures.length > 0) {
        toast.warning(`Updated invalid AI model settings for ${updatedFeatures.join(", ")}.`);
      }
      void cacheOwnership.settingsMutation(queryClient);
    },
    onError: (error, variables) => {
      lastModelReconciliationRef.current = null;
      failedModelReconciliationRef.current = variables.signature;
      toast.error(getApiErrorMessage(error, "Failed to auto-fix invalid model settings"), {
        action: {
          label: "Retry",
          onClick: () => {
            failedModelReconciliationRef.current = null;
            lastModelReconciliationRef.current = variables.signature;
            reconcileModelsMutation.mutate(variables);
          },
        },
      });
    },
  });

  useEffect(() => {
    if (!settings || providers.length === 0 || reconcileModelsMutation.isPending) {
      return;
    }

    const updates: Record<string, string> = {};
    const features: string[] = [];

    for (const feature of Object.keys(AI_MODEL_FEATURES) as Array<keyof typeof AI_MODEL_FEATURES>) {
      const keys = AI_MODEL_FEATURES[feature];
      const resolved = featureModels[feature];
      const catalog = providerModelsById[resolved.providerId];
      if (!catalog || catalog.loading || catalog.models.length === 0 || resolved.localProviderEdited || resolved.localModelEdited || !resolved.providerId || !resolved.modelId) continue;
      if ((settings[keys.provider] || "") !== resolved.providerId) updates[keys.provider] = resolved.providerId;
      if ((settings[keys.model] || "") !== resolved.modelId) updates[keys.model] = resolved.modelId;
      if (updates[keys.provider] || updates[keys.model]) features.push(keys.label);
    }

    if (Object.keys(updates).length === 0) {
      lastModelReconciliationRef.current = null;
      failedModelReconciliationRef.current = null;
      return;
    }

    const signature = JSON.stringify(updates);
    if (
      lastModelReconciliationRef.current === signature ||
      failedModelReconciliationRef.current === signature
    ) {
      return;
    }

    lastModelReconciliationRef.current = signature;
    reconcileModelsMutation.mutate({ updates, features, signature });
  }, [settings, providers.length, featureModels, providerModelsById, reconcileModelsMutation]);

  const scraperHasUnsavedChanges =
    scraperLocalEdits.schedulerCron !== undefined ||
    scraperLocalEdits.maxParallelScrapes !== undefined ||
    scraperLocalEdits.historyRetentionDays !== undefined ||
    scraperLocalEdits.staleJobArchiveDays !== undefined ||
    scraperLocalEdits.filterCountry !== undefined ||
    scraperLocalEdits.filterCity !== undefined ||
    scraperLocalEdits.filterTitleKeywords !== undefined;
  const matcherHasUnsavedChanges =
    matcherLocalEdits.fallbackSettings !== undefined ||
    matcherLocalEdits.jobAnalysisModel !== undefined ||
    matcherLocalEdits.jobAnalysisProviderId !== undefined ||
    matcherLocalEdits.jobAnalysisReasoningEffort !== undefined ||
    matcherLocalEdits.matcherModel !== undefined ||
    matcherLocalEdits.matcherProviderId !== undefined ||
    matcherLocalEdits.matcherReasoningEffort !== undefined ||
    matcherLocalEdits.batchSize !== undefined ||
    matcherLocalEdits.maxRetries !== undefined ||
    matcherLocalEdits.concurrencyLimit !== undefined ||
    matcherLocalEdits.timeoutMs !== undefined ||
    matcherLocalEdits.autoMatchAfterScrape !== undefined;

  const aiWritingHasUnsavedChanges =
    aiWritingLocalEdits.referralTone !== undefined ||
    aiWritingLocalEdits.referralLength !== undefined ||
    aiWritingLocalEdits.followUpTone !== undefined ||
    aiWritingLocalEdits.followUpLength !== undefined ||
    aiWritingLocalEdits.coverLetterTone !== undefined ||
    aiWritingLocalEdits.coverLetterLength !== undefined ||
    aiWritingLocalEdits.coverLetterFocus !== undefined ||
    aiWritingLocalEdits.aiWritingModel !== undefined ||
    aiWritingLocalEdits.aiWritingProviderId !== undefined ||
    aiWritingLocalEdits.aiWritingReasoningEffort !== undefined;

  // Setters for Matcher settings
  const setJobAnalysisModel = (value: string) => {
    const defaultReasoningEffort = resolveReasoningSelection({
      providerWasEdited: true,
      model: jobAnalysisModelsState.models.find((model) => model.modelId === value),
    });
    setMatcherLocalEdits((previous) => ({
      ...previous,
      jobAnalysisModel: value,
      jobAnalysisReasoningEffort: defaultReasoningEffort,
    }));
  };
  const setJobAnalysisReasoningEffort = (value: ReasoningEffort) =>
    setMatcherLocalEdits((previous) => ({
      ...previous,
      jobAnalysisReasoningEffort: value,
    }));
  const setMatcherModel = (value: string) => {
    const defaultReasoningEffort = resolveReasoningSelection({
      providerWasEdited: true,
      model: matcherModelsState.models.find((model) => model.modelId === value),
    });
    setMatcherLocalEdits((previous) => ({
      ...previous,
      matcherModel: value,
      matcherReasoningEffort: defaultReasoningEffort,
    }));
  };
  const setMatcherReasoningEffort = (value: ReasoningEffort) => setMatcherLocalEdits(prev => ({ ...prev, matcherReasoningEffort: value }));
  const setAutoMatchAfterScrape = (value: boolean) =>
    setMatcherLocalEdits((prev) => ({ ...prev, autoMatchAfterScrape: value }));
  const setBatchSize = (value: number) => setMatcherLocalEdits(prev => ({ ...prev, batchSize: value }));
  const setMaxRetries = (value: number) => setMatcherLocalEdits(prev => ({ ...prev, maxRetries: value }));
  const setConcurrencyLimit = (value: number) => setMatcherLocalEdits(prev => ({ ...prev, concurrencyLimit: value }));
  const setTimeoutMs = (value: number) => setMatcherLocalEdits(prev => ({ ...prev, timeoutMs: value }));

  // Auto-save setters for Resume Parser (independent from Matcher)
  const setResumeParserModel = (value: string) =>
    setResumeParserLocalEdits((previous) => {
      const defaultReasoningEffort = resolveReasoningSelection({
        providerWasEdited: true,
        model: resumeParserModelsState.models.find((model) => model.modelId === value),
      });
      return {
        ...previous,
        resumeParserModel: value,
        resumeParserReasoningEffort: defaultReasoningEffort,
      };
    });
  const setResumeParserReasoningEffort = (value: ReasoningEffort) =>
    setResumeParserLocalEdits(prev => ({ ...prev, resumeParserReasoningEffort: value }));
  const setSchedulerCron = (value: string) =>
    setScraperLocalEdits((prev) => ({ ...prev, schedulerCron: value }));
  const setMaxParallelScrapes = (value: number) =>
    setScraperLocalEdits((prev) => ({ ...prev, maxParallelScrapes: clampScraperParallelScrapes(value) }));
  const setKeepDeviceAwake = (value: boolean) =>
    setPowerLocalEdits((prev) => ({ ...prev, keepDeviceAwake: value }));
  const setHistoryRetentionDays = (value: number) =>
    setScraperLocalEdits((prev) => ({
      ...prev,
      historyRetentionDays: clampScraperHistoryRetentionDays(value),
    }));
  const setStaleJobArchiveDays = (value: number) =>
    setScraperLocalEdits((prev) => ({
      ...prev,
      staleJobArchiveDays: clampScraperStaleJobArchiveDays(value),
    }));
  const setFilterCountry = (value: string) =>
    setScraperLocalEdits((prev) => ({ ...prev, filterCountry: value }));
  const setFilterCity = (value: string) =>
    setScraperLocalEdits((prev) => ({ ...prev, filterCity: value }));
  const setFilterTitleKeywords = (value: string[]) =>
    setScraperLocalEdits((prev) => ({ ...prev, filterTitleKeywords: value }));

  // AI Writing settings handler
  const handleAIWritingSettingsChange = (updates: Partial<AIWritingSettings>) => {
    setAIWritingLocalEdits((prev) => ({ ...prev, ...updates }));
  };

  const clearJobsMutation = useMutation({
    mutationFn: () => clearJobs(),
    onSuccess: () => {
      void cacheOwnership.clearJobs(queryClient);
      toast.success("Jobs deleted successfully");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to delete jobs")),
  });

  const clearMatchDataMutation = useMutation({
    mutationFn: clearJobMatchData,
    onSuccess: () => {
      void cacheOwnership.clearMatchData(queryClient);
      toast.success("Match data cleared successfully");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to clear match data")),
  });

  const clearAIContentMutation = useMutation({
    mutationFn: clearAllAIContent,
    onSuccess: (data) => {
      void cacheOwnership.clearAIContent(queryClient);
      toast.success(data.message || "AI generated content deleted successfully");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to delete AI generated content")),
  });

  const schedulerEnabledMutation = useMutation<Settings, Error, boolean, { previousEnabled: boolean }>({
    mutationFn: (enabled: boolean) =>
      patchSettings({ scheduler_enabled: enabled }),
    onMutate: (enabled: boolean) => {
      const previousEnabled = schedulerEnabled;
      setScraperLocalEdits((prev) => ({ ...prev, schedulerEnabled: enabled }));
      return { previousEnabled };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings.detail(), data);
      setScraperLocalEdits((prev) => ({ ...prev, schedulerEnabled: undefined }));
    },
    onError: (error, _enabled, context) => {
      setScraperLocalEdits((prev) => ({
        ...prev,
        schedulerEnabled: context?.previousEnabled,
      }));
      toast.error(getApiErrorMessage(error, "Failed to update auto-scrape setting"));
    },
    onSettled: () => {
      void cacheOwnership.schedulerSettingsMutation(queryClient);
    },
  });

  const handleSchedulerEnabledChange = (enabled: boolean) => {
    if (schedulerEnabledMutation.isPending) return;
    schedulerEnabledMutation.mutate(enabled);
  };

  const modelSelectionValid = (feature: keyof typeof AI_MODEL_FEATURES) => {
    const resolved = featureModels[feature];
    const model = providerModelsById[resolved.providerId]?.models.find(
      ({ modelId }) => modelId === resolved.modelId,
    );
    return (
      Boolean(model) &&
      !hasInvalidReasoningSelection(model, resolved.reasoningEffort)
    );
  };
  const fallbackSettingsValid = () => {
    const fallback = { ...settings, ...matcherLocalEdits.fallbackSettings };
    for (const stage of ["job_analysis", "matcher"] as const) {
      if (fallback[`${stage}_fallback_enabled`] !== "true") continue;
      const provider = fallback[`${stage}_fallback_provider_id`] ?? "";
      const modelId = fallback[`${stage}_fallback_model`];
      const model = providerModelsById[provider]?.models.find(
        (entry) => entry.modelId === modelId,
      );
      const primary = featureModels[stage];
      if (
        !model ||
        hasInvalidReasoningSelection(
          model,
          fallback[`${stage}_fallback_reasoning_effort`] ?? "",
        ) ||
        (provider === primary.providerId && modelId === primary.modelId)
      )
        return false;
    }
    return true;
  };

  useSettingsAutosave({
    edits: resumeParserLocalEdits,
    setEdits: setResumeParserLocalEdits,
    enabled:
      Object.values(resumeParserLocalEdits).some(
        (value) => value !== undefined,
      ) &&
      Boolean(resumeParserProviderId && resumeParserModel) &&
      !resumeParserModelsState.loading &&
      resumeParserModelsState.models.some(
        ({ modelId }) => modelId === resumeParserModel,
      ),
    delay: 300,
    errorMessage: "Failed to save resume parser settings",
    cache: "invalidate",
    updates: {
      resume_parser_model: resumeParserModel,
      resume_parser_provider_id: resumeParserProviderId,
      resume_parser_reasoning_effort: resumeParserReasoningEffort,
    },
  });
  useSettingsAutosave({
    edits: matcherLocalEdits,
    setEdits: setMatcherLocalEdits,
    enabled:
      matcherHasUnsavedChanges &&
      providerOptions.length > 0 &&
      modelSelectionValid("job_analysis") &&
      modelSelectionValid("matcher") &&
      fallbackSettingsValid(),
    delay: 400,
    errorMessage: "Failed to save matcher settings",
    updates: {
      job_analysis_model: jobAnalysisModel,
      job_analysis_provider_id: jobAnalysisProviderId,
      job_analysis_reasoning_effort: jobAnalysisReasoningEffort,
      matcher_model: matcherModel,
      matcher_provider_id: matcherProviderId,
      matcher_reasoning_effort: matcherReasoningEffort,
      matcher_batch_size: batchSize,
      matcher_max_retries: maxRetries,
      matcher_concurrency_limit: concurrencyLimit,
      matcher_timeout_ms: timeoutMs,
      matcher_auto_match_after_scrape: autoMatchAfterScrape,
      ...matcherLocalEdits.fallbackSettings,
    },
  });
  useSettingsAutosave({
    edits: powerLocalEdits,
    setEdits: setPowerLocalEdits,
    enabled: powerLocalEdits.keepDeviceAwake !== undefined,
    delay: 400,
    errorMessage: "Failed to save power settings",
    updates: { scraper_keep_device_awake: keepDeviceAwake },
  });
  useSettingsAutosave({
    edits: scraperLocalEdits,
    setEdits: setScraperLocalEdits,
    enabled: scraperHasUnsavedChanges,
    delay: 500,
    errorMessage: "Failed to save scraper settings",
    cache: "scheduler",
    updates: {
      scheduler_cron: schedulerCron,
      scraper_max_parallel_scrapes: maxParallelScrapes,
      scraper_history_retention_days: historyRetentionDays,
      scraper_stale_job_archive_days: staleJobArchiveDays,
      scraper_filter_country: filterCountry,
      scraper_filter_city: filterCity,
      scraper_filter_title_keywords: filterTitleKeywords,
    },
  });
  useSettingsAutosave({
    edits: aiWritingLocalEdits,
    setEdits: setAIWritingLocalEdits,
    enabled:
      aiWritingHasUnsavedChanges &&
      providerOptions.length > 0 &&
      modelSelectionValid("ai_writing"),
    delay: 400,
    errorMessage: "Failed to save AI writing settings",
    updates: {
      referral_tone: referralTone,
      referral_length: referralLength,
      follow_up_tone: followUpTone,
      follow_up_length: followUpLength,
      cover_letter_tone: coverLetterTone,
      cover_letter_length: coverLetterLength,
      cover_letter_focus: coverLetterFocus,
      ai_writing_model: aiWritingModel,
      ai_writing_provider_id: aiWritingProviderId,
      ai_writing_reasoning_effort: aiWritingReasoningEffort,
    },
  });

  const {
    data: unmatchedData,
    isFetching: unmatchedCountLoading,
    refetch: refetchUnmatchedCount,
  } = useQuery({
    queryKey: queryKeys.runtime.unmatchedJobsCount(debouncedUnmatchedWindowDays),
    queryFn: () => getUnmatchedJobsCount(debouncedUnmatchedWindowDays),
  });

  const matchUnmatchedMutation = useMutation({
    mutationFn: queueUnmatchedJobs,
    onSuccess: (data) => {
      toast.success(`${data.total} ${data.total === 1 ? "job" : "jobs"} queued for matching`, {
        action: {
          label: "Details",
          onClick: () => router.push("/history/ai/matching"),
        },
      });
      if (data.sessionId) {
        setMatchSessionId(data.sessionId);
      }
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to queue unmatched jobs")),
  });

  const [matchSessionId, setMatchSessionId] = useState<string | null>(null);

  const { data: matchProgress } = useMatchSession(matchSessionId, {
    onSettled: () => {
      setMatchSessionId(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.runtime.unmatchedJobs() });
    },
  });

  if (isInitialLoading) {
    return <SettingsHeader />;
  }

  if (settingsQuery.isError || providersQuery.isError) {
    return (
      <div className="space-y-6">
        <SettingsHeader />
        <ApiErrorState
          error={settingsQuery.error ?? providersQuery.error}
          fallbackMessage="Settings could not be initialized."
          onRetry={() => {
            void settingsQuery.refetch();
            void providersQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsHeader />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Configuration (Spans 2 columns) */}
        <div className="space-y-6 lg:col-span-2">

          <AIProvidersManager
            providers={providers}
            onAddProvider={async (input) => {
              await addProviderMutation.mutateAsync(input);
            }}
            onDeleteProvider={async (id) => {
              await deleteProviderMutation.mutateAsync(id);
            }}
            onUpdateProvider={async (id, input) => {
              if (Object.keys(input).length === 1 && "apiKey" in input) {
                await updateProviderApiKeyMutation.mutateAsync({
                  id,
                  apiKey: input.apiKey,
                });
                return;
              }
              await updateProviderMutation.mutateAsync({ id, input });
            }}
            onRefreshProviderModels={refreshProviderModels}
            codexExecutablePath={settings?.codex_cli_executable ?? ""}
            openCodeExecutablePath={settings?.opencode_cli_executable ?? ""}
            onSaveExecutablePaths={saveCLIExecutablePaths}
          />

          <MatcherSection
            fallbackSettings={settings && (
              <MatcherFallbackSettings
                settings={{ ...settings, ...matcherLocalEdits.fallbackSettings }}
                availableProviders={providerOptions}
                modelsByProvider={providerModelsById}
                primaryModels={{
                  job_analysis: { providerId: jobAnalysisProviderId, modelId: jobAnalysisModel },
                  matcher: { providerId: matcherProviderId, modelId: matcherModel },
                }}
                onChange={(updates) => setMatcherLocalEdits((previous) => ({
                  ...previous,
                  fallbackSettings: { ...previous.fallbackSettings, ...updates },
                }))}
              />
            )}
            availableProviders={providerOptions}
            hasProviders={providerOptions.length > 0}
            jobAnalysisModels={jobAnalysisModelsState.models}
            jobAnalysisModelsLoading={jobAnalysisModelsState.loading}
            jobAnalysisModelsError={jobAnalysisModelsState.error}
            jobAnalysisModelsStale={jobAnalysisModelsState.isStale}
            jobAnalysisProviderId={jobAnalysisProviderId}
            onJobAnalysisProviderIdChange={(id) => {
              setMatcherLocalEdits((previous) => ({
                ...previous,
                jobAnalysisProviderId: id,
                jobAnalysisModel: undefined,
                jobAnalysisReasoningEffort: undefined,
              }));
            }}
            jobAnalysisModel={jobAnalysisModel}
            onJobAnalysisModelChange={setJobAnalysisModel}
            jobAnalysisReasoningEffort={jobAnalysisReasoningEffort}
            onJobAnalysisReasoningEffortChange={setJobAnalysisReasoningEffort}
            models={matcherModelsState.models}
            modelsLoading={matcherModelsState.loading}
            modelsError={matcherModelsState.error}
            modelsStale={matcherModelsState.isStale}
            matcherProviderId={matcherProviderId}
            onMatcherProviderIdChange={(id) => {
              setMatcherLocalEdits((prev) => ({ 
                ...prev, 
                matcherProviderId: id,
                matcherModel: undefined,
                matcherReasoningEffort: undefined,
              }));
            }}
            matcherModel={matcherModel}
            onMatcherModelChange={setMatcherModel}
            matcherReasoningEffort={matcherReasoningEffort}
            onMatcherReasoningEffortChange={setMatcherReasoningEffort}
            autoMatchAfterScrape={autoMatchAfterScrape}
            onAutoMatchAfterScrapeChange={setAutoMatchAfterScrape}
            batchSize={batchSize}
            onBatchSizeChange={setBatchSize}
            maxRetries={maxRetries}
            onMaxRetriesChange={setMaxRetries}
            concurrencyLimit={concurrencyLimit}
            onConcurrencyLimitChange={setConcurrencyLimit}
            timeoutMs={timeoutMs}
            onTimeoutMsChange={setTimeoutMs}
            onMatchUnmatched={(days) => matchUnmatchedMutation.mutate(days)}
            isMatching={matchUnmatchedMutation.isPending || matchSessionId !== null}
            matchProgress={matchProgress ?? undefined}
            unmatchedWindowDays={unmatchedWindowDays}
            onUnmatchedWindowDaysChange={setUnmatchedWindowDays}
            onUnmatchedWindowOpen={() => {
              void refetchUnmatchedCount();
            }}
            unmatchedCount={unmatchedData?.count ?? 0}
            unmatchedCountLoading={
              unmatchedCountLoading || debouncedUnmatchedWindowDays !== unmatchedWindowDays
            }
          />

          <AIWritingSection
            availableProviders={providerOptions}
            hasProviders={providerOptions.length > 0}
            models={aiWritingModelsState.models}
            modelsLoading={aiWritingModelsState.loading}
            modelsError={aiWritingModelsState.error}
            modelsStale={aiWritingModelsState.isStale}
            aiWritingProviderId={aiWritingProviderId}
            onAIWritingProviderIdChange={(id) => {
              setAIWritingLocalEdits((prev) => ({ 
                ...prev, 
                aiWritingProviderId: id,
                aiWritingModel: undefined,
                aiWritingReasoningEffort: undefined,
              }));
            }}
            aiWritingSettings={{
              referralTone,
              referralLength,
              followUpTone,
              followUpLength,
              coverLetterTone,
              coverLetterLength,
              coverLetterFocus,
              aiWritingModel,
              aiWritingProviderId,
              aiWritingReasoningEffort,
            }}
            onAIWritingSettingsChange={handleAIWritingSettingsChange}
          />

          <DangerZone
            onClearAIContent={() => {
              clearAIContentMutation.mutate();
            }}
            onClearMatchData={() => {
              clearMatchDataMutation.mutate();
            }}
            onClearJobs={() => {
              clearJobsMutation.mutate();
            }}
          />
        </div>

        {/* Right Column: Info */}
        <div className="space-y-6">
          <ScraperSettings
            schedulerEnabled={schedulerEnabled}
            onSchedulerEnabledChange={handleSchedulerEnabledChange}
            schedulerCron={schedulerCron}
            onSchedulerCronChange={setSchedulerCron}
            maxParallelScrapes={maxParallelScrapes}
            onMaxParallelScrapesChange={setMaxParallelScrapes}
            historyRetentionDays={historyRetentionDays}
            onHistoryRetentionDaysChange={setHistoryRetentionDays}
            staleJobArchiveDays={staleJobArchiveDays}
            onStaleJobArchiveDaysChange={setStaleJobArchiveDays}
            filterCountry={filterCountry}
            filterCity={filterCity}
            onFilterCountryChange={setFilterCountry}
            onFilterCityChange={setFilterCity}
            filterTitleKeywords={filterTitleKeywords}
            onFilterTitleKeywordsChange={setFilterTitleKeywords}
          />

          <PowerSettings
            keepDeviceAwake={keepDeviceAwake}
            onKeepDeviceAwakeChange={setKeepDeviceAwake}
          />

          <ResumeParserSection
            availableProviders={providerOptions}
            hasProviders={providerOptions.length > 0}
            models={resumeParserModelsState.models}
            modelsLoading={resumeParserModelsState.loading}
            modelsError={resumeParserModelsState.error}
            modelsStale={resumeParserModelsState.isStale}
            resumeParserProviderId={resumeParserProviderId}
            onResumeParserProviderIdChange={(id) => {
              setResumeParserLocalEdits((prev) => ({ 
                ...prev, 
                resumeParserProviderId: id,
                resumeParserModel: undefined,
                resumeParserReasoningEffort: undefined,
              }));
            }}
            resumeParserModel={resumeParserModel}
            onResumeParserModelChange={setResumeParserModel}
            resumeParserReasoningEffort={resumeParserReasoningEffort}
            onResumeParserReasoningEffortChange={setResumeParserReasoningEffort}
          />

          <NotificationsSection
            enabled={settings?.notifications_enabled === "true"}
            threshold={Number(settings?.notifications_match_score_threshold ?? "75")}
          />

          <AppearanceSection />

          <SystemInfo
            version={APP_VERSION}
            dbPath={DB_PATH}
            readiness={readinessQuery.data}
            runtimeHealth={runtimeHealthQuery.data}
            isReadinessLoading={readinessQuery.isLoading}
            isReadinessUnavailable={readinessQuery.isError}
            isRuntimeHealthLoading={runtimeHealthQuery.isLoading}
            isRuntimeHealthUnavailable={runtimeHealthQuery.isError}
          />
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return <SettingsContent />;
}
