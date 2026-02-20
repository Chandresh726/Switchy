"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api/client";
import { MatcherSection } from "@/components/settings/matcher-section";
import { ScraperSettings } from "@/components/settings/scraper-settings";
import { DangerZone } from "@/components/settings/danger-zone";
import { ResumeParserSection } from "@/components/settings/resume-parser-section";
import { SystemInfo } from "@/components/settings/system-info";
import { AIWritingSection, type AIWritingSettings } from "@/components/settings/ai-writing-section";
import { AIProvidersManager } from "@/components/settings/ai-providers-manager";
import { Skeleton } from "@/components/ui/skeleton";
import { getProviderMetadata } from "@/lib/ai/providers/metadata";
import type { AIProvider } from "@/lib/ai/providers/types";
import { APP_VERSION, DB_PATH } from "@/lib/constants";
import type { ProviderModelsResponse } from "@/lib/types";
import type {
  ProviderModelsState,
  ProviderSettingsListItem,
  ReasoningEffort,
  SettingsRecord,
} from "@/lib/settings/types";

const getDefaultReasoningEffort = (): ReasoningEffort => "medium";
const PROVIDER_MODELS_STALE_TIME_MS = 15 * 60 * 1000;

interface MatcherLocalEdits {
  matcherModel?: string;
  matcherProviderId?: string;
  matcherReasoningEffort?: ReasoningEffort;
  bulkEnabled?: boolean;
  serializeOperations?: boolean;
  batchSize?: number;
  maxRetries?: number;
  concurrencyLimit?: number;
  timeoutMs?: number;
  circuitBreakerThreshold?: number;
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
  filterCountry?: string;
  filterCity?: string;
  filterTitleKeywords?: string[];
}

interface AIWritingLocalEdits {
  referralTone?: string;
  referralLength?: string;
  coverLetterTone?: string;
  coverLetterLength?: string;
  coverLetterFocus?: string[];
  aiWritingModel?: string;
  aiWritingProviderId?: string;
  aiWritingReasoningEffort?: ReasoningEffort;
}

function SettingsPageSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-1 h-4 w-72" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-border bg-card/70 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-5 w-28" />
            </div>
            <Skeleton className="h-4 w-64 mb-4" />
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card/70 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-5 w-36" />
            </div>
            <Skeleton className="h-4 w-80 mb-6" />
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <div className="flex gap-2">
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-10 flex-1" />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card/70 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-5 w-24" />
            </div>
            <Skeleton className="h-4 w-72 mb-6" />
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card/70 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-5 w-28" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card/70 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-5 w-28" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card/70 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-5 w-28" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card/70 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-5 w-20" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsContent() {
  const queryClient = useQueryClient();
  const router = useRouter();

  const [matcherLocalEdits, setMatcherLocalEdits] = useState<MatcherLocalEdits>({});
  const [resumeParserLocalEdits, setResumeParserLocalEdits] = useState<ResumeParserLocalEdits>({});
  const [scraperLocalEdits, setScraperLocalEdits] = useState<ScraperLocalEdits>({});
  const [aiWritingLocalEdits, setAIWritingLocalEdits] = useState<AIWritingLocalEdits>({});
  const [matcherSettingsSaved, setMatcherSettingsSaved] = useState(false);
  const [scraperSettingsSaved, setScraperSettingsSaved] = useState(false);
  const [aiWritingSettingsSaved, setAIWritingSettingsSaved] = useState(false);
  const lastModelReconciliationRef = useRef<string | null>(null);

  const { data: settings, isLoading: isSettingsLoading } = useQuery<SettingsRecord>({
    queryKey: ["settings"],
    queryFn: () => apiGet<SettingsRecord>("/api/settings", "Failed to fetch settings"),
  });

  const fetchProviderModels = async (
    providerId: string,
    forceRefresh = false
  ): Promise<ProviderModelsResponse> => {
    const refreshQuery = forceRefresh ? "?refresh=1" : "";
    return apiGet<ProviderModelsResponse>(
      `/api/providers/${providerId}/models${refreshQuery}`,
      "Failed to fetch provider models"
    );
  };

  const { data: providers = [], isLoading: isProvidersLoading } = useQuery<ProviderSettingsListItem[]>({
    queryKey: ["providers"],
    queryFn: () => apiGet<ProviderSettingsListItem[]>("/api/providers", "Failed to fetch providers"),
  });

  const providerModelsQueries = useQueries({
    queries: providers.map((provider) => ({
      queryKey: ["provider-models", provider.id],
      queryFn: async () => fetchProviderModels(provider.id),
      enabled: Boolean(provider.id),
      staleTime: PROVIDER_MODELS_STALE_TIME_MS,
      retry: 1,
    })),
  });

  const providerModelsById = useMemo<Record<string, ProviderModelsState>>(() => {
    const state: Record<string, ProviderModelsState> = {};

    providers.forEach((provider, index) => {
      const query = providerModelsQueries[index];
      const data = query?.data;
      const queryError = query?.error instanceof Error ? query.error.message : undefined;
      const warning = data?.warning;

      state[provider.id] = {
        models: data?.models ?? [],
        loading: query?.isPending ?? false,
        isRefreshing: (query?.isFetching ?? false) && !(query?.isPending ?? false),
        isStale: data?.isStale ?? false,
        error: queryError ?? warning,
      };
    });

    return state;
  }, [providerModelsQueries, providers]);

  const refreshProviderModels = async (providerId: string): Promise<void> => {
    try {
      const models = await fetchProviderModels(providerId, true);
      queryClient.setQueryData(["provider-models", providerId], models);
      toast.success("Model list refreshed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh model list");
    }
  };

  const isInitialLoading = isSettingsLoading || isProvidersLoading;

  const addProviderMutation = useMutation({
    mutationFn: async ({ provider, apiKey }: { provider: string; apiKey?: string }) => {
      return apiPost<{
        autoConfiguredDefaults?: boolean;
        autoConfiguredModelId?: string;
        autoConfiguredWarning?: string;
      }>("/api/providers", { provider, apiKey }, "Failed to add provider");
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["provider-models"] });
      queryClient.invalidateQueries({ queryKey: ["settings"] });

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
    onError: () => toast.error("Failed to add provider"),
  });

  const deleteProviderMutation = useMutation({
    mutationFn: (id: string) => apiDelete<{ success: boolean }>(`/api/providers/${id}`, "Failed to delete provider"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["provider-models"] });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Provider deleted successfully");
    },
    onError: () => toast.error("Failed to delete provider"),
  });

  const updateProviderApiKeyMutation = useMutation({
    mutationFn: ({ id, apiKey }: { id: string; apiKey?: string }) =>
      apiPatch<{ success: boolean }>(
        `/api/providers/${id}`,
        { apiKey },
        "Failed to update provider API key"
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["provider-models"] });
      toast.success("Provider API key updated");
    },
    onError: () => toast.error("Failed to update provider API key"),
  });

  const derivedValues = useMemo(() => {
    const hasProviders = providers.length > 0;
    const firstProviderId = providers[0]?.id || "";
    const getModelsState = (providerId: string): ProviderModelsState | undefined => providerModelsById[providerId];

    const getDefaultForProvider = (providerId: string) =>
      getModelsState(providerId)?.models[0]?.modelId ?? "";

    const isValidModelForProvider = (modelId: string, providerId: string) =>
      getModelsState(providerId)?.models.some((model) => model.modelId === modelId) ?? false;

    const resolveProviderId = (
      localProviderId: string | undefined,
      savedProviderId: string | undefined
    ) => {
      if (!hasProviders) return "";

      const candidateId = localProviderId || savedProviderId || firstProviderId;
      return providers.some((provider) => provider.id === candidateId) ? candidateId : firstProviderId;
    };

    const resolvedMatcherProviderId = resolveProviderId(
      matcherLocalEdits.matcherProviderId,
      settings?.matcher_provider_id
    );
    const resolvedResumeParserProviderId = resolveProviderId(
      resumeParserLocalEdits.resumeParserProviderId,
      settings?.resume_parser_provider_id
    );
    const resolvedAIWritingProviderId = resolveProviderId(
      aiWritingLocalEdits.aiWritingProviderId,
      settings?.ai_writing_provider_id
    );

    const getValidModelOrDefault = (
      localEdit: string | undefined, 
      savedModel: string | undefined, 
      providerId: string,
      savedProviderId: string | undefined
    ) => {
      if (localEdit) return localEdit;

      if (savedModel) {
        const providerChangedFromSaved = Boolean(savedProviderId) && savedProviderId !== providerId;
        const modelsState = getModelsState(providerId);
        const shouldKeepSavedModel = !providerChangedFromSaved && (!modelsState || modelsState.loading || (modelsState.error && modelsState.models.length === 0));
        if (shouldKeepSavedModel || isValidModelForProvider(savedModel, providerId)) {
          return savedModel;
        }
      }

      return hasProviders ? getDefaultForProvider(providerId) : "";
    };

    return {
      matcherModel: getValidModelOrDefault(
        matcherLocalEdits.matcherModel,
        settings?.matcher_model,
        resolvedMatcherProviderId,
        settings?.matcher_provider_id
      ),
      matcherProviderId: resolvedMatcherProviderId,
      resumeParserModel: getValidModelOrDefault(
        resumeParserLocalEdits.resumeParserModel,
        settings?.resume_parser_model,
        resolvedResumeParserProviderId,
        settings?.resume_parser_provider_id
      ),
      resumeParserProviderId: resolvedResumeParserProviderId,
      matcherReasoningEffort: matcherLocalEdits.matcherReasoningEffort ?? ((settings?.matcher_reasoning_effort as ReasoningEffort) || getDefaultReasoningEffort()),
      resumeParserReasoningEffort: resumeParserLocalEdits.resumeParserReasoningEffort ?? ((settings?.resume_parser_reasoning_effort as ReasoningEffort) || getDefaultReasoningEffort()),
      bulkEnabled: matcherLocalEdits.bulkEnabled ?? (settings?.matcher_bulk_enabled !== "false"),
      serializeOperations: matcherLocalEdits.serializeOperations ?? (settings?.matcher_serialize_operations === "true"),
      batchSize: matcherLocalEdits.batchSize ?? parseInt(settings?.matcher_batch_size || "2", 10),
      maxRetries: matcherLocalEdits.maxRetries ?? parseInt(settings?.matcher_max_retries || "3", 10),
      concurrencyLimit: matcherLocalEdits.concurrencyLimit ?? parseInt(settings?.matcher_concurrency_limit || "3", 10),
      timeoutMs:
        matcherLocalEdits.timeoutMs ??
        parseInt(settings?.matcher_timeout_ms || "30000", 10),
      circuitBreakerThreshold:
        matcherLocalEdits.circuitBreakerThreshold ??
        parseInt(settings?.matcher_circuit_breaker_threshold || "10", 10),
      autoMatchAfterScrape:
        matcherLocalEdits.autoMatchAfterScrape ??
        (settings?.matcher_auto_match_after_scrape !== "false"),
      schedulerEnabled:
        scraperLocalEdits.schedulerEnabled ??
        (settings?.scheduler_enabled !== "false"),
      schedulerCron:
        scraperLocalEdits.schedulerCron ??
        (settings?.scheduler_cron || "0 */6 * * *"),
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
      // AI Writing
      aiWritingModel: getValidModelOrDefault(
        aiWritingLocalEdits.aiWritingModel,
        settings?.ai_writing_model,
        resolvedAIWritingProviderId,
        settings?.ai_writing_provider_id
      ),
      aiWritingProviderId: resolvedAIWritingProviderId,
      aiWritingReasoningEffort: aiWritingLocalEdits.aiWritingReasoningEffort ?? ((settings?.ai_writing_reasoning_effort as ReasoningEffort) || getDefaultReasoningEffort()),
      referralTone: aiWritingLocalEdits.referralTone ?? (settings?.referral_tone || "professional"),
      referralLength: aiWritingLocalEdits.referralLength ?? (settings?.referral_length || "medium"),
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
  }, [settings, matcherLocalEdits, resumeParserLocalEdits, scraperLocalEdits, aiWritingLocalEdits, providers, providerModelsById]);

  const {
    matcherModel, matcherProviderId, resumeParserModel, resumeParserProviderId, matcherReasoningEffort, resumeParserReasoningEffort, bulkEnabled, serializeOperations, batchSize, maxRetries, concurrencyLimit, timeoutMs,
    circuitBreakerThreshold, autoMatchAfterScrape, schedulerEnabled, schedulerCron, filterCountry, filterCity, filterTitleKeywords,
    aiWritingModel, aiWritingProviderId, aiWritingReasoningEffort, referralTone, referralLength,
    coverLetterTone, coverLetterLength, coverLetterFocus
  } = derivedValues;

  const providerOptions = useMemo(() => {
    return providers.map((provider) => {
      const meta = getProviderMetadata(provider.provider as AIProvider);
      return {
        id: provider.id,
        provider: provider.provider,
        name: meta?.displayName || provider.provider,
        isActive: provider.isActive,
      };
    });
  }, [providers]);

  const getProviderModelsState = (providerId: string): ProviderModelsState => {
    return providerModelsById[providerId] ?? {
      models: [],
      loading: false,
      isRefreshing: false,
      isStale: false,
    };
  };

  const matcherModelsState = getProviderModelsState(matcherProviderId);
  const resumeParserModelsState = getProviderModelsState(resumeParserProviderId);
  const aiWritingModelsState = getProviderModelsState(aiWritingProviderId);

  const reconcileModelsMutation = useMutation({
    mutationFn: ({ updates }: { updates: Record<string, string>; features: string[] }) =>
      apiPost<Record<string, string>>(
        "/api/settings",
        updates,
        "Failed to reconcile invalid model settings"
      ),
    onSuccess: (_data, variables) => {
      const updatedFeatures = Array.from(new Set(variables.features));
      if (updatedFeatures.length > 0) {
        toast.warning(`Updated invalid AI model settings for ${updatedFeatures.join(", ")}.`);
      }
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error) => {
      lastModelReconciliationRef.current = null;
      toast.error(error instanceof Error ? error.message : "Failed to auto-fix invalid model settings");
    },
  });

  useEffect(() => {
    if (!settings || providers.length === 0 || reconcileModelsMutation.isPending) {
      return;
    }

    const updates: Record<string, string> = {};
    const features: string[] = [];

    const queueFeatureUpdate = ({
      featureLabel,
      providerSettingKey,
      modelSettingKey,
      savedProviderId,
      savedModelId,
      resolvedProviderId,
      resolvedModelId,
      localProviderEdited,
      localModelEdited,
    }: {
      featureLabel: string;
      providerSettingKey: string;
      modelSettingKey: string;
      savedProviderId?: string;
      savedModelId?: string;
      resolvedProviderId: string;
      resolvedModelId: string;
      localProviderEdited: boolean;
      localModelEdited: boolean;
    }) => {
      if (localProviderEdited || localModelEdited) {
        return;
      }

      if (!resolvedProviderId || !resolvedModelId) {
        return;
      }

      if ((savedProviderId || "") !== resolvedProviderId) {
        updates[providerSettingKey] = resolvedProviderId;
      }

      if ((savedModelId || "") !== resolvedModelId) {
        updates[modelSettingKey] = resolvedModelId;
      }

      if (updates[providerSettingKey] || updates[modelSettingKey]) {
        features.push(featureLabel);
      }
    };

    if (!matcherModelsState.loading && matcherModelsState.models.length > 0) {
      queueFeatureUpdate({
        featureLabel: "Matcher",
        providerSettingKey: "matcher_provider_id",
        modelSettingKey: "matcher_model",
        savedProviderId: settings.matcher_provider_id,
        savedModelId: settings.matcher_model,
        resolvedProviderId: matcherProviderId,
        resolvedModelId: matcherModel,
        localProviderEdited: matcherLocalEdits.matcherProviderId !== undefined,
        localModelEdited: matcherLocalEdits.matcherModel !== undefined,
      });
    }

    if (!resumeParserModelsState.loading && resumeParserModelsState.models.length > 0) {
      queueFeatureUpdate({
        featureLabel: "Resume Parser",
        providerSettingKey: "resume_parser_provider_id",
        modelSettingKey: "resume_parser_model",
        savedProviderId: settings.resume_parser_provider_id,
        savedModelId: settings.resume_parser_model,
        resolvedProviderId: resumeParserProviderId,
        resolvedModelId: resumeParserModel,
        localProviderEdited: resumeParserLocalEdits.resumeParserProviderId !== undefined,
        localModelEdited: resumeParserLocalEdits.resumeParserModel !== undefined,
      });
    }

    if (!aiWritingModelsState.loading && aiWritingModelsState.models.length > 0) {
      queueFeatureUpdate({
        featureLabel: "AI Writing",
        providerSettingKey: "ai_writing_provider_id",
        modelSettingKey: "ai_writing_model",
        savedProviderId: settings.ai_writing_provider_id,
        savedModelId: settings.ai_writing_model,
        resolvedProviderId: aiWritingProviderId,
        resolvedModelId: aiWritingModel,
        localProviderEdited: aiWritingLocalEdits.aiWritingProviderId !== undefined,
        localModelEdited: aiWritingLocalEdits.aiWritingModel !== undefined,
      });
    }

    if (Object.keys(updates).length === 0) {
      lastModelReconciliationRef.current = null;
      return;
    }

    const signature = JSON.stringify(updates);
    if (lastModelReconciliationRef.current === signature) {
      return;
    }

    lastModelReconciliationRef.current = signature;
    reconcileModelsMutation.mutate({ updates, features });
  }, [
    settings,
    providers,
    matcherModelsState.loading,
    matcherModelsState.models.length,
    matcherProviderId,
    matcherModel,
    matcherLocalEdits.matcherProviderId,
    matcherLocalEdits.matcherModel,
    resumeParserModelsState.loading,
    resumeParserModelsState.models.length,
    resumeParserProviderId,
    resumeParserModel,
    resumeParserLocalEdits.resumeParserProviderId,
    resumeParserLocalEdits.resumeParserModel,
    aiWritingModelsState.loading,
    aiWritingModelsState.models.length,
    aiWritingProviderId,
    aiWritingModel,
    aiWritingLocalEdits.aiWritingProviderId,
    aiWritingLocalEdits.aiWritingModel,
    reconcileModelsMutation,
  ]);

  const scraperHasUnsavedChanges =
    scraperLocalEdits.schedulerCron !== undefined ||
    scraperLocalEdits.filterCountry !== undefined ||
    scraperLocalEdits.filterCity !== undefined ||
    scraperLocalEdits.filterTitleKeywords !== undefined;
  const matcherHasUnsavedChanges =
    matcherLocalEdits.matcherModel !== undefined ||
    matcherLocalEdits.matcherProviderId !== undefined ||
    matcherLocalEdits.matcherReasoningEffort !== undefined ||
    matcherLocalEdits.bulkEnabled !== undefined ||
    matcherLocalEdits.serializeOperations !== undefined ||
    matcherLocalEdits.batchSize !== undefined ||
    matcherLocalEdits.maxRetries !== undefined ||
    matcherLocalEdits.concurrencyLimit !== undefined ||
    matcherLocalEdits.timeoutMs !== undefined ||
    matcherLocalEdits.circuitBreakerThreshold !== undefined ||
    matcherLocalEdits.autoMatchAfterScrape !== undefined;

  const aiWritingHasUnsavedChanges =
    aiWritingLocalEdits.referralTone !== undefined ||
    aiWritingLocalEdits.referralLength !== undefined ||
    aiWritingLocalEdits.coverLetterTone !== undefined ||
    aiWritingLocalEdits.coverLetterLength !== undefined ||
    aiWritingLocalEdits.coverLetterFocus !== undefined ||
    aiWritingLocalEdits.aiWritingModel !== undefined ||
    aiWritingLocalEdits.aiWritingProviderId !== undefined ||
    aiWritingLocalEdits.aiWritingReasoningEffort !== undefined;

  // Setters for Matcher settings
  const setMatcherModel = (value: string) => setMatcherLocalEdits(prev => ({ ...prev, matcherModel: value }));
  const setMatcherReasoningEffort = (value: ReasoningEffort) => setMatcherLocalEdits(prev => ({ ...prev, matcherReasoningEffort: value }));
  const setAutoMatchAfterScrape = (value: boolean) =>
    setMatcherLocalEdits((prev) => ({ ...prev, autoMatchAfterScrape: value }));
  const setBulkEnabled = (value: boolean) => setMatcherLocalEdits(prev => ({ ...prev, bulkEnabled: value }));
  const setBatchSize = (value: number) => setMatcherLocalEdits(prev => ({ ...prev, batchSize: value }));
  const setMaxRetries = (value: number) => setMatcherLocalEdits(prev => ({ ...prev, maxRetries: value }));
  const setConcurrencyLimit = (value: number) => setMatcherLocalEdits(prev => ({ ...prev, concurrencyLimit: value }));
  const setTimeoutMs = (value: number) => setMatcherLocalEdits(prev => ({ ...prev, timeoutMs: value }));
  const setCircuitBreakerThreshold = (value: number) => setMatcherLocalEdits(prev => ({ ...prev, circuitBreakerThreshold: value }));

  // Auto-save setters for Resume Parser (independent from Matcher)
  const setResumeParserModel = (value: string) =>
    setResumeParserLocalEdits(prev => ({ ...prev, resumeParserModel: value }));
  const setResumeParserReasoningEffort = (value: ReasoningEffort) =>
    setResumeParserLocalEdits(prev => ({ ...prev, resumeParserReasoningEffort: value }));
  const setSchedulerCron = (value: string) =>
    setScraperLocalEdits((prev) => ({ ...prev, schedulerCron: value }));
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
    mutationFn: () => apiDelete<{ success: boolean }>("/api/jobs", "Failed to clear jobs"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const clearMatchDataMutation = useMutation<{ jobsCleared: number }>({
    mutationFn: () =>
      apiDelete<{ jobsCleared: number }>("/api/jobs/match-data", "Failed to clear match data"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["match-history"] });
      queryClient.invalidateQueries({ queryKey: ["unmatched-jobs-count"] });
    },
  });

  const clearAIContentMutation = useMutation<{
    success: boolean;
    contentDeleted: number;
    historyDeleted: number;
    message: string;
  }>({
    mutationFn: () =>
      apiDelete<{
        success: boolean;
        contentDeleted: number;
        historyDeleted: number;
        message: string;
      }>("/api/ai/content", "Failed to clear AI content"),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ai-content"] });
      toast.success(data.message || "AI generated content deleted successfully");
    },
    onError: () => toast.error("Failed to delete AI generated content"),
  });

  const resumeParserMutation = useMutation({
    mutationFn: (updates: { resume_parser_model?: string; resume_parser_provider_id?: string; resume_parser_reasoning_effort?: ReasoningEffort }) =>
      apiPost<Record<string, string>>(
        "/api/settings",
        updates,
        "Failed to save resume parser settings"
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setResumeParserLocalEdits({});
    },
    onError: () => toast.error("Failed to save resume parser settings"),
  });

  const schedulerEnabledMutation = useMutation<SettingsRecord, Error, boolean, { previousEnabled: boolean }>({
    mutationFn: (enabled: boolean) =>
      apiPost<SettingsRecord>(
        "/api/settings",
        { scheduler_enabled: enabled },
        "Failed to save scheduler enabled setting"
      ),
    onMutate: (enabled: boolean) => {
      const previousEnabled = schedulerEnabled;
      setScraperLocalEdits((prev) => ({ ...prev, schedulerEnabled: enabled }));
      return { previousEnabled };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["settings"], data);
      setScraperLocalEdits((prev) => ({ ...prev, schedulerEnabled: undefined }));
    },
    onError: (error, _enabled, context) => {
      setScraperLocalEdits((prev) => ({
        ...prev,
        schedulerEnabled: context?.previousEnabled,
      }));
      toast.error(error.message || "Failed to update auto-scrape setting");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["scheduler-status"] });
    },
  });

  const handleSchedulerEnabledChange = (enabled: boolean) => {
    if (schedulerEnabledMutation.isPending) return;
    schedulerEnabledMutation.mutate(enabled);
  };

  // Auto-save effect for Resume Parser with debounce
  useEffect(() => {
    if (
      resumeParserLocalEdits.resumeParserModel === undefined &&
      resumeParserLocalEdits.resumeParserProviderId === undefined &&
      resumeParserLocalEdits.resumeParserReasoningEffort === undefined
    ) {
      return;
    }

    const currentModelsState = providerModelsById[resumeParserProviderId];
    const modelIsReady =
      !!resumeParserProviderId &&
      !!resumeParserModel &&
      !!currentModelsState &&
      !currentModelsState.loading &&
      currentModelsState.models.some((model) => model.modelId === resumeParserModel);

    if (!modelIsReady) {
      return;
    }

    const timer = setTimeout(() => {
      resumeParserMutation.mutate({
        resume_parser_model: resumeParserModel,
        resume_parser_provider_id: resumeParserProviderId,
        resume_parser_reasoning_effort: resumeParserReasoningEffort,
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [
    resumeParserModel,
    resumeParserProviderId,
    resumeParserReasoningEffort,
    resumeParserLocalEdits,
    resumeParserMutation,
    providerModelsById,
  ]);

  const matcherSettingsMutation = useMutation({
    mutationFn: () =>
      apiPost<Record<string, string>>(
        "/api/settings",
        {
          matcher_model: matcherModel,
          matcher_provider_id: matcherProviderId,
          matcher_reasoning_effort: matcherReasoningEffort,
          matcher_bulk_enabled: bulkEnabled,
          matcher_serialize_operations: serializeOperations,
          matcher_batch_size: batchSize,
          matcher_max_retries: maxRetries,
          matcher_concurrency_limit: concurrencyLimit,
          matcher_timeout_ms: timeoutMs,
          matcher_circuit_breaker_threshold: circuitBreakerThreshold,
          matcher_auto_match_after_scrape: autoMatchAfterScrape,
        },
        "Failed to save matcher settings"
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setMatcherLocalEdits((prev) => ({
        ...prev,
        matcherModel: undefined,
        matcherProviderId: undefined,
        matcherReasoningEffort: undefined,
        bulkEnabled: undefined,
        serializeOperations: undefined,
        batchSize: undefined,
        maxRetries: undefined,
        concurrencyLimit: undefined,
        timeoutMs: undefined,
        circuitBreakerThreshold: undefined,
        autoMatchAfterScrape: undefined,
      }));
      setMatcherSettingsSaved(true);
      setTimeout(() => setMatcherSettingsSaved(false), 3000);
    },
    onError: () => toast.error("Failed to save matcher settings"),
  });

  const scraperSettingsMutation = useMutation<unknown, Error>({
    mutationFn: () =>
      apiPost<Record<string, string>>(
        "/api/settings",
        {
          scheduler_cron: schedulerCron,
          scraper_filter_country: filterCountry,
          scraper_filter_city: filterCity,
          scraper_filter_title_keywords: JSON.stringify(filterTitleKeywords),
        },
        "Failed to save scraper settings"
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["scheduler-status"] });
      setScraperLocalEdits((prev) => ({
        ...prev,
        schedulerCron: undefined,
        filterCountry: undefined,
        filterCity: undefined,
        filterTitleKeywords: undefined,
      }));
      setScraperSettingsSaved(true);
      setTimeout(() => setScraperSettingsSaved(false), 3000);
    },
    onError: (error) => toast.error(error.message || "Failed to save scraper settings"),
  });

  const aiWritingMutation = useMutation({
    mutationFn: (updates: Partial<AIWritingSettings>) =>
      apiPost<Record<string, string>>(
        "/api/settings",
        {
          referral_tone: updates.referralTone,
          referral_length: updates.referralLength,
          cover_letter_tone: updates.coverLetterTone,
          cover_letter_length: updates.coverLetterLength,
          cover_letter_focus: updates.coverLetterFocus,
          ai_writing_model: updates.aiWritingModel,
          ai_writing_provider_id: updates.aiWritingProviderId,
          ai_writing_reasoning_effort: updates.aiWritingReasoningEffort,
        },
        "Failed to save AI writing settings"
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setAIWritingLocalEdits({});
      setAIWritingSettingsSaved(true);
      setTimeout(() => setAIWritingSettingsSaved(false), 3000);
    },
    onError: () => toast.error("Failed to save AI writing settings"),
  });

  const saveAIWritingSettings = () => {
    aiWritingMutation.mutate({
      referralTone,
      referralLength,
      coverLetterTone,
      coverLetterLength,
      coverLetterFocus,
      aiWritingModel,
      aiWritingProviderId,
      aiWritingReasoningEffort,
    });
  };

  // Query for unmatched jobs count
  const { data: unmatchedData } = useQuery<{ count: number }>({
    queryKey: ["unmatched-jobs-count"],
    queryFn: () =>
      apiGet<{ count: number }>(
        "/api/jobs/match-unmatched",
        "Failed to fetch unmatched count"
      ),
  });

  const matchUnmatchedMutation = useMutation<{ total: number; matched: number; failed: number; sessionId: string }>({
    mutationFn: () =>
      apiPost<{ total: number; matched: number; failed: number; sessionId: string }>(
        "/api/jobs/match-unmatched",
        {},
        "Failed to match jobs"
      ),
    onSuccess: (data) => {
      if (data.sessionId) {
        setMatchSessionId(data.sessionId);
      }
    },
  });

  const [matchSessionId, setMatchSessionId] = useState<string | null>(null);

  const { data: matchProgress } = useQuery<{
    sessionId: string;
    status: string;
    total: number;
    completed: number;
    succeeded: number;
    failed: number;
  } | null>({
    queryKey: ["match-progress", matchSessionId],
    queryFn: async () => {
      if (!matchSessionId) return null;
      const res = await fetch(`/api/jobs/match-unmatched?sessionId=${matchSessionId}`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!matchSessionId,
    refetchInterval: (query) => {
      const progress = query.state.data;
      if (!!matchSessionId && progress?.status !== "completed" && progress?.status !== "failed") {
        return 1000;
      }
      return false;
    },
  });

  useEffect(() => {
    if (!matchUnmatchedMutation.isPending && matchSessionId && matchProgress?.status === "completed") {
      setMatchSessionId(null);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["unmatched-jobs-count"] });
      queryClient.invalidateQueries({ queryKey: ["match-history"] });
    }
  }, [matchUnmatchedMutation.isPending, matchSessionId, matchProgress, queryClient]);

  if (isInitialLoading) {
    return <SettingsPageSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="mt-1 text-muted-foreground">Configure your Switchy preferences and manage data</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Configuration (Spans 2 columns) */}
        <div className="space-y-6 lg:col-span-2">

          <AIProvidersManager
            providers={providers}
            onAddProvider={async (provider, apiKey) => {
              await addProviderMutation.mutateAsync({ provider, apiKey });
            }}
            onDeleteProvider={async (id) => {
              await deleteProviderMutation.mutateAsync(id);
            }}
            onUpdateProviderApiKey={async (id, apiKey) => {
              await updateProviderApiKeyMutation.mutateAsync({ id, apiKey });
            }}
            onRefreshProviderModels={refreshProviderModels}
          />

          <MatcherSection
            availableProviders={providerOptions}
            hasProviders={providers.length > 0}
            models={matcherModelsState.models}
            modelsLoading={matcherModelsState.loading}
            modelsError={matcherModelsState.error}
            modelsStale={matcherModelsState.isStale}
            matcherProviderId={matcherProviderId}
            onMatcherProviderIdChange={(id) => {
              setMatcherLocalEdits((prev) => ({ 
                ...prev, 
                matcherProviderId: id,
                matcherModel: undefined 
              }));
            }}
            matcherModel={matcherModel}
            onMatcherModelChange={setMatcherModel}
            matcherReasoningEffort={matcherReasoningEffort}
            onMatcherReasoningEffortChange={setMatcherReasoningEffort}
            autoMatchAfterScrape={autoMatchAfterScrape}
            onAutoMatchAfterScrapeChange={setAutoMatchAfterScrape}
            bulkEnabled={bulkEnabled}
            onBulkEnabledChange={setBulkEnabled}
            batchSize={batchSize}
            onBatchSizeChange={setBatchSize}
            serializeOperations={serializeOperations}
            onSerializeOperationsChange={(value) => setMatcherLocalEdits(prev => ({ ...prev, serializeOperations: value }))}
            maxRetries={maxRetries}
            onMaxRetriesChange={setMaxRetries}
            concurrencyLimit={concurrencyLimit}
            onConcurrencyLimitChange={setConcurrencyLimit}
            timeoutMs={timeoutMs}
            onTimeoutMsChange={setTimeoutMs}
            circuitBreakerThreshold={circuitBreakerThreshold}
            onCircuitBreakerThresholdChange={setCircuitBreakerThreshold}
            onSave={() => matcherSettingsMutation.mutate()}
            isSaving={matcherSettingsMutation.isPending}
            hasUnsavedChanges={matcherHasUnsavedChanges}
            settingsSaved={matcherSettingsSaved}
            onMatchUnmatched={() => {
              toast.success("Match triggered", {
                action: {
                  label: "Details",
                  onClick: () => router.push("/history/match")
                }
              });
              matchUnmatchedMutation.mutate();
            }}
            isMatching={matchUnmatchedMutation.isPending}
            matchProgress={matchProgress ? {
              completed: matchProgress.completed,
              total: matchProgress.total,
              succeeded: matchProgress.succeeded,
              failed: matchProgress.failed,
            } : undefined}
            unmatchedCount={unmatchedData?.count ?? 0}
          />

          <AIWritingSection
            availableProviders={providerOptions}
            hasProviders={providers.length > 0}
            models={aiWritingModelsState.models}
            modelsLoading={aiWritingModelsState.loading}
            modelsError={aiWritingModelsState.error}
            modelsStale={aiWritingModelsState.isStale}
            aiWritingProviderId={aiWritingProviderId}
            onAIWritingProviderIdChange={(id) => {
              setAIWritingLocalEdits((prev) => ({ 
                ...prev, 
                aiWritingProviderId: id,
                aiWritingModel: undefined 
              }));
            }}
            aiWritingSettings={{
              referralTone,
              referralLength,
              coverLetterTone,
              coverLetterLength,
              coverLetterFocus,
              aiWritingModel,
              aiWritingProviderId,
              aiWritingReasoningEffort,
            }}
            onAIWritingSettingsChange={handleAIWritingSettingsChange}
            onSave={saveAIWritingSettings}
            isSaving={aiWritingMutation.isPending}
            hasUnsavedChanges={aiWritingHasUnsavedChanges}
            settingsSaved={aiWritingSettingsSaved}
          />

          <DangerZone
            onClearAIContent={() => {
              clearAIContentMutation.mutate();
            }}
            onClearMatchData={() => {
              toast.success("Clear match data triggered");
              clearMatchDataMutation.mutate();
            }}
            onClearJobs={() => {
              toast.success("Clear jobs triggered");
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
            filterCountry={filterCountry}
            filterCity={filterCity}
            onFilterCountryChange={setFilterCountry}
            onFilterCityChange={setFilterCity}
            filterTitleKeywords={filterTitleKeywords}
            onFilterTitleKeywordsChange={setFilterTitleKeywords}
            onSave={() => scraperSettingsMutation.mutate()}
            isSaving={scraperSettingsMutation.isPending}
            hasUnsavedChanges={scraperHasUnsavedChanges}
            settingsSaved={scraperSettingsSaved}
          />

          <ResumeParserSection
            availableProviders={providerOptions}
            hasProviders={providers.length > 0}
            models={resumeParserModelsState.models}
            modelsLoading={resumeParserModelsState.loading}
            modelsError={resumeParserModelsState.error}
            modelsStale={resumeParserModelsState.isStale}
            resumeParserProviderId={resumeParserProviderId}
            onResumeParserProviderIdChange={(id) => {
              setResumeParserLocalEdits((prev) => ({ 
                ...prev, 
                resumeParserProviderId: id,
                resumeParserModel: undefined 
              }));
            }}
            resumeParserModel={resumeParserModel}
            onResumeParserModelChange={setResumeParserModel}
            resumeParserReasoningEffort={resumeParserReasoningEffort}
            onResumeParserReasoningEffortChange={setResumeParserReasoningEffort}
          />

          <SystemInfo version={APP_VERSION} dbPath={DB_PATH} />
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsPageSkeleton />}>
      <SettingsContent />
    </Suspense>
  );
}
