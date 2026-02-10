"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw,
  Database,
  Trash2,
  Save,
  Loader2,
  Cpu,
  Sparkles,
  Settings2,
  Eraser,
  AlertTriangle,
  Server,
  Activity,
  Info,
  Key,
  Globe,
  Terminal,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, Suspense } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { GeminiStatusDisplay } from "./gemini-status";

// Matcher models
const MODELS = [
  { id: "gemini-3-pro-preview", label: "Gemini 3 Pro", description: "Most capable model (Preview)" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", description: "Fastest model (Preview)" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", description: "Balanced performance" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", description: "Cost effective" },
];

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
  // AI Provider Settings
  ai_provider?: string;
  anthropic_api_key?: string;
  google_auth_mode?: string;
  google_api_key?: string;
  google_client_id?: string;
  google_client_secret?: string;
  google_oauth_tokens?: string; // Presence indicates connection
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
  // AI Provider Edits
  aiProvider?: string;
  anthropicApiKey?: string;
  googleAuthMode?: string;
  googleApiKey?: string;
  googleClientId?: string;
  googleClientSecret?: string;
}

function SettingsContent() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [localEdits, setLocalEdits] = useState<LocalEdits>({});
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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

  const { data: settings, isLoading: settingsLoading } = useQuery<MatcherSettings>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  const derivedValues = useMemo(() => {
    const serverModel = settings?.matcher_model || "gemini-3-flash-preview";
    const serverResumeModel = settings?.resume_parser_model || "gemini-3-flash-preview";
    return {
      matcherModel: localEdits.matcherModel ?? serverModel,
      resumeParserModel: localEdits.resumeParserModel ?? serverResumeModel,
      bulkEnabled: localEdits.bulkEnabled ?? (settings?.matcher_bulk_enabled !== "false"),
      batchSize: localEdits.batchSize ?? parseInt(settings?.matcher_batch_size || "2", 10),
      maxRetries: localEdits.maxRetries ?? parseInt(settings?.matcher_max_retries || "3", 10),
      concurrencyLimit: localEdits.concurrencyLimit ?? parseInt(settings?.matcher_concurrency_limit || "3", 10),
      timeoutMs: localEdits.timeoutMs ?? parseInt(settings?.matcher_timeout_ms || "30000", 10),
      circuitBreakerThreshold: localEdits.circuitBreakerThreshold ?? parseInt(settings?.matcher_circuit_breaker_threshold || "10", 10),
      autoMatchAfterScrape: localEdits.autoMatchAfterScrape ?? (settings?.matcher_auto_match_after_scrape !== "false"),
      // Provider
      aiProvider: localEdits.aiProvider ?? (settings?.ai_provider || "anthropic"),
      anthropicApiKey: localEdits.anthropicApiKey ?? (settings?.anthropic_api_key || ""),
      googleAuthMode: localEdits.googleAuthMode ?? (settings?.google_auth_mode || "api_key"),
      googleApiKey: localEdits.googleApiKey ?? (settings?.google_api_key || ""),
      googleClientId: localEdits.googleClientId ?? (settings?.google_client_id || ""),
      googleClientSecret: localEdits.googleClientSecret ?? (settings?.google_client_secret || ""),
      isGoogleConnected: !!settings?.google_oauth_tokens,
    };
  }, [settings, localEdits]);

  const {
    matcherModel, resumeParserModel, bulkEnabled, batchSize, maxRetries, concurrencyLimit, timeoutMs,
    circuitBreakerThreshold, autoMatchAfterScrape, aiProvider, anthropicApiKey,
    googleAuthMode, googleApiKey, googleClientId, googleClientSecret, isGoogleConnected
  } = derivedValues;

  // Setters
  const setMatcherModel = (value: string) => setLocalEdits(prev => ({ ...prev, matcherModel: value }));
  const setResumeParserModel = (value: string) => setLocalEdits(prev => ({ ...prev, resumeParserModel: value }));
  const setBulkEnabled = (value: boolean) => setLocalEdits(prev => ({ ...prev, bulkEnabled: value }));
  const setBatchSize = (value: number) => setLocalEdits(prev => ({ ...prev, batchSize: value }));
  const setMaxRetries = (value: number) => setLocalEdits(prev => ({ ...prev, maxRetries: value }));
  const setConcurrencyLimit = (value: number) => setLocalEdits(prev => ({ ...prev, concurrencyLimit: value }));
  const setTimeoutMs = (value: number) => setLocalEdits(prev => ({ ...prev, timeoutMs: value }));
  const setCircuitBreakerThreshold = (value: number) => setLocalEdits(prev => ({ ...prev, circuitBreakerThreshold: value }));
  const setAutoMatchAfterScrape = (value: boolean) => setLocalEdits(prev => ({ ...prev, autoMatchAfterScrape: value }));
  const setAiProvider = (value: string) => setLocalEdits(prev => ({ ...prev, aiProvider: value }));
  const setAnthropicApiKey = (value: string) => setLocalEdits(prev => ({ ...prev, anthropicApiKey: value }));
  const setGoogleAuthMode = (value: string) => setLocalEdits(prev => ({ ...prev, googleAuthMode: value }));
  const setGoogleApiKey = (value: string) => setLocalEdits(prev => ({ ...prev, googleApiKey: value }));
  const setGoogleClientId = (value: string) => setLocalEdits(prev => ({ ...prev, googleClientId: value }));
  const setGoogleClientSecret = (value: string) => setLocalEdits(prev => ({ ...prev, googleClientSecret: value }));

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

  const saveSettingsMutation = useMutation({
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
          ai_provider: aiProvider,
          anthropic_api_key: anthropicApiKey,
          google_auth_mode: googleAuthMode,
          google_api_key: googleApiKey,
          google_client_id: googleClientId,
          google_client_secret: googleClientSecret,
        }),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setLocalEdits({});
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
      toast.success("Settings saved");
    },
    onError: () => toast.error("Failed to save settings"),
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

          {/* AI Provider Configuration */}
          <Card className="border-zinc-800 bg-zinc-900/50 rounded-xl">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-blue-500" />
                <CardTitle>AI Provider</CardTitle>
              </div>
              <CardDescription>
                Choose which AI service to use for job matching
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                 <Label>Provider</Label>
                 <Select value={aiProvider} onValueChange={setAiProvider}>
                    <SelectTrigger className="w-full bg-zinc-950/50 border-zinc-800">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                      <SelectItem value="google">Google (Gemini)</SelectItem>
                    </SelectContent>
                 </Select>
              </div>

              {aiProvider === "anthropic" && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                   <Label htmlFor="anthropic-key">Anthropic API Key</Label>
                   <div className="relative">
                     <Key className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                     <Input
                        id="anthropic-key"
                        type="password"
                        placeholder="sk-ant-..."
                        value={anthropicApiKey}
                        onChange={(e) => setAnthropicApiKey(e.target.value)}
                        className="pl-9 bg-zinc-950/50 border-zinc-800 font-mono"
                     />
                   </div>
                   <p className="text-xs text-zinc-500">
                     Required for Claude models. Your key is stored locally.
                   </p>
                </div>
              )}

              {aiProvider === "google" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
                  <div className="space-y-3">
                    <Label>Authentication Method</Label>
                    <RadioGroup
                      value={googleAuthMode}
                      onValueChange={setGoogleAuthMode}
                      className="flex flex-col space-y-1"
                    >
                      <div className="flex items-center space-x-3 space-y-0 rounded-md border border-zinc-800 bg-zinc-950/30 p-3">
                         <RadioGroupItem value="api_key" id="mode-api-key" />
                         <div className="space-y-1">
                           <Label htmlFor="mode-api-key" className="font-medium cursor-pointer">API Key</Label>
                           <p className="text-xs text-zinc-500">Use a standard Google AI Studio API key</p>
                         </div>
                      </div>
                      <div className="flex items-center space-x-3 space-y-0 rounded-md border border-zinc-800 bg-zinc-950/30 p-3">
                         <RadioGroupItem value="oauth" id="mode-oauth" />
                         <div className="space-y-1">
                           <Label htmlFor="mode-oauth" className="font-medium cursor-pointer">OAuth / Gemini CLI</Label>
                           <p className="text-xs text-zinc-500">Sign in with your Google Account (Recommended for local use)</p>
                         </div>
                      </div>
                    </RadioGroup>
                  </div>

                  {googleAuthMode === "api_key" && (
                    <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                       <Label htmlFor="google-key">Google API Key</Label>
                       <div className="relative">
                         <Key className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                         <Input
                            id="google-key"
                            type="password"
                            placeholder="AIza..."
                            value={googleApiKey}
                            onChange={(e) => setGoogleApiKey(e.target.value)}
                            className="pl-9 bg-zinc-950/50 border-zinc-800 font-mono"
                         />
                       </div>
                    </div>
                  )}

                  {googleAuthMode === "oauth" && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                      <GeminiStatusDisplay />
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>


          {/* Matcher Configuration */}
          <Card className="border-zinc-800 bg-zinc-900/50 rounded-xl">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Cpu className="h-5 w-5 text-emerald-500" />
                <CardTitle>Matching Engine</CardTitle>
              </div>
              <CardDescription>
                Configure how the AI matches jobs to your profile
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Primary Settings */}
              <div className="grid gap-6">
                <div className="space-y-3">
                  <Label htmlFor="model-select">AI Model</Label>
                  <Select value={matcherModel} onValueChange={setMatcherModel}>
                    <SelectTrigger id="model-select" className="w-full bg-zinc-950/50 border-zinc-800">
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      {MODELS.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{model.label}</span>
                            <span className="text-zinc-600 text-xs">•</span>
                            <span className="text-xs text-zinc-400">{model.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-zinc-500">
                    The specific model version to use for inference.
                  </p>
                </div>

                <div className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950/30 p-4">
                  <input
                    type="checkbox"
                    id="auto-match"
                    checked={autoMatchAfterScrape}
                    onChange={(e) => setAutoMatchAfterScrape(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900"
                  />
                  <div>
                    <Label htmlFor="auto-match" className="cursor-pointer font-medium">
                      Auto-match after scrape
                    </Label>
                    <p className="text-xs text-zinc-500 mt-1">
                      Automatically trigger the matching process immediately after discovering new jobs.
                    </p>
                  </div>
                </div>
              </div>

              <Separator className="bg-zinc-800" />

              {/* Performance Settings */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="text-base">Performance & Limits</Label>
                    <p className="text-xs text-zinc-500">
                      Fine-tune API usage and concurrency
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="h-8 text-xs text-zinc-400 hover:text-white"
                  >
                    <Settings2 className="mr-2 h-3.5 w-3.5" />
                    {showAdvanced ? "Simple View" : "Advanced View"}
                  </Button>
                </div>

                <div className="grid gap-6">
                   <div className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950/30 p-4">
                    <input
                      type="checkbox"
                      id="bulk-enabled"
                      checked={bulkEnabled}
                      onChange={(e) => setBulkEnabled(e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900"
                    />
                    <div>
                      <Label htmlFor="bulk-enabled" className="cursor-pointer font-medium">
                        Bulk Matching
                      </Label>
                      <p className="text-xs text-zinc-500 mt-1">
                        Process multiple jobs in a single API call to save time and reduce requests.
                      </p>
                    </div>
                  </div>

                  {(showAdvanced || bulkEnabled) && (
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                       <div className={cn("space-y-2", !bulkEnabled && "opacity-50 grayscale")}>
                         <Label htmlFor="batch-size" className="text-xs text-zinc-400">Batch Size</Label>
                         <Input
                           id="batch-size"
                           type="number"
                           min={1}
                           max={10}
                           value={batchSize}
                           onChange={(e) => setBatchSize(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
                           className="bg-zinc-950/50 border-zinc-800"
                           disabled={!bulkEnabled}
                         />
                       </div>

                       {showAdvanced && (
                         <>
                           <div className="space-y-2">
                             <Label htmlFor="max-retries" className="text-xs text-zinc-400">Max Retries</Label>
                             <Input
                               id="max-retries"
                               type="number"
                               min={1}
                               max={5}
                               value={maxRetries}
                               onChange={(e) => setMaxRetries(Math.min(5, Math.max(1, parseInt(e.target.value) || 1)))}
                               className="bg-zinc-950/50 border-zinc-800"
                             />
                           </div>
                           <div className="space-y-2">
                             <Label htmlFor="timeout" className="text-xs text-zinc-400">Timeout (sec)</Label>
                             <Input
                               id="timeout"
                               type="number"
                               min={5}
                               max={120}
                               value={Math.round(timeoutMs / 1000)}
                               onChange={(e) => setTimeoutMs(Math.min(120000, Math.max(5000, (parseInt(e.target.value) || 5) * 1000)))}
                               className="bg-zinc-950/50 border-zinc-800"
                             />
                           </div>
                           <div className="space-y-2">
                             <Label htmlFor="concurrency" className="text-xs text-zinc-400">Concurrency</Label>
                             <Input
                               id="concurrency"
                               type="number"
                               min={1}
                               max={10}
                               value={concurrencyLimit}
                               onChange={(e) => setConcurrencyLimit(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
                               className="bg-zinc-950/50 border-zinc-800"
                             />
                           </div>
                           <div className="space-y-2 md:col-span-2 lg:col-span-1">
                             <Label htmlFor="circuit-breaker" className="text-xs text-zinc-400">Circuit Breaker</Label>
                             <Input
                               id="circuit-breaker"
                               type="number"
                               min={3}
                               max={50}
                               value={circuitBreakerThreshold}
                               onChange={(e) => setCircuitBreakerThreshold(Math.min(50, Math.max(3, parseInt(e.target.value) || 10)))}
                               className="bg-zinc-950/50 border-zinc-800"
                             />
                           </div>
                         </>
                       )}
                     </div>
                  )}
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900/50 px-6 py-4 rounded-b-xl">
              <p className="text-xs text-zinc-500">
                {settingsSaved ? (
                  <span className="flex items-center text-emerald-400 gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Changes saved successfully
                  </span>
                ) : Object.keys(localEdits).length > 0 ? (
                  <span className="text-yellow-400">Unsaved changes</span>
                ) : (
                  "Settings are up to date"
                )}
              </p>
              <Button
                onClick={() => saveSettingsMutation.mutate()}
                disabled={saveSettingsMutation.isPending || settingsLoading || Object.keys(localEdits).length === 0}
                className="bg-emerald-600 hover:bg-emerald-500 text-white min-w-[120px]"
              >
                {saveSettingsMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {saveSettingsMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </CardFooter>
          </Card>

          {/* Danger Zone */}
          <Card className="border-red-900/20 bg-red-950/5 overflow-hidden rounded-xl">
            <CardHeader className="border-b border-red-900/10 pb-4">
               <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <CardTitle className="text-red-500">Danger Zone</CardTitle>
              </div>
              <CardDescription className="text-red-400/60">
                Destructive actions that cannot be undone
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
               <div className="grid divide-y divide-red-900/10">
                 {/* Clear Match Data Row */}
                 <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 hover:bg-red-950/10 transition-colors">
                   <div className="space-y-1">
                     <h4 className="text-sm font-medium text-zinc-200">Delete Match History</h4>
                     <p className="text-xs text-zinc-500 max-w-sm">
                       Permanently removes all match scores and AI reasoning. Job listings are preserved.
                     </p>
                   </div>
                   <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="border-red-900/30 text-red-400 hover:bg-red-950/30 hover:text-red-300 hover:border-red-900/50">
                          <Eraser className="mr-2 h-4 w-4" />
                          Delete Scores & History
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete All Match History?</AlertDialogTitle>
                          <AlertDialogDescription className="space-y-2" asChild>
                            <div>
                              <p>This action will permanently delete:</p>
                              <ul className="list-disc list-inside text-zinc-400 ml-2">
                                <li>All AI match scores and confidence levels</li>
                                <li>Generated match reasoning and analysis</li>
                                <li>Historical records of match runs</li>
                              </ul>
                              <p className="mt-2 font-medium text-zinc-300">
                                Your scraped job listings and company data will NOT be deleted.
                              </p>
                            </div>
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-red-600 hover:bg-red-700 text-white"
                            onClick={() => clearMatchDataMutation.mutate()}
                          >
                            Yes, Delete History
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                 </div>

                 {/* Clear All Jobs Row */}
                 <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 hover:bg-red-950/10 transition-colors">
                   <div className="space-y-1">
                     <h4 className="text-sm font-medium text-zinc-200">Delete All Jobs</h4>
                     <p className="text-xs text-zinc-500 max-w-sm">
                       Permanently removes all scraped jobs and their associated data. Companies remain tracked.
                     </p>
                   </div>
                   <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="border-red-900/30 text-red-400 hover:bg-red-950/30 hover:text-red-300 hover:border-red-900/50">
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete Jobs
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete All Jobs</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete all jobs? This will remove all
                            scraped job postings from all companies. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-red-600 hover:bg-red-700"
                            onClick={() => clearJobsMutation.mutate()}
                          >
                            Yes, Delete All
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                 </div>
               </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Actions & Info */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <Card className="border-zinc-800 bg-zinc-900/50 rounded-xl">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-500" />
                <CardTitle className="text-base">Operations</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start border-zinc-800 hover:bg-zinc-800/50 hover:text-white"
                  onClick={() => refreshMutation.mutate()}
                  disabled={refreshMutation.isPending}
                >
                  <RefreshCw className={cn("mr-2 h-4 w-4", refreshMutation.isPending && "animate-spin")} />
                  {refreshMutation.isPending ? "Refreshing..." : "Refresh Jobs"}
                </Button>
                {refreshMutation.isSuccess && (
                  <p className="text-xs text-emerald-400 text-center animate-in fade-in slide-in-from-top-1">
                    Jobs refreshed successfully
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start border-zinc-800 hover:bg-zinc-800/50 hover:text-white",
                    unmatchedData && unmatchedData.count > 0 && "border-purple-500/30 text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
                  )}
                  onClick={() => matchUnmatchedMutation.mutate()}
                  disabled={matchUnmatchedMutation.isPending || (unmatchedData?.count ?? 0) === 0}
                >
                  <Sparkles className={cn("mr-2 h-4 w-4", matchUnmatchedMutation.isPending && "animate-pulse")} />
                  {matchUnmatchedMutation.isPending ? "Matching..." : "Match Unmatched"}
                  {unmatchedData && unmatchedData.count > 0 && (
                    <Badge variant="secondary" className="ml-auto bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 border-none h-5">
                      {unmatchedData.count}
                    </Badge>
                  )}
                </Button>
                {matchUnmatchedMutation.isSuccess && matchUnmatchedMutation.data && (
                  <p className="text-xs text-emerald-400 text-center animate-in fade-in slide-in-from-top-1">
                    Matched {matchUnmatchedMutation.data.matched} jobs
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* System Info */}
          <Card className="border-zinc-800 bg-zinc-900/50 rounded-xl">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-purple-500" />
                <CardTitle className="text-base">Resume Parser</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <Label htmlFor="resume-model-select">Parser Model</Label>
                <Select value={resumeParserModel} onValueChange={setResumeParserModel}>
                  <SelectTrigger id="resume-model-select" className="w-full bg-zinc-950/50 border-zinc-800">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {MODELS.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{model.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-zinc-500">
                  Model used for extracting data from resumes.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* System Info */}
          <Card className="border-zinc-800 bg-zinc-900/50 rounded-xl">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-zinc-400" />
                <CardTitle className="text-base">System Info</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-500">Version</Label>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-zinc-400 border-zinc-800">v0.1.0</Badge>
                  <span className="text-xs text-zinc-600">Beta</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-500">Database</Label>
                <div className="flex items-center gap-2 rounded-md bg-zinc-950/50 border border-zinc-800 px-3 py-2">
                  <Database className="h-3.5 w-3.5 text-zinc-500" />
                  <code className="text-xs text-zinc-400">data/switchy.db</code>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-500">Platforms</Label>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="bg-zinc-800 text-zinc-400 hover:bg-zinc-700">Greenhouse</Badge>
                  <Badge variant="secondary" className="bg-zinc-800 text-zinc-400 hover:bg-zinc-700">Lever</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tips Card */}
          <Card className="border-blue-900/20 bg-blue-950/5 rounded-xl">
             <CardContent className="p-4 flex gap-3">
               <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
               <div className="space-y-1">
                 <p className="text-sm font-medium text-blue-400">Pro Tip</p>
                 <p className="text-xs text-blue-300/70 leading-relaxed">
                   Enable "Bulk Matching" to significantly speed up processing when you have many new jobs.
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
