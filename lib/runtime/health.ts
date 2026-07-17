import { and, count, eq, lte, min } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  aiWorkItems,
  profile,
  scrapeMatchOutbox,
  scrapeQueueItems,
} from "@/lib/db/schema";

export type RuntimeInitializationState = "pending" | "ready" | "failed";
export type RuntimeSubsystem = "database" | "scheduler" | "queue" | "matcher";

interface RuntimeErrorState {
  subsystem: RuntimeSubsystem;
  code: string;
  at: string;
}

interface RuntimeHealthState {
  schedulerInitialization: RuntimeInitializationState;
  scrapeQueueRecovery: RuntimeInitializationState;
  matcherDispatchRecovery: RuntimeInitializationState;
  legacyMatchImportRecovery: RuntimeInitializationState;
  queueRecovery: RuntimeInitializationState;
  lastSuccessfulRecoveryAt: string | null;
  lastSuccessfulDispatchAt: string | null;
  lastError: RuntimeErrorState | null;
}

const initialState = (): RuntimeHealthState => ({
  schedulerInitialization: "pending",
  scrapeQueueRecovery: "pending",
  matcherDispatchRecovery: "pending",
  legacyMatchImportRecovery: "pending",
  queueRecovery: "pending",
  lastSuccessfulRecoveryAt: null,
  lastSuccessfulDispatchAt: null,
  lastError: null,
});

const globalState = globalThis as typeof globalThis & {
  __switchyRuntimeHealth?: RuntimeHealthState;
};

const state = globalState.__switchyRuntimeHealth ??= initialState();

export function setSchedulerInitialization(next: RuntimeInitializationState): void {
  state.schedulerInitialization = next;
}

function refreshQueueRecovery(): void {
  const previous = state.queueRecovery;
  if (
    state.scrapeQueueRecovery === "ready"
    && state.matcherDispatchRecovery === "ready"
    && state.legacyMatchImportRecovery === "ready"
  ) {
    state.queueRecovery = "ready";
  } else if (
    state.scrapeQueueRecovery === "failed"
    || state.matcherDispatchRecovery === "failed"
    || state.legacyMatchImportRecovery === "failed"
  ) {
    state.queueRecovery = "failed";
  } else {
    state.queueRecovery = "pending";
  }
  if (previous !== "ready" && state.queueRecovery === "ready") {
    state.lastSuccessfulRecoveryAt = new Date().toISOString();
  }
}

export function setScrapeQueueRecovery(next: RuntimeInitializationState): void {
  state.scrapeQueueRecovery = next;
  refreshQueueRecovery();
}

export function setMatcherDispatchRecovery(next: RuntimeInitializationState): void {
  state.matcherDispatchRecovery = next;
  refreshQueueRecovery();
}

export function setLegacyMatchImportRecovery(next: RuntimeInitializationState): void {
  state.legacyMatchImportRecovery = next;
  refreshQueueRecovery();
}

export function recordDispatchSuccess(): void {
  state.lastSuccessfulDispatchAt = new Date().toISOString();
}

export function recordRuntimeError(subsystem: RuntimeSubsystem, code: string): void {
  state.lastError = { subsystem, code, at: new Date().toISOString() };
}

export function resetRuntimeHealthForTests(): void {
  Object.assign(state, initialState());
}

export function logRuntimeEvent(
  subsystem: RuntimeSubsystem,
  event: string,
  identifiers: { requestId?: string; sessionId?: string; code?: string } = {}
): void {
  console.log(JSON.stringify({ event, subsystem, ...identifiers }));
}

async function databaseAvailable(): Promise<boolean> {
  try {
    await Promise.all([
      db.select({ id: profile.id }).from(profile).limit(1),
      db.select({ id: scrapeQueueItems.id }).from(scrapeQueueItems).limit(1),
      db.select({ id: scrapeMatchOutbox.id }).from(scrapeMatchOutbox).limit(1),
      db.select({ id: aiWorkItems.id }).from(aiWorkItems).limit(1),
    ]);
    return true;
  } catch {
    recordRuntimeError("database", "database_unavailable");
    return false;
  }
}

async function readQueueMetrics(now: Date) {
  const [scrapeOldest, outboxOldest, matcherOldest, scrapeExpired, outboxExpired, matcherExpired] = await Promise.all([
    db.select({ value: min(scrapeQueueItems.createdAt) }).from(scrapeQueueItems)
      .where(eq(scrapeQueueItems.status, "queued")),
    db.select({ value: min(scrapeMatchOutbox.createdAt) }).from(scrapeMatchOutbox)
      .where(eq(scrapeMatchOutbox.status, "pending")),
    db.select({ value: min(aiWorkItems.createdAt) }).from(aiWorkItems)
      .where(eq(aiWorkItems.status, "queued")),
    db.select({ value: count() }).from(scrapeQueueItems).where(and(
      eq(scrapeQueueItems.status, "running"),
      lte(scrapeQueueItems.leaseExpiresAt, now)
    )),
    db.select({ value: count() }).from(scrapeMatchOutbox).where(and(
      eq(scrapeMatchOutbox.status, "running"),
      lte(scrapeMatchOutbox.leaseExpiresAt, now)
    )),
    db.select({ value: count() }).from(aiWorkItems).where(and(
      eq(aiWorkItems.status, "running"),
      lte(aiWorkItems.leaseExpiresAt, now)
    )),
  ]);
  const oldestCandidates = [scrapeOldest[0]?.value, outboxOldest[0]?.value, matcherOldest[0]?.value]
    .filter((value): value is Date => value instanceof Date);
  const oldest = oldestCandidates.length > 0
    ? new Date(Math.min(...oldestCandidates.map((value) => value.getTime())))
    : null;
  return {
    oldestQueuedWorkAgeMs: oldest ? Math.max(0, now.getTime() - oldest.getTime()) : null,
    expiredLeaseCount: Number(scrapeExpired[0]?.value ?? 0)
      + Number(outboxExpired[0]?.value ?? 0)
      + Number(matcherExpired[0]?.value ?? 0),
  };
}

export async function getReadinessHealth() {
  const available = await databaseAvailable();
  const ready = available
    && state.schedulerInitialization === "ready"
    && state.queueRecovery === "ready";
  return {
    ready,
    databaseAvailable: available,
    schedulerInitialization: state.schedulerInitialization,
    queueRecovery: state.queueRecovery,
  };
}

export async function getRuntimeHealth() {
  const available = await databaseAvailable();
  let metrics = { oldestQueuedWorkAgeMs: null as number | null, expiredLeaseCount: 0 };
  if (available) {
    try {
      metrics = await readQueueMetrics(new Date());
    } catch {
      recordRuntimeError("database", "runtime_metrics_unavailable");
    }
  }
  return {
    databaseAvailable: available,
    schedulerInitialization: state.schedulerInitialization,
    queueRecovery: state.queueRecovery,
    lastSuccessfulRecoveryAt: state.lastSuccessfulRecoveryAt,
    lastSuccessfulDispatchAt: state.lastSuccessfulDispatchAt,
    ...metrics,
    lastError: state.lastError,
  };
}
