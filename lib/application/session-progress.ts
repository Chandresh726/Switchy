import { createHash } from "node:crypto";

import { count, eq, max, min, sum } from "drizzle-orm";

import { db } from "@/lib/db";
import { scrapeQueueItems, scrapeSessions } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/errors";

export async function getScrapeSessionProgress(sessionId: string) {
  const session = db.select().from(scrapeSessions).where(eq(scrapeSessions.id, sessionId)).get();
  if (!session) throw new NotFoundError("Session not found", "scrape_session_not_found");
  const buckets = db.select({
    status: scrapeQueueItems.status,
    total: count(),
    updatedAt: max(scrapeQueueItems.updatedAt),
    attempts: sum(scrapeQueueItems.attemptCount),
    availableAt: min(scrapeQueueItems.availableAt),
  }).from(scrapeQueueItems).where(eq(scrapeQueueItems.sessionId, sessionId)).groupBy(scrapeQueueItems.status).all();
  const active = buckets.filter((bucket) => bucket.status === "queued" || bucket.status === "running");
  const running = active.some((bucket) => bucket.status === "running");
  return {
    sessionId, status: session.status,
    total: session.companiesTotal ?? 0, completed: session.companiesCompleted ?? 0,
    revision: createHash("sha256").update(JSON.stringify([session, buckets])).digest("hex"),
    hasActiveWork: active.length > 0,
    nextAttemptAt: running ? null : active.find((bucket) => bucket.status === "queued")?.availableAt ?? null,
  };
}
