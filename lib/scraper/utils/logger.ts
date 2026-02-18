export interface FilterBreakdown {
  country?: number;
  city?: number;
  title?: number;
}

export class ScraperLogger {
  constructor(
    private readonly companyName: string,
    private readonly platform: string
  ) {}

  start(): void {
    console.log(`[Scraper] ${this.companyName} - Starting scrape (${this.platform})`);
  }

  fetched(count: number): void {
    console.log(`[Scraper] ${this.companyName} - Fetched ${count} jobs from API`);
  }

  browserBootstrapped(details: string): void {
    console.log(`[Scraper] ${this.companyName} - Bootstrapped browser session (${details})`);
  }

  fetchedWithEarlyFilter(total: number, breakdown: FilterBreakdown): void {
    const filterParts = this.formatFilterBreakdown(breakdown);
    if (filterParts) {
      console.log(`[Scraper] ${this.companyName} - Fetched ${total} jobs from API, early filtered: ${filterParts}`);
    } else {
      console.log(`[Scraper] ${this.companyName} - Fetched ${total} jobs from API`);
    }
  }

  filtered(breakdown: FilterBreakdown): void {
    const filterParts = this.formatFilterBreakdown(breakdown);
    if (filterParts) {
      console.log(`[Scraper] ${this.companyName} - Filtered: ${filterParts}`);
    }
  }

  added(added: number, duplicates: number): void {
    if (added === 0 && duplicates === 0) {
      console.log(`[Scraper] ${this.companyName} - No new jobs to add`);
    } else {
      console.log(`[Scraper] ${this.companyName} - Added ${added} jobs (${duplicates} duplicates)`);
    }
  }

  error(message: string): void {
    console.log(`[Scraper] ${this.companyName} - Error: ${message}`);
  }

  batchStart(count: number): void {
    console.log(`[Scraper] Batch scrape starting for ${count} companies`);
  }

  batchComplete(succeeded: number, total: number, jobsAdded: number): void {
    console.log(`[Scraper] Batch scrape complete: ${succeeded}/${total} succeeded, ${jobsAdded} jobs added`);
  }

  private formatFilterBreakdown(breakdown: FilterBreakdown): string {
    const parts: string[] = [];
    if (breakdown.country && breakdown.country > 0) parts.push(`country ${breakdown.country}`);
    if (breakdown.city && breakdown.city > 0) parts.push(`city ${breakdown.city}`);
    if (breakdown.title && breakdown.title > 0) parts.push(`title ${breakdown.title}`);
    return parts.join(", ");
  }
}
