import type { ScrapeQueueItem } from "@/lib/db/schema";

export function createScrapeQueueItem(
  overrides: Partial<ScrapeQueueItem> = {}
): ScrapeQueueItem {
  const now = new Date();
  return {
    id: "item-1",
    sessionId: "session-1",
    companyId: 1,
    status: "running",
    priority: 100,
    attemptCount: 1,
    maxAttempts: 3,
    availableAt: now,
    workerId: "worker",
    lockedAt: now,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    cancelRequested: false,
    lastError: null,
    resultJson: null,
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
