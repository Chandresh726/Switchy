"use client";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Timer, Save, Loader2 } from "lucide-react";

interface ScraperSectionProps {
  globalScrapeFrequency: number;
  onGlobalScrapeFrequencyChange: (value: number) => void;
  onSave: () => void;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  settingsSaved: boolean;
}

export function ScraperSection({
  globalScrapeFrequency,
  onGlobalScrapeFrequencyChange,
  onSave,
  isSaving,
  hasUnsavedChanges,
  settingsSaved,
}: ScraperSectionProps) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/50 rounded-xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Timer className="h-5 w-5 text-emerald-500" />
          <CardTitle>Scraper Schedule</CardTitle>
        </div>
        <CardDescription>
          Configure how often Switchy checks for new jobs
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label htmlFor="scrape-frequency">Global Scrape Frequency (hours)</Label>
          <div className="flex items-center gap-4">
            <Input
              id="scrape-frequency"
              type="number"
              min={1}
              max={168}
              value={globalScrapeFrequency}
              onChange={(e) => onGlobalScrapeFrequencyChange(Math.min(168, Math.max(1, parseInt(e.target.value) || 6)))}
              className="bg-zinc-950/50 border-zinc-800 max-w-[120px]"
            />
            <p className="text-sm text-zinc-400">
              Switchy will check all active companies for new jobs every {globalScrapeFrequency} hours.
            </p>
          </div>
          <p className="text-xs text-zinc-500">
            Set this between 1 and 168 hours (1 week). Default is 6 hours.
          </p>
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900/50 px-6 py-4 rounded-b-xl">
        <p className="text-xs text-zinc-500">
          {settingsSaved ? (
            <span className="flex items-center text-emerald-400 gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Changes saved successfully
            </span>
          ) : hasUnsavedChanges ? (
            <span className="text-yellow-400">Unsaved changes</span>
          ) : (
            "Settings are up to date"
          )}
        </p>
        <Button
          onClick={onSave}
          disabled={isSaving || !hasUnsavedChanges}
          className="bg-emerald-600 hover:bg-emerald-500 text-white min-w-[120px]"
        >
          {isSaving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </CardFooter>
    </Card>
  );
}
