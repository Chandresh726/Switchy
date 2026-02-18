import type { Platform } from "@/lib/scraper/types";
import type { IScraper, ScraperResult, ScrapeOptions } from "@/lib/scraper/core/types";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import type { IBrowserClient } from "@/lib/scraper/infrastructure/browser-client";

import {
  GreenhouseScraper,
  LeverScraper,
  AshbyScraper,
  EightfoldScraper,
  WorkdayScraper,
} from "@/lib/scraper/platforms";

export interface IScraperRegistry {
  register(scraper: IScraper): void;
  getScraperForUrl(url: string): IScraper | null;
  getScraperByPlatform(platform: Platform): IScraper | null;
  scrape(url: string, platform?: Platform, options?: ScrapeOptions): Promise<ScraperResult>;
  getSupportedPlatforms(): Platform[];
}

export class ScraperRegistry implements IScraperRegistry {
  private readonly scrapers: Map<Platform, IScraper> = new Map();

  register(scraper: IScraper): void {
    this.scrapers.set(scraper.platform, scraper);
  }

  getScraperForUrl(url: string): IScraper | null {
    for (const scraper of this.scrapers.values()) {
      if (scraper.validate(url)) {
        return scraper;
      }
    }
    return null;
  }

  getScraperByPlatform(platform: Platform): IScraper | null {
    return this.scrapers.get(platform) ?? null;
  }

  async scrape(url: string, platform?: Platform, options?: ScrapeOptions): Promise<ScraperResult> {
    if (platform) {
      const scraper = this.getScraperByPlatform(platform);
      if (scraper) {
        return scraper.scrape(url, options);
      }
      return {
        success: false,
        jobs: [],
        error: `No scraper found for platform: ${platform}`,
      };
    }

    const scraper = this.getScraperForUrl(url);
    if (!scraper) {
      const supportedPlatforms = this.getSupportedPlatforms().join(", ");
      return {
        success: false,
        jobs: [],
        error: `No scraper found for this URL. Supported platforms: ${supportedPlatforms}`,
      };
    }

    return scraper.scrape(url, options);
  }

  getSupportedPlatforms(): Platform[] {
    return Array.from(this.scrapers.keys());
  }
}

export interface ScraperRegistryConfig {
  httpClient: IHttpClient;
  browserClient: IBrowserClient;
}

export function createScraperRegistry(config: ScraperRegistryConfig): IScraperRegistry {
  const registry = new ScraperRegistry();

  registry.register(new GreenhouseScraper(config.httpClient));
  registry.register(new LeverScraper(config.httpClient));
  registry.register(new AshbyScraper(config.httpClient));
  registry.register(new EightfoldScraper(config.httpClient, config.browserClient));
  registry.register(new WorkdayScraper(config.httpClient, config.browserClient));

  return registry;
}
