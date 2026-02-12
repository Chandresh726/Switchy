"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";

import { AIProviderSection } from "@/components/settings/ai-provider-section";
import { MatcherSection } from "@/components/settings/matcher-section";
import { ScraperSettings } from "@/components/settings/scraper-settings";
import { DangerZone } from "@/components/settings/danger-zone";
import { ResumeParserSection } from "@/components/settings/resume-parser-section";
import { SystemInfo } from "@/components/settings/system-info";
import {
  AIProvider,
  getDefaultModelForProvider,
  getDefaultReasoningEffort,
  ReasoningEffort
} from "@/components/settings/constants";

interface MatcherSettings {
  matcher_model: string;
  resume_parser_model: string;
  matcher_reasoning_effort: string;
  resume_parser_reasoning_effort: string;
  matcher_bulk_enabled: string;
  matcher_batch_size: string;
  matcher_max_retries: string;
  matcher_concurrency_limit: string;
  matcher_timeout_ms: string;
  matcher_circuit_breaker_threshold: string;
  matcher_auto_match_after_scrape: string;
  global_scrape_frequency: string;
  scraper_filter_country?: string;
  scraper_filter_city?: string;
  scraper_filter_title_keywords?: string;
  // AI Provider Settings
  ai_provider?: string;
  anthropic_api_key?: string;
  google_auth_mode?: string;
  google_api_key?: string;
  google_client_id?: string;
  google_client_secret?: string;
  google_oauth_tokens?: string; // Presence indicates connection
  openrouter_api_key?: string;
  cerebras_api_key?: string;
  openai_api_key?: string;
}

interface MatcherLocalEdits {
  matcherModel?: string;
  resumeParserModel?: string;
  matcherReasoningEffort?: ReasoningEffort;
  resumeParserReasoningEffort?: ReasoningEffort;
  bulkEnabled?: boolean;
  batchSize?: number;
  maxRetries?: number;
  concurrencyLimit?: number;
  timeoutMs?: number;
  circuitBreakerThreshold?: number;
  autoMatchAfterScrape?: boolean;
}

interface ProviderLocalEdits {
  aiProvider?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  openaiApiKey?: string;
  openrouterApiKey?: string;
  cerebrasApiKey?: string;
  googleClientId?: string;
  googleClientSecret?: string;
}

interface ScraperLocalEdits {
  globalScrapeFrequency?: number;
  filterCountry?: string;
  filterCity?: string;
  filterTitleKeywords?: string[];
}

function SettingsContent() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [matcherLocalEdits, setMatcherLocalEdits] = useState<MatcherLocalEdits>({});
  const [providerLocalEdits, setProviderLocalEdits] = useState<ProviderLocalEdits>({});
  const [scraperLocalEdits, setScraperLocalEdits] = useState<ScraperLocalEdits>({});
  const [matcherSettingsSaved, setMatcherSettingsSaved] = useState(false);
  const [scraperSettingsSaved, setScraperSettingsSaved] = useState(false);

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

  const { data: settings } = useQuery<MatcherSettings>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  const derivedValues = useMemo(() => {
    const storedProvider = settings?.ai_provider as AIProvider | undefined;
    const storedGoogleMode = settings?.google_auth_mode;
    const normalizedProvider =
      storedProvider === "google"
        ? storedGoogleMode === "oauth"
          ? "gemini_cli_oauth"
          : "gemini_api_key"
        : storedProvider;
    const currentProvider: AIProvider =
      ((providerLocalEdits.aiProvider as AIProvider) ??
        normalizedProvider ??
        "anthropic");

    const defaultModel = getDefaultModelForProvider(currentProvider);
    const serverModel = settings?.matcher_model || defaultModel;
    const serverResumeModel = settings?.resume_parser_model || defaultModel;
    const serverMatcherReasoningEffort = (settings?.matcher_reasoning_effort as ReasoningEffort) || getDefaultReasoningEffort();
    const serverResumeParserReasoningEffort = (settings?.resume_parser_reasoning_effort as ReasoningEffort) || getDefaultReasoningEffort();

    return {
      matcherModel: matcherLocalEdits.matcherModel ?? serverModel,
      resumeParserModel: matcherLocalEdits.resumeParserModel ?? serverResumeModel,
      matcherReasoningEffort: matcherLocalEdits.matcherReasoningEffort ?? serverMatcherReasoningEffort,
      resumeParserReasoningEffort: matcherLocalEdits.resumeParserReasoningEffort ?? serverResumeParserReasoningEffort,
      bulkEnabled: matcherLocalEdits.bulkEnabled ?? (settings?.matcher_bulk_enabled !== "false"),
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
      globalScrapeFrequency:
        scraperLocalEdits.globalScrapeFrequency ??
        parseInt(settings?.global_scrape_frequency || "6", 10),
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
      // Provider
      aiProvider: currentProvider,
      anthropicApiKey: providerLocalEdits.anthropicApiKey ?? (settings?.anthropic_api_key || ""),
      googleApiKey: providerLocalEdits.googleApiKey ?? (settings?.google_api_key || ""),
      openaiApiKey: providerLocalEdits.openaiApiKey ?? (settings?.openai_api_key || ""),
      openrouterApiKey: providerLocalEdits.openrouterApiKey ?? (settings?.openrouter_api_key || ""),
      cerebrasApiKey: providerLocalEdits.cerebrasApiKey ?? (settings?.cerebras_api_key || ""),
    };
  }, [settings, matcherLocalEdits, providerLocalEdits, scraperLocalEdits]);

  const {
    matcherModel, resumeParserModel, matcherReasoningEffort, resumeParserReasoningEffort, bulkEnabled, batchSize, maxRetries, concurrencyLimit, timeoutMs,
    circuitBreakerThreshold, autoMatchAfterScrape, globalScrapeFrequency, filterCountry, filterCity, filterTitleKeywords, aiProvider, anthropicApiKey,
    googleApiKey, openaiApiKey, openrouterApiKey, cerebrasApiKey
  } = derivedValues;

  const scraperHasUnsavedChanges =
    scraperLocalEdits.globalScrapeFrequency !== undefined ||
    scraperLocalEdits.filterCountry !== undefined ||
    scraperLocalEdits.filterCity !== undefined ||
    scraperLocalEdits.filterTitleKeywords !== undefined;
  const matcherHasUnsavedChanges =
    matcherLocalEdits.matcherModel !== undefined ||
    matcherLocalEdits.resumeParserModel !== undefined ||
    matcherLocalEdits.matcherReasoningEffort !== undefined ||
    matcherLocalEdits.resumeParserReasoningEffort !== undefined ||
    matcherLocalEdits.bulkEnabled !== undefined ||
    matcherLocalEdits.batchSize !== undefined ||
    matcherLocalEdits.maxRetries !== undefined ||
    matcherLocalEdits.concurrencyLimit !== undefined ||
    matcherLocalEdits.timeoutMs !== undefined ||
    matcherLocalEdits.circuitBreakerThreshold !== undefined ||
    matcherLocalEdits.autoMatchAfterScrape !== undefined;

  // Setters for Matcher settings
  const setMatcherModel = (value: string) => setMatcherLocalEdits(prev => ({ ...prev, matcherModel: value }));
  const setResumeParserModel = (value: string) => setMatcherLocalEdits(prev => ({ ...prev, resumeParserModel: value }));
  const setMatcherReasoningEffort = (value: ReasoningEffort) => setMatcherLocalEdits(prev => ({ ...prev, matcherReasoningEffort: value }));
  const setResumeParserReasoningEffort = (value: ReasoningEffort) => setMatcherLocalEdits(prev => ({ ...prev, resumeParserReasoningEffort: value }));
  const setBulkEnabled = (value: boolean) => setMatcherLocalEdits(prev => ({ ...prev, bulkEnabled: value }));
  const setBatchSize = (value: number) =>
    setMatcherLocalEdits((prev) => ({ ...prev, batchSize: value }));
  const setMaxRetries = (value: number) =>
    setMatcherLocalEdits((prev) => ({ ...prev, maxRetries: value }));
  const setConcurrencyLimit = (value: number) =>
    setMatcherLocalEdits((prev) => ({ ...prev, concurrencyLimit: value }));
  const setTimeoutMs = (value: number) =>
    setMatcherLocalEdits((prev) => ({ ...prev, timeoutMs: value }));
  const setCircuitBreakerThreshold = (value: number) =>
    setMatcherLocalEdits((prev) => ({ ...prev, circuitBreakerThreshold: value }));
  const setAutoMatchAfterScrape = (value: boolean) =>
    setMatcherLocalEdits((prev) => ({ ...prev, autoMatchAfterScrape: value }));
  const setGlobalScrapeFrequency = (value: number) =>
    setScraperLocalEdits((prev) => ({ ...prev, globalScrapeFrequency: value }));
  const setFilterCountry = (value: string) =>
    setScraperLocalEdits((prev) => ({ ...prev, filterCountry: value }));
  const setFilterCity = (value: string) =>
    setScraperLocalEdits((prev) => ({ ...prev, filterCity: value }));
  const setFilterTitleKeywords = (value: string[]) =>
    setScraperLocalEdits((prev) => ({ ...prev, filterTitleKeywords: value }));
  const providerSettingsMutation = useMutation({
    mutationFn: async (updates: Partial<MatcherSettings>) => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to save AI provider settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setProviderLocalEdits((prev) => ({
        ...prev,
        aiProvider: undefined,
        anthropicApiKey: undefined,
        googleApiKey: undefined,
        openaiApiKey: undefined,
        openrouterApiKey: undefined,
        cerebrasApiKey: undefined,
      }));
      // Clear local model edits since they've been persisted with the provider change
      setMatcherLocalEdits((prev) => ({
        ...prev,
        matcherModel: undefined,
        resumeParserModel: undefined,
        matcherReasoningEffort: undefined,
        resumeParserReasoningEffort: undefined,
      }));
    },
    onError: () => {
      toast.error("Failed to save AI provider settings");
    },
  });

  const setAiProvider = (value: string) => {
    setProviderLocalEdits((prev) => ({ ...prev, aiProvider: value }));

    // When provider changes, update models to the new provider's defaults
    const newProvider = value as AIProvider;
    const defaultModel = getDefaultModelForProvider(newProvider);
    const defaultReasoningEffort = getDefaultReasoningEffort();
    setMatcherLocalEdits(prev => ({
      ...prev,
      matcherModel: defaultModel,
      resumeParserModel: defaultModel,
      matcherReasoningEffort: defaultReasoningEffort,
      resumeParserReasoningEffort: defaultReasoningEffort
    }));

    providerSettingsMutation.mutate({
      ai_provider: value,
      matcher_model: defaultModel,
      resume_parser_model: defaultModel,
      matcher_reasoning_effort: defaultReasoningEffort,
      resume_parser_reasoning_effort: defaultReasoningEffort,
    });
  };

  const setAnthropicApiKey = (value: string) => {
    setProviderLocalEdits(prev => ({ ...prev, anthropicApiKey: value }));
  };

  const saveAnthropicApiKey = () => {
    providerSettingsMutation.mutate({ anthropic_api_key: anthropicApiKey });
  };

  const setGoogleApiKey = (value: string) => {
    setProviderLocalEdits(prev => ({ ...prev, googleApiKey: value }));
  };

  const saveGoogleApiKey = () => {
    providerSettingsMutation.mutate({ google_api_key: googleApiKey });
  };

  const setOpenaiApiKey = (value: string) => {
    setProviderLocalEdits(prev => ({ ...prev, openaiApiKey: value }));
  };

  const saveOpenaiApiKey = () => {
    providerSettingsMutation.mutate({ openai_api_key: openaiApiKey });
  };

  const setOpenrouterApiKey = (value: string) => {
    setProviderLocalEdits(prev => ({ ...prev, openrouterApiKey: value }));
  };

  const saveOpenrouterApiKey = () => {
    providerSettingsMutation.mutate({ openrouter_api_key: openrouterApiKey });
  };

  const setCerebrasApiKey = (value: string) => {
    setProviderLocalEdits(prev => ({ ...prev, cerebrasApiKey: value }));
  };

  const saveCerebrasApiKey = () => {
    providerSettingsMutation.mutate({ cerebras_api_key: cerebrasApiKey });
  };

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/jobs/refresh", { method: "POST" });
      if (!res.ok) throw new Error("Failed to refresh");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });

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

  const matcherSettingsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matcher_model: matcherModel,
          resume_parser_model: resumeParserModel,
          matcher_reasoning_effort: matcherReasoningEffort,
          resume_parser_reasoning_effort: resumeParserReasoningEffort,
          matcher_bulk_enabled: bulkEnabled,
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
        resumeParserModel: undefined,
        matcherReasoningEffort: undefined,
        resumeParserReasoningEffort: undefined,
        bulkEnabled: undefined,
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

  const scraperSettingsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          global_scrape_frequency: globalScrapeFrequency,
          scraper_filter_country: filterCountry,
          scraper_filter_city: filterCity,
          scraper_filter_title_keywords: JSON.stringify(filterTitleKeywords),
        }),
      });
      if (!res.ok) throw new Error("Failed to save scraper settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setScraperLocalEdits((prev) => ({
        ...prev,
        globalScrapeFrequency: undefined,
        filterCountry: undefined,
        filterCity: undefined,
        filterTitleKeywords: undefined,
      }));
      setScraperSettingsSaved(true);
      setTimeout(() => setScraperSettingsSaved(false), 3000);
    },
    onError: () => toast.error("Failed to save scraper settings"),
  });

  // Query for unmatched jobs count
  const { data: unmatchedData } = useQuery<{ count: number }>({
    queryKey: ["unmatched-jobs-count"],
    queryFn: async () => {
      const res = await fetch("/api/jobs/match-unmatched");
      if (!res.ok) throw new Error("Failed to fetch unmatched count");
      return res.json();
    },
  });

  const matchUnmatchedMutation = useMutation<{ total: number; matched: number; failed: number; sessionId?: string }>({
    mutationFn: async () => {
      const res = await fetch("/api/jobs/match-unmatched", { method: "POST" });
      if (!res.ok) throw new Error("Failed to match jobs");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["unmatched-jobs-count"] });
      queryClient.invalidateQueries({ queryKey: ["match-history"] });
    },
  });

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

          <AIProviderSection
            aiProvider={aiProvider}
            onAiProviderChange={setAiProvider}
            anthropicApiKey={anthropicApiKey}
            onAnthropicApiKeyChange={setAnthropicApiKey}
            onAnthropicApiKeyBlur={saveAnthropicApiKey}
            googleApiKey={googleApiKey}
            onGoogleApiKeyChange={setGoogleApiKey}
            onGoogleApiKeyBlur={saveGoogleApiKey}
            openaiApiKey={openaiApiKey}
            onOpenaiApiKeyChange={setOpenaiApiKey}
            onOpenaiApiKeyBlur={saveOpenaiApiKey}
            openrouterApiKey={openrouterApiKey}
            onOpenrouterApiKeyChange={setOpenrouterApiKey}
            onOpenrouterApiKeyBlur={saveOpenrouterApiKey}
            cerebrasApiKey={cerebrasApiKey}
            onCerebrasApiKeyChange={setCerebrasApiKey}
            onCerebrasApiKeyBlur={saveCerebrasApiKey}
          />

          <MatcherSection
            matcherModel={matcherModel}
            onMatcherModelChange={setMatcherModel}
            matcherReasoningEffort={matcherReasoningEffort}
            onMatcherReasoningEffortChange={setMatcherReasoningEffort}
            aiProvider={aiProvider}
            autoMatchAfterScrape={autoMatchAfterScrape}
            onAutoMatchAfterScrapeChange={setAutoMatchAfterScrape}
            bulkEnabled={bulkEnabled}
            onBulkEnabledChange={setBulkEnabled}
            batchSize={batchSize}
            onBatchSizeChange={setBatchSize}
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
            unmatchedCount={unmatchedData?.count ?? 0}
          />

          <DangerZone
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
            globalScrapeFrequency={globalScrapeFrequency}
            onGlobalScrapeFrequencyChange={setGlobalScrapeFrequency}
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
            onRefresh={() => {
              toast.success("Refresh triggered", {
                action: {
                  label: "Details",
                  onClick: () => router.push("/history/scrape")
                }
              });
              refreshMutation.mutate();
            }}
            isRefreshing={refreshMutation.isPending}
          />

          <ResumeParserSection
            resumeParserModel={resumeParserModel}
            onResumeParserModelChange={setResumeParserModel}
            resumeParserReasoningEffort={resumeParserReasoningEffort}
            onResumeParserReasoningEffortChange={setResumeParserReasoningEffort}
            aiProvider={aiProvider}
          />

          <SystemInfo />
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-zinc-400">Loading settings...</div>}>
      <SettingsContent />
    </Suspense>
  );
}
