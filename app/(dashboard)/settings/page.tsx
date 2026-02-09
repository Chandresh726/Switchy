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
import { RefreshCw, Database, Trash2, Save, Loader2, Cpu, Zap } from "lucide-react";
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
}

interface LocalEdits {
  matcherModel?: string;
  bulkEnabled?: boolean;
  batchSize?: number;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();

  const [localEdits, setLocalEdits] = useState<LocalEdits>({});
  const [settingsSaved, setSettingsSaved] = useState(false);

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
    };
  }, [settings, localEdits]);

  const { matcherModel, bulkEnabled, batchSize } = derivedValues;

  const setMatcherModel = (value: string) => setLocalEdits(prev => ({ ...prev, matcherModel: value }));
  const setBulkEnabled = (value: boolean) => setLocalEdits(prev => ({ ...prev, bulkEnabled: value }));
  const setBatchSize = (value: number) => setLocalEdits(prev => ({ ...prev, batchSize: value }));

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

  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matcher_model: matcherModel,
          matcher_bulk_enabled: bulkEnabled,
          matcher_batch_size: batchSize,
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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <p className="mt-1 text-zinc-400">Configure your Switchy preferences</p>
      </div>

      {/* Matcher Settings - Two Column Layout */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="flex items-center gap-2 mb-1">
          <Cpu className="h-5 w-5 text-emerald-500" />
          <h2 className="text-lg font-medium text-white">Matcher Settings</h2>
        </div>
        <p className="text-sm text-zinc-400 mb-6">
          Configure AI job matching behavior
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Model Selection */}
          <div className="space-y-4">
            <div>
              <Label className="text-zinc-300 text-sm font-medium">AI Model</Label>
              <p className="text-xs text-zinc-500 mt-0.5 mb-3">
                Select the model used for matching jobs to your profile
              </p>
              <Select value={matcherModel} onValueChange={setMatcherModel}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      <div className="flex items-center gap-2">
                        <span>{model.label}</span>
                        <span className="text-zinc-500 text-xs">({model.description})</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Right Column - Bulk Settings */}
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <input
                  type="checkbox"
                  id="bulk-enabled"
                  checked={bulkEnabled}
                  onChange={(e) => setBulkEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900"
                />
                <div>
                  <Label htmlFor="bulk-enabled" className="text-zinc-300 text-sm font-medium cursor-pointer">
                    Enable Bulk Matching
                  </Label>
                  <p className="text-xs text-zinc-500">
                    Process multiple jobs per API call
                  </p>
                </div>
              </div>
            </div>

            <div className={!bulkEnabled ? "opacity-50" : ""}>
              <Label htmlFor="batch-size" className="text-zinc-300 text-sm font-medium">
                Batch Size
              </Label>
              <p className="text-xs text-zinc-500 mt-0.5 mb-2">
                Jobs per API call (1-10). Lower = more reliable.
              </p>
              <Input
                id="batch-size"
                type="number"
                min={1}
                max={10}
                value={batchSize}
                onChange={(e) => setBatchSize(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
                className="w-24"
                disabled={!bulkEnabled}
              />
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="mt-6 pt-4 border-t border-zinc-800 flex items-center gap-3">
          <Button
            onClick={() => saveSettingsMutation.mutate()}
            disabled={saveSettingsMutation.isPending || settingsLoading}
          >
            {saveSettingsMutation.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Save />
            )}
            {saveSettingsMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>

          {settingsSaved && (
            <span className="text-sm text-emerald-400">
              Settings saved successfully!
            </span>
          )}
        </div>
      </div>

      {/* Actions Grid - Two Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Job Refresh */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="flex items-center gap-2 mb-1">
            <RefreshCw className="h-5 w-5 text-blue-500" />
            <h2 className="text-lg font-medium text-white">Job Scraping</h2>
          </div>
          <p className="text-sm text-zinc-400 mb-4">
            Manually refresh jobs from all tracked companies
          </p>

          <Button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            <RefreshCw className={refreshMutation.isPending ? "animate-spin" : ""} />
            {refreshMutation.isPending ? "Refreshing..." : "Refresh All Jobs"}
          </Button>

          {refreshMutation.isSuccess && (
            <p className="mt-2 text-sm text-emerald-400">
              Jobs refreshed successfully!
            </p>
          )}
        </div>

        {/* Clear Jobs */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="flex items-center gap-2 mb-1">
            <Trash2 className="h-5 w-5 text-red-500" />
            <h2 className="text-lg font-medium text-white">Clear Job Data</h2>
          </div>
          <p className="text-sm text-zinc-400 mb-4">
            Delete all scraped jobs. Companies will be kept.
          </p>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="text-red-400 hover:text-red-300 hover:border-red-400/50">
                <Trash2 className="h-4 w-4" />
                Clear All Jobs
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear All Jobs</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete all jobs? This will remove all
                  scraped job postings from all companies. The companies
                  themselves will not be deleted. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => clearJobsMutation.mutate()}
                >
                  Delete All Jobs
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {clearJobsMutation.isSuccess && (
            <p className="mt-2 text-sm text-emerald-400">
              All jobs cleared successfully!
            </p>
          )}
        </div>
      </div>

      {/* Info Grid - Two Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Database Info */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="flex items-center gap-2 mb-1">
            <Database className="h-5 w-5 text-zinc-400" />
            <h2 className="text-lg font-medium text-white">Database</h2>
          </div>
          <p className="text-sm text-zinc-400 mb-4">
            Your data is stored locally in SQLite
          </p>

          <div className="flex items-center gap-2 text-sm text-zinc-500 bg-zinc-800/50 px-3 py-2 rounded-md w-fit">
            <Database className="h-4 w-4" />
            <code>data/switchy.db</code>
          </div>
        </div>

        {/* About */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="h-5 w-5 text-yellow-500" />
            <h2 className="text-lg font-medium text-white">About Switchy</h2>
          </div>
          <p className="text-sm text-zinc-400 mb-4">
            Local job hunting app with AI-powered matching
          </p>

          <div className="space-y-1 text-sm text-zinc-500">
            <p>Version: <span className="text-zinc-400">0.1.0</span></p>
            <p>Platforms: <span className="text-zinc-400">Greenhouse, Lever</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}
