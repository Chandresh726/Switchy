export const APP_VERSION = "0.5.0";
export const DB_PATH = process.env.NODE_ENV === "development" 
  ? "~/.switchy/dev/switchy.db" 
  : "~/.switchy/switchy.db";

export const MAX_CSV_FILE_SIZE = 10 * 1024 * 1024;

export const PLATFORM_OPTIONS = [
  { value: "greenhouse", label: "Greenhouse" },
  { value: "lever", label: "Lever" },
  { value: "ashby", label: "Ashby" },
  { value: "eightfold", label: "Eightfold" },
  { value: "workday", label: "Workday" },
  { value: "uber", label: "Uber" },
  { value: "google", label: "Google" },
  { value: "atlassian", label: "Atlassian" },
  { value: "rippling", label: "Rippling" },
  { value: "custom", label: "Custom" },
] as const;

export const CUSTOM_SCRAPER_PLATFORMS = [
  "uber",
  "google",
  "atlassian",
  "rippling",
  "nutanix",
] as const;

const CUSTOM_SCRAPER_PLATFORM_SET = new Set(CUSTOM_SCRAPER_PLATFORMS);

export const COMPANY_FILTER_PLATFORM_OPTIONS = PLATFORM_OPTIONS.filter(
  (option) =>
    option.value === "custom" ||
    !CUSTOM_SCRAPER_PLATFORM_SET.has(
      option.value as (typeof CUSTOM_SCRAPER_PLATFORMS)[number]
    )
);

export const PLATFORM_COLORS: Record<string, string> = {
  greenhouse: "border-green-500/30 bg-green-500/10 text-green-300",
  lever: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  ashby: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  eightfold: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  workday: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  uber: "border-neutral-400/30 bg-neutral-400/10 text-neutral-200",
  google: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  atlassian: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  rippling: "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
  nutanix: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  custom: "border-border bg-muted/40 text-muted-foreground",
};
