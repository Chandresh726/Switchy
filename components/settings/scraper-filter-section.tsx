"use client";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MapPin, Save, Loader2 } from "lucide-react";

interface ScraperFilterSectionProps {
  filterCountry: string;
  filterCity: string;
  onFilterCountryChange: (value: string) => void;
  onFilterCityChange: (value: string) => void;
  onSave: () => void;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  settingsSaved: boolean;
}

export function ScraperFilterSection({
  filterCountry,
  filterCity,
  onFilterCountryChange,
  onFilterCityChange,
  onSave,
  isSaving,
  hasUnsavedChanges,
  settingsSaved,
}: ScraperFilterSectionProps) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/50 rounded-xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-emerald-500" />
          <CardTitle>Scraper Filters</CardTitle>
        </div>
        <CardDescription>
          Filter jobs by location when scraping
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">
            Only jobs matching your preferred location will be added during scraping.
            Remote jobs are always included.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="filter-country">Filter Country</Label>
            <Input
              id="filter-country"
              value={filterCountry}
              onChange={(e) => onFilterCountryChange(e.target.value)}
              placeholder="e.g., India, United States"
              className="bg-zinc-950/50 border-zinc-800"
            />
            <p className="text-xs text-zinc-500">
              Default is India. Leave empty to disable country filtering.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="filter-city">Filter City</Label>
            <Input
              id="filter-city"
              value={filterCity}
              onChange={(e) => onFilterCityChange(e.target.value)}
              placeholder="e.g., Bangalore, San Francisco"
              className="bg-zinc-950/50 border-zinc-800"
            />
            <p className="text-xs text-zinc-500">
              Optional. Leave empty to match all cities in the selected country.
            </p>
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
