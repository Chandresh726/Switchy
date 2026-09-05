import { and, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import type { ScrapeSettingsProvider } from "@/lib/scraper/settings/provider";

export const STALE_ARCHIVABLE_JOB_STATUSES = [
  "new",
  "viewed",
  "interested",
  "rejected",
] as const;

const STALE_ARCHIVE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StaleJobArchiveResult {
  archived: number;
  cutoff: Date;
  days: number;
}

export interface StaleJobArchiveStore {
  archiveStaleJobs(cutoff: Date, now: Date): Promise<number> | number;
}

type StaleJobSettingsSource = Pick<
  ScrapeSettingsProvider,
  "getStaleJobArchiveDays"
>;

export class DrizzleStaleJobArchiveStore implements StaleJobArchiveStore {
  constructor(private readonly database: typeof db = db) {}

  async archiveStaleJobs(cutoff: Date, now: Date): Promise<number> {
    const archived = await this.database
      .update(jobs)
      .set({
        status: "archived",
        archivedAt: now,
        archiveSource: "stale",
        updatedAt: now,
      })
      .where(
        and(
          inArray(jobs.status, [...STALE_ARCHIVABLE_JOB_STATUSES]),
          or(
            lt(jobs.postedDate, cutoff),
            and(
              isNull(jobs.postedDate),
              isNotNull(jobs.discoveredAt),
              lt(jobs.discoveredAt, cutoff)
            )
          )
        )
      )
      .returning({ id: jobs.id });
    return archived.length;
  }
}

export class StaleJobArchivalService {
  private lastArchiveAt = 0;

  constructor(
    private readonly store: StaleJobArchiveStore,
    private readonly settingsProvider: StaleJobSettingsSource,
    private readonly now: () => Date = () => new Date()
  ) {}

  async archiveIfDue(): Promise<StaleJobArchiveResult | null> {
    const now = this.now();
    if (now.getTime() - this.lastArchiveAt < STALE_ARCHIVE_INTERVAL_MS)
      return null;
    try {
      const days = await this.settingsProvider.getStaleJobArchiveDays();
      if (!Number.isFinite(days) || days <= 0) return null;
      const cutoff = new Date(now.getTime() - days * DAY_MS);
      const archived = await this.store.archiveStaleJobs(cutoff, now);
      this.lastArchiveAt = now.getTime();
      if (archived > 0) {
        console.log(
          `[StaleJobArchivalService] Archived ${archived} job(s) older than ${cutoff.toISOString()} (${days}d)`
        );
      }
      return { archived, cutoff, days };
    } catch (error) {
      console.error("[StaleJobArchivalService] Failed to archive stale jobs:", error);
      return null;
    }
  }
}
