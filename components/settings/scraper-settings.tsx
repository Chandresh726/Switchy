"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Timer, Save, Loader2, X } from "lucide-react";
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
  schedulerEnabled: boolean;
  onSchedulerEnabledChange: (value: boolean) => void;
  schedulerCron: string;
  onSchedulerCronChange: (value: string) => void;
  maxParallelScrapes: number;
  onMaxParallelScrapesChange: (value: number) => void;
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
}

export function ScraperSettings({
  schedulerEnabled,
  onSchedulerEnabledChange,
  schedulerCron,
  onSchedulerCronChange,
  maxParallelScrapes,
  onMaxParallelScrapesChange,
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
}: ScraperSettingsProps) {
  const [keywordInput, setKeywordInput] = useState("");
  const [isCustomSelected, setIsCustomSelected] = useState<boolean>(() =>
    !CRON_PRESETS.some((p) => p.value === schedulerCron)
  );

  const isPreset = useMemo(
    () => CRON_PRESETS.some((p) => p.value === schedulerCron),
    [schedulerCron]
  );

  const selectedPreset =
    isCustomSelected ? "__custom__" : (isPreset ? schedulerCron : "__custom__");
  const showCustom = isCustomSelected || !isPreset;

  const handlePresetChange = (value: string) => {
    if (value === "__custom__") {
      setIsCustomSelected(true);
    } else {
      setIsCustomSelected(false);
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
    <Card className="border-border bg-card/70 rounded-xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-emerald-500" />
            <CardTitle>Scraper Settings</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Auto-Scrape</span>
            <Switch
              checked={schedulerEnabled}
              onCheckedChange={onSchedulerEnabledChange}
              aria-label="Enable auto-scrape"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label>Scheduler Frequency</Label>
          <div className="flex items-center gap-3">
            <Select
              value={selectedPreset}
              onValueChange={handlePresetChange}
            >
              <SelectTrigger className="bg-background/60 border-border flex-1">
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
                className="bg-background/60 border-border w-[160px]"
              />
            )}
            {schedulerEnabled && (
              <ScrapeCountdown />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-6 pt-4 border-t border-border">
          <div className="space-y-1">
            <Label htmlFor="max-parallel-scrapes">Max Parallel Scrapes</Label>
            <p className="text-xs text-muted-foreground">
              Max concurrent company scrapes.
            </p>
          </div>
          <Input
            id="max-parallel-scrapes"
            type="number"
            min={1}
            max={10}
            value={maxParallelScrapes}
            onChange={(e) => {
              const parsed = parseInt(e.target.value, 10);
              onMaxParallelScrapesChange(Math.min(10, Math.max(1, Number.isNaN(parsed) ? 1 : parsed)));
            }}
            className="bg-background/60 border-border w-[100px] text-center shrink-0"
          />
        </div>

        <div className="space-y-4 pt-4 border-t border-border">
          <Label>Location Filter</Label>
          <p className="text-xs text-muted-foreground -mt-2">Only matching jobs are added. Remote jobs always included.</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="filter-country" className="text-sm text-muted-foreground">Country</Label>
              <Input
                id="filter-country"
                value={filterCountry}
                onChange={(e) => onFilterCountryChange(e.target.value)}
                placeholder="India"
                className="bg-background/60 border-border"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="filter-city" className="text-sm text-muted-foreground">City</Label>
              <Input
                id="filter-city"
                value={filterCity}
                onChange={(e) => onFilterCityChange(e.target.value)}
                placeholder="e.g., Bangalore"
                className="bg-background/60 border-border"
              />
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-border">
          <Label htmlFor="filter-title-keywords">Job Title Keywords</Label>
          <p className="text-xs text-muted-foreground -mt-2">
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
            className="bg-background/60 border-border"
          />
          {filterTitleKeywords.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {filterTitleKeywords.map((keyword, index) => (
                <span
                  key={`${keyword}-${index}`}
                  className="inline-flex items-center gap-1 bg-emerald-500/20 px-2.5 py-1 text-xs text-emerald-400"
                >
                  {keyword}
                  <button
                    type="button"
                    onClick={() => onFilterTitleKeywordsChange(filterTitleKeywords.filter((_, i) => i !== index))}
                    className="p-0.5 hover:bg-emerald-500/30"
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
      <CardFooter className="flex items-center justify-between border-t border-border bg-card/70 px-6 py-4 rounded-b-xl">
        <p className="text-xs text-muted-foreground">
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
          className="bg-emerald-600 hover:bg-emerald-500 text-foreground min-w-[100px]"
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
