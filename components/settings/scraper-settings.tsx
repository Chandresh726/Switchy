"use client";

import { useState } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Timer, Save, Loader2, X } from "lucide-react";

interface ScraperSettingsProps {
  globalScrapeFrequency: number;
  onGlobalScrapeFrequencyChange: (value: number) => void;
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
  globalScrapeFrequency,
  onGlobalScrapeFrequencyChange,
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
        <div className="flex items-center gap-2">
          <Timer className="h-5 w-5 text-emerald-500" />
          <CardTitle>Scraper Settings</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Frequency */}
        <div className="space-y-3">
          <Label htmlFor="scrape-frequency">Scrape Frequency</Label>
          <div className="flex items-center gap-4">
            <Input
              id="scrape-frequency"
              type="number"
              min={1}
              max={168}
              value={globalScrapeFrequency}
              onChange={(e) => onGlobalScrapeFrequencyChange(Math.min(168, Math.max(1, parseInt(e.target.value) || 6)))}
              className="bg-zinc-950/50 border-zinc-800 max-w-[100px]"
            />
            <span className="text-sm text-zinc-500">hours</span>
          </div>
        </div>

        {/* Location Filters */}
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

        {/* Job Title Keywords Filter */}
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
