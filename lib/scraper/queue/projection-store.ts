import { and, asc, eq, inArray, or } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  companies,
  scrapeQueueItems,
  scrapeSessions,
  scrapingLogs,
} from "@/lib/db/schema";

import {
  createFetchResultFromCommittedScrape,
  serializeFetchResult,
  type CommittedScrapeResult,
} from "./fetch-result-persistence";

export interface ScrapeSessionSnapshot {
  triggerSource: string;
  status: string;
  startedAt: Date | null;
}

export interface ScrapeSessionProjectionStore {
  getSession(sessionId: string): Promise<ScrapeSessionSnapshot | null>;
  listInProgressSessionIds(): Promise<string[]>;
  getCommittedResult(
    sessionId: string,
    companyId: number
  ): Promise<CommittedScrapeResult | null>;
  recoverCommittedQueueItems(): Promise<number>;
}

export class DrizzleScrapeSessionProjectionStore
  implements ScrapeSessionProjectionStore
{
  constructor(private readonly database: typeof db = db) {}

  async getSession(sessionId: string): Promise<ScrapeSessionSnapshot | null> {
    return (
      this.database
        .select({
          triggerSource: scrapeSessions.triggerSource,
          status: scrapeSessions.status,
          startedAt: scrapeSessions.startedAt,
        })
        .from(scrapeSessions)
        .where(eq(scrapeSessions.id, sessionId))
        .limit(1)
        .get() ?? null
    );
  }

  async listInProgressSessionIds(): Promise<string[]> {
    const sessions = await this.database
      .selectDistinct({ id: scrapeSessions.id })
      .from(scrapeSessions)
      .innerJoin(
        scrapeQueueItems,
        eq(scrapeQueueItems.sessionId, scrapeSessions.id)
      )
      .where(eq(scrapeSessions.status, "in_progress"));
    return sessions.map((session) => session.id);
  }

  async getCommittedResult(
    sessionId: string,
    companyId: number
  ): Promise<CommittedScrapeResult | null> {
    const committed = await this.database
      .select({
        companyId: scrapingLogs.companyId,
        companyName: companies.name,
        logId: scrapingLogs.id,
        status: scrapingLogs.status,
        jobsFound: scrapingLogs.jobsFound,
        jobsAdded: scrapingLogs.jobsAdded,
        jobsUpdated: scrapingLogs.jobsUpdated,
        jobsFiltered: scrapingLogs.jobsFiltered,
        jobsArchived: scrapingLogs.jobsArchived,
        platform: scrapingLogs.platform,
        duration: scrapingLogs.duration,
        errorMessage: scrapingLogs.errorMessage,
      })
      .from(scrapingLogs)
      .leftJoin(companies, eq(companies.id, scrapingLogs.companyId))
      .where(
        and(
          eq(scrapingLogs.sessionId, sessionId),
          eq(scrapingLogs.companyId, companyId),
          or(
            eq(scrapingLogs.status, "success"),
            eq(scrapingLogs.status, "partial")
          )
        )
      )
      .orderBy(asc(scrapingLogs.id))
      .limit(1)
      .get();
    return committed
      ? this.toCommittedResult({ ...committed, companyId })
      : null;
  }

  async recoverCommittedQueueItems(): Promise<number> {
    return this.database.transaction(
      (tx) => {
        const committedRows = tx
          .select({
            itemId: scrapeQueueItems.id,
            companyId: scrapeQueueItems.companyId,
            companyName: companies.name,
            logId: scrapingLogs.id,
            status: scrapingLogs.status,
            jobsFound: scrapingLogs.jobsFound,
            jobsAdded: scrapingLogs.jobsAdded,
            jobsUpdated: scrapingLogs.jobsUpdated,
            jobsFiltered: scrapingLogs.jobsFiltered,
            jobsArchived: scrapingLogs.jobsArchived,
            platform: scrapingLogs.platform,
            duration: scrapingLogs.duration,
            errorMessage: scrapingLogs.errorMessage,
          })
          .from(scrapeQueueItems)
          .innerJoin(
            scrapeSessions,
            eq(scrapeSessions.id, scrapeQueueItems.sessionId)
          )
          .innerJoin(
            scrapingLogs,
            and(
              eq(scrapingLogs.sessionId, scrapeQueueItems.sessionId),
              eq(scrapingLogs.companyId, scrapeQueueItems.companyId)
            )
          )
          .leftJoin(companies, eq(companies.id, scrapeQueueItems.companyId))
          .where(
            and(
              inArray(scrapeQueueItems.status, ["queued", "running"]),
              eq(scrapeQueueItems.cancelRequested, false),
              eq(scrapeSessions.status, "in_progress"),
              or(
                eq(scrapingLogs.status, "success"),
                eq(scrapingLogs.status, "partial")
              )
            )
          )
          .orderBy(asc(scrapingLogs.id))
          .all();
        const earliestByItem = new Map<string, (typeof committedRows)[number]>();
        for (const row of committedRows) {
          if (!earliestByItem.has(row.itemId)) earliestByItem.set(row.itemId, row);
        }

        let recovered = 0;
        const completedAt = new Date();
        for (const row of earliestByItem.values()) {
          const resultJson = serializeFetchResult(
            createFetchResultFromCommittedScrape(this.toCommittedResult(row))
          );
          const updated = tx
            .update(scrapeQueueItems)
            .set({
              status: "completed",
              resultJson,
              workerId: null,
              lockedAt: null,
              leaseExpiresAt: null,
              completedAt,
              updatedAt: completedAt,
            })
            .where(
              and(
                eq(scrapeQueueItems.id, row.itemId),
                inArray(scrapeQueueItems.status, ["queued", "running"]),
                eq(scrapeQueueItems.cancelRequested, false)
              )
            )
            .returning({ id: scrapeQueueItems.id })
            .all();
          recovered += updated.length;
        }
        return recovered;
      },
      { behavior: "immediate" }
    );
  }

  private toCommittedResult(row: {
    companyId: number;
    companyName: string | null;
    logId: number;
    status: string;
    jobsFound: number | null;
    jobsAdded: number | null;
    jobsUpdated: number | null;
    jobsFiltered: number | null;
    jobsArchived: number | null;
    platform: string | null;
    duration: number | null;
    errorMessage: string | null;
  }): CommittedScrapeResult {
    return {
      ...row,
      status: row.status === "success" ? "success" : "partial",
    };
  }
}
