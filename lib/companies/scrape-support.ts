import { detectPlatformFromUrl } from "@/lib/scraper/platform-detection";
import { isPlatform } from "@/lib/scraper/types";

function normalizePlatform(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function resolveCompanyScrapePlatform(
  careersUrl: string,
  platform: string | null | undefined
): string | null {
  const normalizedPlatform = normalizePlatform(platform);

  if (normalizedPlatform === "custom") {
    return null;
  }

  if (normalizedPlatform) {
    return normalizedPlatform;
  }

  const detectedPlatform = normalizePlatform(detectPlatformFromUrl(careersUrl));
  if (!detectedPlatform || detectedPlatform === "custom") {
    return null;
  }

  return detectedPlatform;
}

export function isCompanyScrapeSupported(
  careersUrl: string,
  platform: string | null | undefined
): boolean {
  const resolvedPlatform = resolveCompanyScrapePlatform(careersUrl, platform);
  return resolvedPlatform !== null && isPlatform(resolvedPlatform);
}
