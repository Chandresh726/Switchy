import { BaseScraper, ScraperResult } from "./base-scraper";
import { GreenhouseScraper } from "./greenhouse";
import { LeverScraper } from "./lever";

class ScraperRegistry {
  private scrapers: BaseScraper[] = [];

  constructor() {
    // Register scrapers in order of priority
    this.register(new GreenhouseScraper());
    this.register(new LeverScraper());
  }

  register(scraper: BaseScraper): void {
    this.scrapers.push(scraper);
  }

  getScraperForUrl(url: string): BaseScraper | null {
    for (const scraper of this.scrapers) {
      if (scraper.validate(url)) {
        return scraper;
      }
    }
    return null;
  }

  async scrape(url: string, platform?: string): Promise<ScraperResult> {
    // If platform is specified, find that specific scraper
    if (platform) {
      const scraper = this.scrapers.find((s) => s.platform === platform);
      if (scraper) {
        return scraper.scrape(url);
      }
      return {
        success: false,
        jobs: [],
        error: `No scraper found for platform: ${platform}`,
      };
    }

    // Otherwise, auto-detect based on URL
    const scraper = this.getScraperForUrl(url);
    if (!scraper) {
      return {
        success: false,
        jobs: [],
        error: "No scraper found for this URL. Supported platforms: Greenhouse, Lever",
      };
    }

    return scraper.scrape(url);
  }

  getSupportedPlatforms(): string[] {
    return this.scrapers.map((s) => s.platform);
  }
}

export const scraperRegistry = new ScraperRegistry();
