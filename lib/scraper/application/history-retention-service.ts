import type {
  PruneScrapeHistoryResult,
  ScrapeHistoryRetentionStore,
} from "@/lib/scraper/history";
import type { ScrapeSettingsProvider } from "@/lib/scraper/settings/provider";

const HISTORY_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export class HistoryRetentionService {
  private lastPruneAt = 0;

  constructor(
    private readonly store: ScrapeHistoryRetentionStore,
    private readonly settingsProvider: ScrapeSettingsProvider,
    private readonly now: () => Date = () => new Date()
  ) {}

  async pruneIfDue(): Promise<PruneScrapeHistoryResult | null> {
    const now = this.now();
    if (now.getTime() - this.lastPruneAt < HISTORY_PRUNE_INTERVAL_MS) return null;
    try {
      const retentionDays = await this.settingsProvider.getHistoryRetentionDays();
      const result = this.store.prune(retentionDays, now);
      this.lastPruneAt = now.getTime();
      if (result.deleted > 0) {
        console.log(
          `[HistoryRetentionService] Pruned ${result.deleted} scrape history session(s) older than ${result.cutoff.toISOString()}`
        );
      }
      return result;
    } catch (error) {
      console.error("[HistoryRetentionService] Failed to prune scrape history:", error);
      return null;
    }
  }
}
