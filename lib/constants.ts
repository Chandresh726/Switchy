import releasePackageJson from "@/packages/cli/package.json";

export const APP_VERSION = releasePackageJson.version;
export const DB_PATH = process.env.NODE_ENV === "development"
  ? "~/.switchy/data/development/switchy.db"
  : "~/.switchy/data/production/switchy.db";

export const MAX_CSV_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_RESUME_FILE_SIZE = 5 * 1024 * 1024;
export const MAX_RESUME_TEXT_LENGTH = 60_000;

export { PLATFORM_OPTIONS, PLATFORM_COLORS } from "@/lib/companies/platforms";
import { PLATFORM_OPTIONS } from "@/lib/companies/platforms";

export const CUSTOM_SCRAPER_PLATFORMS = [
  "servicenow",
  "uber",
  "google",
  "atlassian",
  "rippling",
  "visa",
] as const;

const CUSTOM_SCRAPER_PLATFORM_SET = new Set(CUSTOM_SCRAPER_PLATFORMS);

export const COMPANY_FILTER_PLATFORM_OPTIONS = PLATFORM_OPTIONS.filter(
  (option) =>
    option.value === "custom" ||
    !CUSTOM_SCRAPER_PLATFORM_SET.has(
      option.value as (typeof CUSTOM_SCRAPER_PLATFORMS)[number]
    )
);

