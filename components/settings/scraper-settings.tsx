"use client";

import { useState } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Timer, Save, Loader2, X, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrapeCountdown } from "./scrape-countdown";

const CRON_PRESETS = [
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 3 hours", value: "0 */3 * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Every 12 hours", value: "0 */12 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Custom...", value: "__custom__" },
] as const;

interface ScraperSettingsProps {
  schedulerCron: string;
  onSchedulerCronChange: (value: string) => void;
  filterCountry: string;
  filterCity: string;
  onFilterCountryChange: (value: string) => void;
  onFilterCityChange: (value: string) => void;
  filterTitleKeywords: string[];
  onFilterTitleKeywordsChange: (value: string[]) => void;
  onSave: () => void;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  settingsSaved: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function ScraperSettings({
  schedulerCron,
  onSchedulerCronChange,
  filterCountry,
  filterCity,
  onFilterCountryChange,
  onFilterCityChange,
  filterTitleKeywords,
  onFilterTitleKeywordsChange,
  onSave,
  isSaving,
  hasUnsavedChanges,
  settingsSaved,
  onRefresh,
  isRefreshing,
}: ScraperSettingsProps) {
  const [keywordInput, setKeywordInput] = useState("");

  const isPreset = CRON_PRESETS.some((p) => p.value === schedulerCron);
  const selectedPreset = isPreset ? schedulerCron : "__custom__";
  const [showCustom, setShowCustom] = useState(!isPreset && schedulerCron !== "");

  const handlePresetChange = (value: string) => {
    if (value === "__custom__") {
      setShowCustom(true);
    } else {
      setShowCustom(false);
      onSchedulerCronChange(value);
    }
  };

  const handleAddKeyword = () => {
    const trimmed = keywordInput.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (filterTitleKeywords.some((k) => k.toLowerCase() === lower)) return;
    onFilterTitleKeywordsChange([...filterTitleKeywords, trimmed]);
    setKeywordInput("");
  };

  return (
    <Card className="border-zinc-800 bg-zinc-900/50 rounded-xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-emerald-500" />
            <CardTitle>Scraper Settings</CardTitle>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-zinc-700 hover:bg-zinc-800 hover:text-white"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", isRefreshing && "animate-spin")} />
            {isRefreshing ? "Refreshing..." : "Refresh Jobs"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label>Schedule</Label>
          <div className="flex items-center gap-4 flex-wrap">
            <Select value={selectedPreset} onValueChange={handlePresetChange}>
              <SelectTrigger className="bg-zinc-950/50 border-zinc-800 w-[180px]">
                <SelectValue placeholder="Select schedule" />
              </SelectTrigger>
              <SelectContent>
                {CRON_PRESETS.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {showCustom && (
              <Input
                value={schedulerCron}
                onChange={(e) => onSchedulerCronChange(e.target.value)}
                placeholder="0 */6 * * *"
                className="bg-zinc-950/50 border-zinc-800 w-[160px]"
              />
            )}
            <ScrapeCountdown className="ml-auto" />
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-zinc-800">
          <Label>Location Filter</Label>
          <p className="text-xs text-zinc-500 -mt-2">Only matching jobs are added. Remote jobs always included.</p>
          
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="filter-country" className="text-sm text-zinc-400">Country</Label>
              <Input
                id="filter-country"
                value={filterCountry}
                onChange={(e) => onFilterCountryChange(e.target.value)}
                placeholder="India"
                className="bg-zinc-950/50 border-zinc-800"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="filter-city" className="text-sm text-zinc-400">City</Label>
              <Input
                id="filter-city"
                value={filterCity}
                onChange={(e) => onFilterCityChange(e.target.value)}
                placeholder="e.g., Bangalore"
                className="bg-zinc-950/50 border-zinc-800"
              />
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-zinc-800">
          <Label htmlFor="filter-title-keywords">Job Title Keywords</Label>
          <p className="text-xs text-zinc-500 -mt-2">
            Add keywords to filter jobs by title (e.g., Engineer).
          </p>
          <Input
            id="filter-title-keywords"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddKeyword();
              }
            }}
            placeholder="Type a keyword and press Enter"
            className="bg-zinc-950/50 border-zinc-800"
          />
          {filterTitleKeywords.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {filterTitleKeywords.map((keyword, index) => (
                <span
                  key={`${keyword}-${index}`}
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs text-emerald-400"
                >
                  {keyword}
                  <button
                    type="button"
                    onClick={() => onFilterTitleKeywordsChange(filterTitleKeywords.filter((_, i) => i !== index))}
                    className="rounded-full p-0.5 hover:bg-emerald-500/30"
                    aria-label={`Remove ${keyword}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900/50 px-6 py-4 rounded-b-xl">
        <p className="text-xs text-zinc-500">
          {settingsSaved ? (
            <span className="flex items-center text-emerald-400 gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Saved
            </span>
          ) : hasUnsavedChanges ? (
            <span className="text-yellow-400">Unsaved changes</span>
          ) : (
            "Up to date"
          )}
        </p>
        <Button
          onClick={onSave}
          disabled={isSaving || !hasUnsavedChanges}
          className="bg-emerald-600 hover:bg-emerald-500 text-white min-w-[100px]"
        >
          {isSaving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </CardFooter>
    </Card>
  );
}
