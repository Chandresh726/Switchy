"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

import { AIProviderSection } from "@/components/settings/ai-provider-section";
import { MatcherSection } from "@/components/settings/matcher-section";
import { ScraperSection } from "@/components/settings/scraper-section";
import { DangerZone } from "@/components/settings/danger-zone";
import { QuickActions } from "@/components/settings/quick-actions";
import { ResumeParserSection } from "@/components/settings/resume-parser-section";
import { SystemInfo } from "@/components/settings/system-info";
import {
  AIProvider,
  getModelsForProvider,
  getDefaultModelForProvider
} from "@/components/settings/constants";

interface MatcherSettings {
  matcher_model: string;
  resume_parser_model: string;
  matcher_bulk_enabled: string;
  matcher_batch_size: string;
  matcher_max_retries: string;
  matcher_concurrency_limit: string;
  matcher_timeout_ms: string;
  matcher_circuit_breaker_threshold: string;
  matcher_auto_match_after_scrape: string;
  global_scrape_frequency: string;
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

interface LocalEdits {
  matcherModel?: string;
  resumeParserModel?: string;
  bulkEnabled?: boolean;
  batchSize?: number;
  maxRetries?: number;
  concurrencyLimit?: number;
  timeoutMs?: number;
  circuitBreakerThreshold?: number;
  autoMatchAfterScrape?: boolean;
  globalScrapeFrequency?: number;
  // AI Provider Edits
  aiProvider?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  openaiApiKey?: string;
  openrouterApiKey?: string;
  cerebrasApiKey?: string;
  googleClientId?: string;
  googleClientSecret?: string;
}

function SettingsContent() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [localEdits, setLocalEdits] = useState<LocalEdits>({});
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
      ((localEdits.aiProvider as AIProvider) ??
        normalizedProvider ??
        "anthropic");

    const defaultModel = getDefaultModelForProvider(currentProvider);
    const serverModel = settings?.matcher_model || defaultModel;
    const serverResumeModel = settings?.resume_parser_model || defaultModel;

    return {
      matcherModel: localEdits.matcherModel ?? serverModel,
      resumeParserModel: localEdits.resumeParserModel ?? serverResumeModel,
      bulkEnabled: localEdits.bulkEnabled ?? (settings?.matcher_bulk_enabled !== "false"),
      batchSize: localEdits.batchSize ?? parseInt(settings?.matcher_batch_size || "2", 10),
      maxRetries: localEdits.maxRetries ?? parseInt(settings?.matcher_max_retries || "3", 10),
      concurrencyLimit: localEdits.concurrencyLimit ?? parseInt(settings?.matcher_concurrency_limit || "3", 10),
      timeoutMs:
        localEdits.timeoutMs ??
        parseInt(settings?.matcher_timeout_ms || "30000", 10),
      circuitBreakerThreshold:
        localEdits.circuitBreakerThreshold ??
        parseInt(settings?.matcher_circuit_breaker_threshold || "10", 10),
      autoMatchAfterScrape:
        localEdits.autoMatchAfterScrape ??
        (settings?.matcher_auto_match_after_scrape !== "false"),
      globalScrapeFrequency:
        localEdits.globalScrapeFrequency ??
        parseInt(settings?.global_scrape_frequency || "6", 10),
      // Provider
      aiProvider: currentProvider,
      anthropicApiKey: localEdits.anthropicApiKey ?? (settings?.anthropic_api_key || ""),
      googleApiKey: localEdits.googleApiKey ?? (settings?.google_api_key || ""),
      openaiApiKey: localEdits.openaiApiKey ?? (settings?.openai_api_key || ""),
      openrouterApiKey: localEdits.openrouterApiKey ?? (settings?.openrouter_api_key || ""),
      cerebrasApiKey: localEdits.cerebrasApiKey ?? (settings?.cerebras_api_key || ""),
      // googleClientId: localEdits.googleClientId ?? (settings?.google_client_id || ""),
      // googleClientSecret: localEdits.googleClientSecret ?? (settings?.google_client_secret || ""),
    };
  }, [settings, localEdits]);

  const {
    matcherModel, resumeParserModel, bulkEnabled, batchSize, maxRetries, concurrencyLimit, timeoutMs,
    circuitBreakerThreshold, autoMatchAfterScrape, globalScrapeFrequency, aiProvider, anthropicApiKey,
    googleApiKey, openaiApiKey, openrouterApiKey, cerebrasApiKey
  } = derivedValues;

  const scraperHasUnsavedChanges = localEdits.globalScrapeFrequency !== undefined;
  const matcherHasUnsavedChanges =
    localEdits.matcherModel !== undefined ||
    localEdits.resumeParserModel !== undefined ||
    localEdits.bulkEnabled !== undefined ||
    localEdits.batchSize !== undefined ||
    localEdits.maxRetries !== undefined ||
    localEdits.concurrencyLimit !== undefined ||
    localEdits.timeoutMs !== undefined ||
    localEdits.circuitBreakerThreshold !== undefined ||
    localEdits.autoMatchAfterScrape !== undefined;

  // Setters
  const setMatcherModel = (value: string) => setLocalEdits(prev => ({ ...prev, matcherModel: value }));
  const setResumeParserModel = (value: string) => setLocalEdits(prev => ({ ...prev, resumeParserModel: value }));
  const setBulkEnabled = (value: boolean) => setLocalEdits(prev => ({ ...prev, bulkEnabled: value }));
  const setBatchSize = (value: number) =>
    setLocalEdits((prev) => ({ ...prev, batchSize: value }));
  const setMaxRetries = (value: number) =>
    setLocalEdits((prev) => ({ ...prev, maxRetries: value }));
  const setConcurrencyLimit = (value: number) =>
    setLocalEdits((prev) => ({ ...prev, concurrencyLimit: value }));
  const setTimeoutMs = (value: number) =>
    setLocalEdits((prev) => ({ ...prev, timeoutMs: value }));
  const setCircuitBreakerThreshold = (value: number) =>
    setLocalEdits((prev) => ({ ...prev, circuitBreakerThreshold: value }));
  const setAutoMatchAfterScrape = (value: boolean) =>
    setLocalEdits((prev) => ({ ...prev, autoMatchAfterScrape: value }));
  const setGlobalScrapeFrequency = (value: number) =>
    setLocalEdits((prev) => ({ ...prev, globalScrapeFrequency: value }));
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
    },
    onError: () => {
      toast.error("Failed to save AI provider settings");
    },
  });

  const setAiProvider = (value: string) => {
    setLocalEdits((prev) => {
      const models = getModelsForProvider(value);
      const defaultModelId = getDefaultModelForProvider(value);

      const ensureModelForProvider = (current?: string) =>
        current && models.some((m) => m.id === current) ? current : defaultModelId;

      return {
        ...prev,
        aiProvider: value,
        matcherModel: ensureModelForProvider(prev.matcherModel),
        resumeParserModel: ensureModelForProvider(prev.resumeParserModel),
      };
    });

    providerSettingsMutation.mutate({ ai_provider: value });
  };

  const setAnthropicApiKey = (value: string) => {
    setLocalEdits(prev => ({ ...prev, anthropicApiKey: value }));
    providerSettingsMutation.mutate({ anthropic_api_key: value });
  };

  const setGoogleApiKey = (value: string) => {
    setLocalEdits(prev => ({ ...prev, googleApiKey: value }));
    providerSettingsMutation.mutate({ google_api_key: value });
  };

  const setOpenaiApiKey = (value: string) => {
    setLocalEdits(prev => ({ ...prev, openaiApiKey: value }));
    providerSettingsMutation.mutate({ openai_api_key: value });
  };

  const setOpenrouterApiKey = (value: string) => {
    setLocalEdits(prev => ({ ...prev, openrouterApiKey: value }));
    providerSettingsMutation.mutate({ openrouter_api_key: value });
  };

  const setCerebrasApiKey = (value: string) => {
    setLocalEdits(prev => ({ ...prev, cerebrasApiKey: value }));
    providerSettingsMutation.mutate({ cerebras_api_key: value });
  };

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/jobs/refresh", { method: "POST" });
      if (!res.ok) throw new Error("Failed to refresh");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("Jobs refreshed successfully");
    },
    onError: () => toast.error("Failed to refresh jobs"),
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
      toast.success("All jobs deleted");
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
      toast.success("Match history cleared");
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
      setLocalEdits((prev) => ({
        ...prev,
        matcherModel: undefined,
        resumeParserModel: undefined,
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
      toast.success("Matcher settings saved");
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
        }),
      });
      if (!res.ok) throw new Error("Failed to save scraper settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setLocalEdits((prev) => ({
        ...prev,
        globalScrapeFrequency: undefined,
      }));
      setScraperSettingsSaved(true);
      setTimeout(() => setScraperSettingsSaved(false), 3000);
      toast.success("Scraper settings saved");
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["unmatched-jobs-count"] });
      queryClient.invalidateQueries({ queryKey: ["match-history"] });
      toast.success(`Matched ${data.matched} jobs`);
    },
    onError: () => toast.error("Failed to start matching"),
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
            googleApiKey={googleApiKey}
            onGoogleApiKeyChange={setGoogleApiKey}
            openaiApiKey={openaiApiKey}
            onOpenaiApiKeyChange={setOpenaiApiKey}
            openrouterApiKey={openrouterApiKey}
            onOpenrouterApiKeyChange={setOpenrouterApiKey}
            cerebrasApiKey={cerebrasApiKey}
            onCerebrasApiKeyChange={setCerebrasApiKey}
          />

          <MatcherSection
            matcherModel={matcherModel}
            onMatcherModelChange={setMatcherModel}
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
          />

          <DangerZone
            onClearMatchData={() => clearMatchDataMutation.mutate()}
            onClearJobs={() => clearJobsMutation.mutate()}
          />
        </div>

        {/* Right Column: Actions & Info */}
        <div className="space-y-6">
          <ScraperSection
            globalScrapeFrequency={globalScrapeFrequency}
            onGlobalScrapeFrequencyChange={setGlobalScrapeFrequency}
            onSave={() => scraperSettingsMutation.mutate()}
            isSaving={scraperSettingsMutation.isPending}
            hasUnsavedChanges={scraperHasUnsavedChanges}
            settingsSaved={scraperSettingsSaved}
          />

          <QuickActions
            onRefresh={() => refreshMutation.mutate()}
            isRefreshing={refreshMutation.isPending}
            isRefreshSuccess={refreshMutation.isSuccess}
            onMatchUnmatched={() => matchUnmatchedMutation.mutate()}
            isMatching={matchUnmatchedMutation.isPending}
            isMatchSuccess={matchUnmatchedMutation.isSuccess}
            unmatchedCount={unmatchedData?.count ?? 0}
            matchedCount={matchUnmatchedMutation.data?.matched}
          />

          <ResumeParserSection
            resumeParserModel={resumeParserModel}
            onResumeParserModelChange={setResumeParserModel}
            aiProvider={aiProvider}
          />

          <SystemInfo />

          {/* Tips Card */}
          <Card className="border-blue-900/20 bg-blue-950/5 rounded-xl">
             <CardContent className="p-4 flex gap-3">
               <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
               <div className="space-y-1">
                 <p className="text-sm font-medium text-blue-400">Pro Tip</p>
                 <p className="text-xs text-blue-300/70 leading-relaxed">
                   Enable &quot;Bulk Matching&quot; to significantly speed up processing when you have many new jobs.
                 </p>
               </div>
             </CardContent>
          </Card>
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
