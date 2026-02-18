"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { MatcherSection } from "@/components/settings/matcher-section";
import { ScraperSettings } from "@/components/settings/scraper-settings";
import { DangerZone } from "@/components/settings/danger-zone";
import { ResumeParserSection } from "@/components/settings/resume-parser-section";
import { SystemInfo } from "@/components/settings/system-info";
import { AIWritingSection, type AIWritingSettings } from "@/components/settings/ai-writing-section";
import { AIProvidersManager } from "@/components/settings/ai-providers-manager";
import { Skeleton } from "@/components/ui/skeleton";
import { getProviderMetadata } from "@/lib/ai/providers/metadata";
import { getDefaultModelForProvider, getModelsForProvider } from "@/lib/ai/providers/models";
import type { AIProvider } from "@/lib/ai/providers/types";
import { APP_VERSION, DB_PATH } from "@/lib/constants";

type ReasoningEffort = "low" | "medium" | "high";

const getDefaultReasoningEffort = (): ReasoningEffort => "medium";

interface MatcherSettings {
  matcher_model: string;
  matcher_provider_id: string;
  resume_parser_model: string;
  resume_parser_provider_id: string;
  matcher_reasoning_effort: string;
  resume_parser_reasoning_effort: string;
  matcher_bulk_enabled: string;
  matcher_serialize_operations: string;
  matcher_batch_size: string;
  matcher_max_retries: string;
  matcher_concurrency_limit: string;
  matcher_timeout_ms: string;
  matcher_circuit_breaker_threshold: string;
  matcher_auto_match_after_scrape: string;
  scheduler_enabled: string;
  scheduler_cron: string;
  scraper_filter_country?: string;
  scraper_filter_city?: string;
  scraper_filter_title_keywords?: string;
  ai_provider?: string;
  anthropic_api_key?: string;
  google_auth_mode?: string;
  google_api_key?: string;
  openrouter_api_key?: string;
  cerebras_api_key?: string;
  openai_api_key?: string;
  modal_api_key?: string;
  // AI Writing
  referral_tone?: string;
  referral_length?: string;
  cover_letter_tone?: string;
  cover_letter_length?: string;
  cover_letter_focus?: string;
  ai_writing_model?: string;
  ai_writing_provider_id?: string;
  ai_writing_reasoning_effort?: string;
}

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
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-5 w-28" />
            </div>
            <Skeleton className="h-4 w-64 mb-4" />
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
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

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
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

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
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
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-5 w-28" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-5 w-28" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
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
  const searchParams = useSearchParams();
  const router = useRouter();

  const [matcherLocalEdits, setMatcherLocalEdits] = useState<MatcherLocalEdits>({});
  const [resumeParserLocalEdits, setResumeParserLocalEdits] = useState<ResumeParserLocalEdits>({});
  const [scraperLocalEdits, setScraperLocalEdits] = useState<ScraperLocalEdits>({});
  const [aiWritingLocalEdits, setAIWritingLocalEdits] = useState<AIWritingLocalEdits>({});
  const [matcherSettingsSaved, setMatcherSettingsSaved] = useState(false);
  const [scraperSettingsSaved, setScraperSettingsSaved] = useState(false);
  const [aiWritingSettingsSaved, setAIWritingSettingsSaved] = useState(false);

  // Handle OAuth callbacks
  useEffect(() => {
    const error = searchParams.get("error");
    const success = searchParams.get("success");

    if (error) {
      toast.error("Authentication Error", {
        description: error.replace(/_/g, " "),
      });
      // Clean up URL
      router.replace("/settings");
    }

    if (success === "google_connected") {
      toast.success("Google Account Connected", {
        description: "You can now use Gemini models via OAuth.",
      });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      router.replace("/settings");
    }
  }, [searchParams, router, queryClient]);

  const { data: settings, isLoading: isSettingsLoading } = useQuery<MatcherSettings>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  const getApiErrorMessage = async (res: Response, fallback: string): Promise<string> => {
    try {
      const data = await res.json() as { error?: string };
      if (typeof data.error === "string" && data.error.trim().length > 0) {
        return data.error;
      }
    } catch {
      // Ignore parse errors and fall back to default message
    }
    return fallback;
  };

  interface Provider {
    id: string;
    provider: string;
    isActive: boolean;
    hasApiKey: boolean;
    createdAt: Date;
    updatedAt: Date;
  }

  const { data: providers = [], isLoading: isProvidersLoading } = useQuery<Provider[]>({
    queryKey: ["providers"],
    queryFn: async () => {
      const res = await fetch("/api/providers");
      if (!res.ok) throw new Error("Failed to fetch providers");
      return res.json();
    },
  });

  const isInitialLoading = isSettingsLoading || isProvidersLoading;

  const addProviderMutation = useMutation({
    mutationFn: async ({ provider, apiKey }: { provider: string; apiKey?: string }) => {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
      if (!res.ok) throw new Error("Failed to add provider");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      toast.success("Provider added successfully");
    },
    onError: () => toast.error("Failed to add provider"),
  });

  const deleteProviderMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete provider");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      toast.success("Provider deleted successfully");
    },
    onError: () => toast.error("Failed to delete provider"),
  });

  const updateProviderApiKeyMutation = useMutation({
    mutationFn: async ({ id, apiKey }: { id: string; apiKey?: string }) => {
      const res = await fetch(`/api/providers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      if (!res.ok) throw new Error("Failed to update provider API key");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      toast.success("Provider API key updated");
    },
    onError: () => toast.error("Failed to update provider API key"),
  });

  const derivedValues = useMemo(() => {
    const hasProviders = providers.length > 0;
    const firstProviderId = providers[0]?.id || "";
    const firstProviderType = hasProviders ? providers[0]?.provider as AIProvider : "anthropic";

    const getProviderType = (providerId: string) => {
      if (!providerId) return firstProviderType;
      const provider = providers.find(p => p.id === providerId);
      return provider ? provider.provider as AIProvider : firstProviderType;
    };

    const getDefaultForProvider = (providerId: string) => {
      const providerType = getProviderType(providerId);
      return getDefaultModelForProvider(providerType);
    };

    const isValidModelForProvider = (modelId: string, providerId: string) => {
      const providerType = getProviderType(providerId);
      const models = getModelsForProvider(providerType);
      return models.some((m) => m.modelId === modelId);
    };

    const resolvedMatcherProviderId = hasProviders 
      ? (matcherLocalEdits.matcherProviderId || settings?.matcher_provider_id || firstProviderId) 
      : "";
    const resolvedResumeParserProviderId = hasProviders 
      ? (resumeParserLocalEdits.resumeParserProviderId || settings?.resume_parser_provider_id || firstProviderId) 
      : "";
    const resolvedAIWritingProviderId = hasProviders 
      ? (aiWritingLocalEdits.aiWritingProviderId || settings?.ai_writing_provider_id || firstProviderId) 
      : "";

    const getValidModelOrDefault = (
      localEdit: string | undefined, 
      savedModel: string | undefined, 
      providerId: string
    ) => {
      if (localEdit) return localEdit;
      if (savedModel && isValidModelForProvider(savedModel, providerId)) return savedModel;
      return hasProviders ? getDefaultForProvider(providerId) : "";
    };

    return {
      matcherModel: getValidModelOrDefault(
        matcherLocalEdits.matcherModel,
        settings?.matcher_model,
        resolvedMatcherProviderId
      ),
      matcherProviderId: resolvedMatcherProviderId,
      resumeParserModel: getValidModelOrDefault(
        resumeParserLocalEdits.resumeParserModel,
        settings?.resume_parser_model,
        resolvedResumeParserProviderId
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
        resolvedAIWritingProviderId
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
  }, [settings, matcherLocalEdits, resumeParserLocalEdits, scraperLocalEdits, aiWritingLocalEdits, providers]);

  const {
    matcherModel, matcherProviderId, resumeParserModel, resumeParserProviderId, matcherReasoningEffort, resumeParserReasoningEffort, bulkEnabled, serializeOperations, batchSize, maxRetries, concurrencyLimit, timeoutMs,
    circuitBreakerThreshold, autoMatchAfterScrape, schedulerEnabled, schedulerCron, filterCountry, filterCity, filterTitleKeywords,
    aiWritingModel, aiWritingProviderId, aiWritingReasoningEffort, referralTone, referralLength,
    coverLetterTone, coverLetterLength, coverLetterFocus
  } = derivedValues;

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
    mutationFn: async () => {
      const res = await fetch("/api/jobs", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear jobs");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const clearMatchDataMutation = useMutation<{ jobsCleared: number }>({
    mutationFn: async () => {
      const res = await fetch("/api/jobs/match-data", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear match data");
      return res.json();
    },
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
    mutationFn: async () => {
      const res = await fetch("/api/ai/content", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear AI content");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ai-content"] });
      toast.success(data.message || "AI generated content deleted successfully");
    },
    onError: () => toast.error("Failed to delete AI generated content"),
  });

  const resumeParserMutation = useMutation({
    mutationFn: async (updates: { resume_parser_model?: string; resume_parser_provider_id?: string; resume_parser_reasoning_effort?: ReasoningEffort }) => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to save resume parser settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setResumeParserLocalEdits({});
    },
    onError: () => toast.error("Failed to save resume parser settings"),
  });

  const schedulerEnabledMutation = useMutation<MatcherSettings, Error, boolean, { previousEnabled: boolean }>({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduler_enabled: enabled }),
      });
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Failed to save scheduler enabled setting"));
      }
      return res.json();
    },
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
  ]);

  const matcherSettingsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });
      if (!res.ok) throw new Error("Failed to save matcher settings");
      return res.json();
    },
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
    mutationFn: async () => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduler_cron: schedulerCron,
          scraper_filter_country: filterCountry,
          scraper_filter_city: filterCity,
          scraper_filter_title_keywords: JSON.stringify(filterTitleKeywords),
        }),
      });
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Failed to save scraper settings"));
      }
      return res.json();
    },
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
    mutationFn: async (updates: Partial<AIWritingSettings>) => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referral_tone: updates.referralTone,
          referral_length: updates.referralLength,
          cover_letter_tone: updates.coverLetterTone,
          cover_letter_length: updates.coverLetterLength,
          cover_letter_focus: updates.coverLetterFocus ? JSON.stringify(updates.coverLetterFocus) : undefined,
          ai_writing_model: updates.aiWritingModel,
          ai_writing_provider_id: updates.aiWritingProviderId,
          ai_writing_reasoning_effort: updates.aiWritingReasoningEffort,
        }),
      });
      if (!res.ok) throw new Error("Failed to save AI writing settings");
      return res.json();
    },
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
    queryFn: async () => {
      const res = await fetch("/api/jobs/match-unmatched");
      if (!res.ok) throw new Error("Failed to fetch unmatched count");
      return res.json();
    },
  });

  const matchUnmatchedMutation = useMutation<{ total: number; matched: number; failed: number; sessionId: string }>({
    mutationFn: async () => {
      const res = await fetch("/api/jobs/match-unmatched", { method: "POST" });
      if (!res.ok) throw new Error("Failed to match jobs");
      return res.json();
    },
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
      const res = await fetch(`/api/jobs/match-unmatched?sessionId=${matchSessionId}`);
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
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <p className="mt-1 text-zinc-400">Configure your Switchy preferences and manage data</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Configuration (Spans 2 columns) */}
        <div className="space-y-6 lg:col-span-2">

          <AIProvidersManager
            providers={providers.map((p) => ({
              ...p,
              createdAt: new Date(p.createdAt),
              updatedAt: new Date(p.updatedAt),
            }))}
            onAddProvider={async (provider, apiKey) => {
              await addProviderMutation.mutateAsync({ provider, apiKey });
            }}
            onDeleteProvider={async (id) => {
              await deleteProviderMutation.mutateAsync(id);
            }}
            onUpdateProviderApiKey={async (id, apiKey) => {
              await updateProviderApiKeyMutation.mutateAsync({ id, apiKey });
            }}
          />

          <MatcherSection
            availableProviders={providers.map((p) => {
              const meta = getProviderMetadata(p.provider as AIProvider);
              return {
                id: p.id,
                provider: p.provider,
                name: meta?.displayName || p.provider,
                isActive: p.isActive,
              };
            })}
            hasProviders={providers.length > 0}
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
            availableProviders={providers.map((p) => {
              const meta = getProviderMetadata(p.provider as AIProvider);
              return {
                id: p.id,
                provider: p.provider,
                name: meta?.displayName || p.provider,
                isActive: p.isActive,
              };
            })}
            hasProviders={providers.length > 0}
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
            availableProviders={providers.map((p) => {
              const meta = getProviderMetadata(p.provider as AIProvider);
              return {
                id: p.id,
                provider: p.provider,
                name: meta?.displayName || p.provider,
                isActive: p.isActive,
              };
            })}
            hasProviders={providers.length > 0}
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
