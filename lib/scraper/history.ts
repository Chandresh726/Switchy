import { and, eq, inArray, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  matchSessions,
  scrapeMatchOutbox,
  scrapeQueueItems,
  scrapeSessions,
  scrapingLogs,
} from "@/lib/db/schema";

export interface DeleteScrapeHistoryResult {
  active: boolean;
  deleted: number;
}

export function deleteScrapeHistory(
  sessionId?: string,
  database: typeof db = db
): DeleteScrapeHistoryResult {
  return database.transaction((tx) => {
    const sessionsToDelete = sessionId
      ? tx
          .select({ id: scrapeSessions.id, status: scrapeSessions.status })
          .from(scrapeSessions)
          .where(eq(scrapeSessions.id, sessionId))
          .all()
      : tx
          .select({ id: scrapeSessions.id, status: scrapeSessions.status })
          .from(scrapeSessions)
          .where(ne(scrapeSessions.status, "in_progress"))
          .all();
    if (sessionId && sessionsToDelete[0]?.status === "in_progress") {
      return { active: true, deleted: 0 };
    }
    const candidateSessionIds = sessionsToDelete.map((session) => session.id);
    if (candidateSessionIds.length === 0) {
      return { active: false, deleted: 0 };
    }
    const leasedSessionIds = new Set(
      tx
        .selectDistinct({ sessionId: scrapeQueueItems.sessionId })
        .from(scrapeQueueItems)
        .where(
          and(
            inArray(scrapeQueueItems.sessionId, candidateSessionIds),
            inArray(scrapeQueueItems.status, ["queued", "running"])
          )
        )
        .all()
        .map((item) => item.sessionId)
    );
    if (sessionId && leasedSessionIds.has(sessionId)) {
      return { active: true, deleted: 0 };
    }
    const sessionIds = candidateSessionIds.filter(
      (candidateId) => !leasedSessionIds.has(candidateId)
    );
    if (sessionIds.length === 0) return { active: false, deleted: 0 };

    const matchSessionIds = tx
      .select({ id: scrapeMatchOutbox.id })
      .from(scrapeMatchOutbox)
      .innerJoin(scrapingLogs, eq(scrapeMatchOutbox.scrapingLogId, scrapingLogs.id))
      .where(inArray(scrapingLogs.sessionId, sessionIds))
      .all()
      .map((row) => row.id);
    if (matchSessionIds.length > 0) {
      tx.delete(matchSessions)
        .where(inArray(matchSessions.id, matchSessionIds))
        .run();
    }

    const deleted = tx
      .delete(scrapeSessions)
      .where(inArray(scrapeSessions.id, sessionIds))
      .returning({ id: scrapeSessions.id })
      .all();
    return { active: false, deleted: deleted.length };
  }, { behavior: "immediate" });
}
