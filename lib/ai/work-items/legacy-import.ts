import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  aiWorkItems,
  matchLogs,
  matchSessions,
  scrapeMatchOutbox,
  scrapingLogs,
  type ScrapeMatchOutboxItem,
} from "@/lib/db/schema";

import { MatchWorkPayloadSchema } from "./contracts";

export function importLegacyMatchWork(database: typeof db = db): number {
  const legacy = database.select().from(scrapeMatchOutbox)
    .where(inArray(scrapeMatchOutbox.status, ["pending", "running"]))
    .all();
  let imported = 0;
  for (const item of legacy) {
    if (item.attemptCount >= item.maxAttempts) {
      failLegacyWork(
        database,
        item,
        "Legacy matcher work exhausted its retry attempts before migration."
      );
      continue;
    }
    let jobIds: number[];
    try {
      jobIds = MatchWorkPayloadSchema.shape.jobIds.parse(JSON.parse(item.jobIdsJson));
    } catch {
      failLegacyWork(
        database,
        item,
        "Legacy matcher work payload was invalid and could not be migrated."
      );
      continue;
    }

    imported += database.transaction((tx) => {
      const existing = tx.select({ id: aiWorkItems.id }).from(aiWorkItems)
        .where(eq(aiWorkItems.matchSessionId, item.id)).limit(1).get();
      if (!existing) {
        tx.insert(aiWorkItems).values({
          id: item.id,
          workType: "match_jobs",
          matchSessionId: item.id,
          scrapingLogId: item.scrapingLogId,
          companyId: item.companyId,
          payloadJson: JSON.stringify(MatchWorkPayloadSchema.parse({
            jobIds,
            triggerSource: "auto_match",
            companyId: item.companyId,
            scrapingLogId: item.scrapingLogId,
            legacyOutboxId: item.id,
          })),
          status: "queued",
          attemptCount: item.attemptCount,
          maxAttempts: item.maxAttempts,
          availableAt: item.availableAt,
          createdAt: item.createdAt,
          updatedAt: new Date(),
        }).run();
      }
      tx.update(matchSessions).set({ status: "queued" }).where(and(
        eq(matchSessions.id, item.id),
        inArray(matchSessions.status, ["queued", "in_progress"])
      )).run();
      tx.update(scrapeMatchOutbox).set({
        status: "migrated",
        workerId: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      }).where(eq(scrapeMatchOutbox.id, item.id)).run();
      return existing ? 0 : 1;
    }, { behavior: "immediate" });
  }
  return imported;
}

function failLegacyWork(
  database: typeof db,
  item: ScrapeMatchOutboxItem,
  safeMessage: string
): void {
  const now = new Date();
  database.transaction((tx) => {
    const session = tx.select({ jobsTotal: matchSessions.jobsTotal })
      .from(matchSessions).where(eq(matchSessions.id, item.id)).limit(1).get();
    const finalStatusByJob = new Map<number, string>();
    for (const row of tx.select({ jobId: matchLogs.jobId, status: matchLogs.status })
      .from(matchLogs).where(eq(matchLogs.sessionId, item.id))
      .orderBy(asc(matchLogs.id)).all()) {
      if (row.jobId !== null) finalStatusByJob.set(row.jobId, row.status);
    }
    const total = Math.max(0, session?.jobsTotal ?? finalStatusByJob.size);
    const succeeded = Math.min(
      total,
      Array.from(finalStatusByJob.values()).filter((status) => status === "success").length
    );
    const failed = total - succeeded;
    tx.update(scrapeMatchOutbox).set({
      status: "failed",
      workerId: null,
      leaseExpiresAt: null,
      lastError: safeMessage,
      completedAt: now,
      updatedAt: now,
    }).where(and(
      eq(scrapeMatchOutbox.id, item.id),
      inArray(scrapeMatchOutbox.status, ["pending", "running"])
    )).run();
    tx.update(matchSessions).set({
      status: "failed",
      jobsCompleted: total,
      jobsSucceeded: succeeded,
      jobsFailed: failed,
      errorCount: failed,
      completedAt: now,
    }).where(eq(matchSessions.id, item.id)).run();
    tx.update(scrapingLogs).set({
      matcherStatus: "failed",
      matcherJobsCompleted: total,
      matcherErrorCount: failed,
    }).where(eq(scrapingLogs.id, item.scrapingLogId)).run();
  }, { behavior: "immediate" });
}
