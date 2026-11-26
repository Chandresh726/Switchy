import { detectPlatformFromUrl } from "@/lib/scraper/platform-detection";
import { isPlatform, type Platform } from "@/lib/scraper/types/platform";

// These adapters hold a platform-wide execution lock. Limit leases as well as
// execution permits so waiters cannot occupy every local worker.
export const SERIAL_SCRAPE_PLATFORMS: readonly Platform[] = ["workday"];

export function getCompanyScrapePlatform(company: { platform: string | null; careersUrl: string }): Platform | "custom" {
  return company.platform && isPlatform(company.platform)
    ? company.platform : detectPlatformFromUrl(company.careersUrl);
}
