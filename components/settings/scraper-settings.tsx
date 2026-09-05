"use client";

import { useMemo, useState } from "react";

import { Settings2, Timer, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

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
  keepDeviceAwake: boolean;
  onKeepDeviceAwakeChange: (value: boolean) => void;
  historyRetentionDays: number;
  onHistoryRetentionDaysChange: (value: number) => void;
  staleJobArchiveDays: number;
  onStaleJobArchiveDaysChange: (value: number) => void;
  filterCountry: string;
  filterCity: string;
  onFilterCountryChange: (value: string) => void;
  onFilterCityChange: (value: string) => void;
  filterTitleKeywords: string[];
  onFilterTitleKeywordsChange: (value: string[]) => void;
}

export function ScraperSettings({
  schedulerEnabled,
  onSchedulerEnabledChange,
  schedulerCron,
  onSchedulerCronChange,
  maxParallelScrapes,
  onMaxParallelScrapesChange,
  keepDeviceAwake,
  onKeepDeviceAwakeChange,
  historyRetentionDays,
  onHistoryRetentionDaysChange,
  staleJobArchiveDays,
  onStaleJobArchiveDaysChange,
  filterCountry,
  filterCity,
  onFilterCountryChange,
  onFilterCityChange,
  filterTitleKeywords,
  onFilterTitleKeywordsChange,
}: ScraperSettingsProps) {
  const [keywordInput, setKeywordInput] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
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
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <Label htmlFor="scheduler-frequency">Scheduler Frequency</Label>
          <div className="flex items-center gap-3">
            <Select
              value={selectedPreset}
              onValueChange={handlePresetChange}
            >
              <SelectTrigger
                id="scheduler-frequency"
                className="bg-background/60 border-border flex-1"
              >
                <SelectValue placeholder="Select schedule" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {CRON_PRESETS.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {showCustom && (
              <Input
                value={schedulerCron}
                onChange={(e) => onSchedulerCronChange(e.target.value)}
                aria-label="Custom cron expression"
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
            <div className="flex items-center gap-2">
              <Label htmlFor="scraper-keep-device-awake">
                Keep Mac awake while scraping
              </Label>
              <Badge variant="secondary">macOS</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Only while scrape work is active.
            </p>
          </div>
          <input
            type="checkbox"
            id="scraper-keep-device-awake"
            checked={keepDeviceAwake}
            onChange={(e) => onKeepDeviceAwakeChange(e.target.checked)}
            aria-label="Keep Mac awake while scraping"
            className="h-4 w-4 shrink-0 rounded border-border bg-muted text-emerald-500 focus:ring-emerald-500 focus:ring-offset-background"
          />
        </div>

        <div className="space-y-4 pt-4 border-t border-border">
          <div className="flex items-baseline justify-between gap-3">
            <Label>Location Filter</Label>
            <p className="text-xs text-muted-foreground">Remote jobs are always included.</p>
          </div>

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

        <Separator className="bg-muted" />

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Label className="text-base">Advanced</Label>
              <p className="text-xs text-muted-foreground">
                Tune throughput and retained run history.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-controls="advanced-scraper-settings"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((current) => !current)}
              className="h-8 text-xs text-muted-foreground hover:text-foreground"
            >
              <Settings2 data-icon="inline-start" />
              {showAdvanced ? "Hide advanced" : "Show advanced"}
            </Button>
          </div>

          {showAdvanced ? (
            <FieldGroup
              id="advanced-scraper-settings"
              className="grid gap-4 rounded-lg border border-border bg-background/30 p-4 sm:grid-cols-2"
            >
              <Field>
                <FieldLabel
                  htmlFor="max-parallel-scrapes"
                  className="text-xs text-muted-foreground"
                >
                  Max Parallel Scrapes
                </FieldLabel>
                <Input
                  id="max-parallel-scrapes"
                  type="number"
                  min={1}
                  max={10}
                  value={maxParallelScrapes}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value, 10);
                    onMaxParallelScrapesChange(
                      Math.min(
                        10,
                        Math.max(1, Number.isNaN(parsed) ? 1 : parsed)
                      )
                    );
                  }}
                  className="bg-background/60 border-border"
                />
                <FieldDescription>
                  1–10 concurrent scrapes.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel
                  htmlFor="scrape-history-retention"
                  className="text-xs text-muted-foreground"
                >
                  History Retention (days)
                </FieldLabel>
                <Input
                  id="scrape-history-retention"
                  type="number"
                  min={7}
                  max={3650}
                  value={historyRetentionDays}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value, 10);
                    onHistoryRetentionDaysChange(
                      Math.min(
                        3650,
                        Math.max(7, Number.isNaN(parsed) ? 7 : parsed)
                      )
                    );
                  }}
                  className="bg-background/60 border-border"
                />
                <FieldDescription>
                  Logs expire; jobs stay.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel
                  htmlFor="stale-job-archive-days"
                  className="text-xs text-muted-foreground"
                >
                  Stale Job Archive (days)
                </FieldLabel>
                <Input
                  id="stale-job-archive-days"
                  type="number"
                  min={7}
                  max={3650}
                  value={staleJobArchiveDays}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value, 10);
                    onStaleJobArchiveDaysChange(
                      Math.min(
                        3650,
                        Math.max(7, Number.isNaN(parsed) ? 7 : parsed)
                      )
                    );
                  }}
                  className="bg-background/60 border-border"
                />
                <FieldDescription>
                  Archive stale jobs; applied stays.
                </FieldDescription>
              </Field>
            </FieldGroup>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
