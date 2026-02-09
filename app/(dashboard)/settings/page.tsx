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
  Zap,
  Sparkles,
  Settings2,
  Eraser,
  AlertTriangle,
  Server,
  Activity,
  Info,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
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

// Matcher models
const MODELS = [
  { id: "gemini-3-flash", label: "Gemini 3 Flash", description: "Fast and efficient" },
  { id: "gemini-3-pro-high", label: "Gemini 3 Pro High", description: "Best quality" },
  { id: "gemini-3-pro-low", label: "Gemini 3 Pro Low", description: "Balanced" },
];

interface MatcherSettings {
  matcher_model: string;
  matcher_bulk_enabled: string;
  matcher_batch_size: string;
  matcher_max_retries: string;
  matcher_concurrency_limit: string;
  matcher_timeout_ms: string;
  matcher_circuit_breaker_threshold: string;
  matcher_auto_match_after_scrape: string;
}

interface LocalEdits {
  matcherModel?: string;
  bulkEnabled?: boolean;
  batchSize?: number;
  maxRetries?: number;
  concurrencyLimit?: number;
  timeoutMs?: number;
  circuitBreakerThreshold?: number;
  autoMatchAfterScrape?: boolean;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();

  const [localEdits, setLocalEdits] = useState<LocalEdits>({});
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { data: settings, isLoading: settingsLoading } = useQuery<MatcherSettings>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  const derivedValues = useMemo(() => {
    const serverModel = settings?.matcher_model || "gemini-3-flash";
    return {
      matcherModel: localEdits.matcherModel ?? serverModel,
      bulkEnabled: localEdits.bulkEnabled ?? (settings?.matcher_bulk_enabled !== "false"),
      batchSize: localEdits.batchSize ?? parseInt(settings?.matcher_batch_size || "2", 10),
      maxRetries: localEdits.maxRetries ?? parseInt(settings?.matcher_max_retries || "3", 10),
      concurrencyLimit: localEdits.concurrencyLimit ?? parseInt(settings?.matcher_concurrency_limit || "3", 10),
      timeoutMs: localEdits.timeoutMs ?? parseInt(settings?.matcher_timeout_ms || "30000", 10),
      circuitBreakerThreshold: localEdits.circuitBreakerThreshold ?? parseInt(settings?.matcher_circuit_breaker_threshold || "10", 10),
      autoMatchAfterScrape: localEdits.autoMatchAfterScrape ?? (settings?.matcher_auto_match_after_scrape !== "false"),
    };
  }, [settings, localEdits]);

  const { matcherModel, bulkEnabled, batchSize, maxRetries, concurrencyLimit, timeoutMs, circuitBreakerThreshold, autoMatchAfterScrape } = derivedValues;

  const setMatcherModel = (value: string) => setLocalEdits(prev => ({ ...prev, matcherModel: value }));
  const setBulkEnabled = (value: boolean) => setLocalEdits(prev => ({ ...prev, bulkEnabled: value }));
  const setBatchSize = (value: number) => setLocalEdits(prev => ({ ...prev, batchSize: value }));
  const setMaxRetries = (value: number) => setLocalEdits(prev => ({ ...prev, maxRetries: value }));
  const setConcurrencyLimit = (value: number) => setLocalEdits(prev => ({ ...prev, concurrencyLimit: value }));
  const setTimeoutMs = (value: number) => setLocalEdits(prev => ({ ...prev, timeoutMs: value }));
  const setCircuitBreakerThreshold = (value: number) => setLocalEdits(prev => ({ ...prev, circuitBreakerThreshold: value }));
  const setAutoMatchAfterScrape = (value: boolean) => setLocalEdits(prev => ({ ...prev, autoMatchAfterScrape: value }));

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

  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matcher_model: matcherModel,
          matcher_bulk_enabled: bulkEnabled,
          matcher_batch_size: batchSize,
          matcher_max_retries: maxRetries,
          matcher_concurrency_limit: concurrencyLimit,
          matcher_timeout_ms: timeoutMs,
          matcher_circuit_breaker_threshold: circuitBreakerThreshold,
          matcher_auto_match_after_scrape: autoMatchAfterScrape,
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
    },
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
                    The AI model used to analyze job descriptions against your profile.
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
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
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
