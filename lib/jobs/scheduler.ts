import cron, { type ScheduledTask, type TaskContext } from "node-cron";
import { CronExpressionParser } from "cron-parser";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { scrapeSessions, settings } from "@/lib/db/schema";
import {
  getLocalScrapeQueueService,
} from "@/lib/scraper";
import {
  logRuntimeEvent,
  recordRuntimeError,
  setSchedulerInitialization,
} from "@/lib/runtime/health";

import { getSchedulerLeaseStore } from "./scheduler-lease-store";

const DEFAULT_CRON = "0 */6 * * *";
const SCHEDULER_ENABLED_KEY = "scheduler_enabled";
const SCHEDULER_LAST_RUN_KEY = "scheduler.lastRun";
const SCHEDULER_RECOVERY_STATE_KEY = "scheduler.recovery.v1";
const SCHEDULER_PENDING_RECOVERY_KEY = "scheduler.pendingRecovery";
const SCHEDULER_MISSED_COUNT_KEY = "scheduler.missedCount";
const SCHEDULER_OLDEST_MISSED_RUN_KEY = "scheduler.oldestMissedRun";
const SCHEDULER_LATEST_MISSED_RUN_KEY = "scheduler.latestMissedRun";
const LOCK_REFRESH_INTERVAL_MS = 60 * 1000;
const MISSED_RUN_REASON = "Skipped while device was asleep or idle; queued for a later recovery run.";

let schedulerTask: ScheduledTask | null = null;
let isRunning = false;
let currentCronExpression = DEFAULT_CRON;

interface SchedulerRecoveryState {
  pendingMissedCount: number;
  oldestMissedRun: Date | null;
  latestMissedRun: Date | null;
}

interface PersistedSchedulerRecoveryState {
  version: 1;
  pendingMissedCount: number;
  oldestMissedRun: string | null;
  latestMissedRun: string | null;
}

const EMPTY_RECOVERY_STATE: SchedulerRecoveryState = {
  pendingMissedCount: 0,
  oldestMissedRun: null,
  latestMissedRun: null,
};

function serializeRecoveryState(state: SchedulerRecoveryState): string {
  return JSON.stringify({
    version: 1,
    pendingMissedCount: state.pendingMissedCount,
    oldestMissedRun: state.oldestMissedRun?.toISOString() ?? null,
    latestMissedRun: state.latestMissedRun?.toISOString() ?? null,
  } satisfies PersistedSchedulerRecoveryState);
}

function parseRecoveryRecord(value: string | null): SchedulerRecoveryState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PersistedSchedulerRecoveryState>;
    if (parsed.version !== 1 || !Number.isInteger(parsed.pendingMissedCount) || parsed.pendingMissedCount! < 0) {
      return null;
    }
    const oldestMissedRun = parsed.oldestMissedRun ? new Date(parsed.oldestMissedRun) : null;
    const latestMissedRun = parsed.latestMissedRun ? new Date(parsed.latestMissedRun) : null;
    if (oldestMissedRun && !Number.isFinite(oldestMissedRun.getTime())) return null;
    if (latestMissedRun && !Number.isFinite(latestMissedRun.getTime())) return null;
    if (parsed.pendingMissedCount === 0 && (oldestMissedRun || latestMissedRun)) return null;
    if (parsed.pendingMissedCount! > 0 && (!oldestMissedRun || !latestMissedRun)) return null;
    if (oldestMissedRun && latestMissedRun && oldestMissedRun > latestMissedRun) return null;
    return {
      pendingMissedCount: parsed.pendingMissedCount!,
      oldestMissedRun,
      latestMissedRun,
    };
  } catch {
    return null;
  }
}

function parseRecoveryState(values: Record<string, string | null>): SchedulerRecoveryState {
  const pendingValue = values[SCHEDULER_PENDING_RECOVERY_KEY];
  const missedCountValue = values[SCHEDULER_MISSED_COUNT_KEY];
  const oldestValue = values[SCHEDULER_OLDEST_MISSED_RUN_KEY];
  const latestValue = values[SCHEDULER_LATEST_MISSED_RUN_KEY];
  const pendingMissedCount = pendingValue === "true"
    ? Math.max(1, parseInt(missedCountValue ?? "1", 10) || 1)
    : Math.max(0, parseInt(missedCountValue ?? "0", 10) || 0);
  return {
    pendingMissedCount,
    oldestMissedRun: oldestValue ? new Date(oldestValue) : null,
    latestMissedRun: latestValue ? new Date(latestValue) : null,
  };
}

export interface SchedulerStatus extends SchedulerRecoveryState {
  isActive: boolean;
  isRunning: boolean;
  isEnabled: boolean;
  lastRun: Date | null;
  nextRun: Date | null;
  cronExpression: string;
}

export interface SchedulerRecoveryResult extends SchedulerRecoveryState {
  status: "started" | "already_running" | "not_needed" | "disabled";
}

async function getSettingValue(key: string): Promise<string | null> {
  try {
    const result = await db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);

    return result[0]?.value ?? null;
  } catch (error) {
    console.error(`[Scheduler] Error fetching setting ${key}:`, error);
    return null;
  }
}

async function getCronFromDB(): Promise<string> {
  const value = await getSettingValue("scheduler_cron");
  if (value) {
    const cronExpr = value.trim();
    if (cron.validate(cronExpr)) {
      return cronExpr;
    }
  }
  return DEFAULT_CRON;
}

async function getLastRunFromDB(): Promise<Date | null> {
  const value = await getSettingValue(SCHEDULER_LAST_RUN_KEY);
  return value ? new Date(value) : null;
}

async function getRecoveryState(): Promise<SchedulerRecoveryState> {
  const value = await getSettingValue(SCHEDULER_RECOVERY_STATE_KEY);
  if (!value) return EMPTY_RECOVERY_STATE;
  const parsed = parseRecoveryRecord(value);
  if (!parsed) throw new Error("Scheduler recovery state is invalid or unsupported");
  return parsed;
}

async function saveRecoveryState(state: SchedulerRecoveryState): Promise<void> {
  const updatedAt = new Date();
  await db.insert(settings).values({
    key: SCHEDULER_RECOVERY_STATE_KEY,
    value: serializeRecoveryState(state),
    updatedAt,
  }).onConflictDoUpdate({
    target: settings.key,
    set: { value: serializeRecoveryState(state), updatedAt },
  });
}

export function migrateSchedulerRecoveryState(): void {
  db.transaction((tx) => {
    const current = tx.select({ value: settings.value }).from(settings)
      .where(eq(settings.key, SCHEDULER_RECOVERY_STATE_KEY)).get()?.value ?? null;
    if (current) {
      let version: unknown;
      try {
        version = (JSON.parse(current) as { version?: unknown }).version;
      } catch {
        throw new Error("Scheduler recovery state is invalid");
      }
      if (version !== 1) {
        throw new Error("Scheduler recovery state version is unsupported");
      }
      if (!parseRecoveryRecord(current)) {
        throw new Error("Scheduler recovery state is invalid");
      }
    } else {
      const legacyKeys = [
        SCHEDULER_PENDING_RECOVERY_KEY,
        SCHEDULER_MISSED_COUNT_KEY,
        SCHEDULER_OLDEST_MISSED_RUN_KEY,
        SCHEDULER_LATEST_MISSED_RUN_KEY,
      ];
      const legacyValues = Object.fromEntries(legacyKeys.map((key) => [
        key,
        tx.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()?.value ?? null,
      ]));
      const migrated = parseRecoveryState(legacyValues);
      const serialized = serializeRecoveryState(migrated);
      if (!parseRecoveryRecord(serialized)) {
        throw new Error("Legacy scheduler recovery state is inconsistent");
      }
      const updatedAt = new Date();
      tx.insert(settings).values({
        key: SCHEDULER_RECOVERY_STATE_KEY,
        value: serialized,
        updatedAt,
      }).onConflictDoUpdate({
        target: settings.key,
        set: { value: serialized, updatedAt },
      }).run();
    }
    for (const key of [
      SCHEDULER_PENDING_RECOVERY_KEY,
      SCHEDULER_MISSED_COUNT_KEY,
      SCHEDULER_OLDEST_MISSED_RUN_KEY,
      SCHEDULER_LATEST_MISSED_RUN_KEY,
    ]) {
      tx.delete(settings).where(eq(settings.key, key)).run();
    }
  }, { behavior: "immediate" });
}

async function clearRecoveryState(): Promise<void> {
  await saveRecoveryState({
    pendingMissedCount: 0,
    oldestMissedRun: null,
    latestMissedRun: null,
  });
}

function inferMissedExecutionTime(context: TaskContext): Date {
  const emittedDate = context.date instanceof Date ? context.date : new Date(context.date);

  try {
    return CronExpressionParser.parse(currentCronExpression, {
      currentDate: emittedDate,
    }).prev().toDate();
  } catch (error) {
    console.error("[Scheduler] Failed to infer missed execution time from cron context:", error);
    return emittedDate;
  }
}

async function recordMissedExecution(scheduledFor: Date): Promise<void> {
  db.transaction((tx) => {
    const persisted = tx.select({ value: settings.value }).from(settings)
      .where(eq(settings.key, SCHEDULER_RECOVERY_STATE_KEY)).get()?.value ?? null;
    const recoveryState = parseRecoveryRecord(persisted) ?? EMPTY_RECOVERY_STATE;
    const nextState: SchedulerRecoveryState = {
      pendingMissedCount: recoveryState.pendingMissedCount + 1,
      oldestMissedRun: !recoveryState.oldestMissedRun || scheduledFor < recoveryState.oldestMissedRun
        ? scheduledFor
        : recoveryState.oldestMissedRun,
      latestMissedRun: !recoveryState.latestMissedRun || scheduledFor > recoveryState.latestMissedRun
        ? scheduledFor
        : recoveryState.latestMissedRun,
    };
    const updatedAt = new Date();
    tx.insert(settings).values({
      key: SCHEDULER_RECOVERY_STATE_KEY,
      value: serializeRecoveryState(nextState),
      updatedAt,
    }).onConflictDoUpdate({
      target: settings.key,
      set: { value: serializeRecoveryState(nextState), updatedAt },
    }).run();
    tx.insert(scrapeSessions).values({
      id: crypto.randomUUID(),
      triggerSource: "scheduler",
      status: "skipped",
      companiesTotal: 0,
      companiesCompleted: 0,
      totalJobsFound: 0,
      totalJobsAdded: 0,
      totalJobsFiltered: 0,
      totalJobsArchived: 0,
      skipReason: MISSED_RUN_REASON,
      scheduledForAt: scheduledFor,
      startedAt: scheduledFor,
      completedAt: scheduledFor,
    }).run();
  }, { behavior: "immediate" });
}

export async function getSchedulerEnabled(): Promise<boolean> {
  const value = await getSettingValue(SCHEDULER_ENABLED_KEY);
  return value ? value === "true" : true;
}

function calculateNextRun(cronExpr: string): Date | null {
  try {
    const interval = CronExpressionParser.parse(cronExpr);
    return interval.next().toDate();
  } catch {
    return null;
  }
}

export async function getSchedulerStatus(): Promise<SchedulerStatus> {
  const [lastRun, persistedCron, isEnabled, recoveryState] = await Promise.all([
    getLastRunFromDB(),
    getCronFromDB(),
    getSchedulerEnabled(),
    getRecoveryState(),
  ]);

  if (!isEnabled && schedulerTask) {
    stopScheduler();
  }

  if (isEnabled && !schedulerTask) {
    try {
      await startScheduler();
    } catch (error) {
      console.error("[Scheduler] Failed lazy-start while getting status:", error);
    }
  }

  const nextRun = isEnabled ? calculateNextRun(persistedCron) : null;

  return {
    isActive: isEnabled && schedulerTask !== null,
    isRunning,
    isEnabled,
    lastRun,
    nextRun,
    cronExpression: persistedCron,
    ...recoveryState,
  };
}

async function handleMissedExecution(context: TaskContext): Promise<void> {
  const scheduledFor = inferMissedExecutionTime(context);
  try {
    await recordMissedExecution(scheduledFor);
    console.warn(
      `[Scheduler] Missed scheduled execution for ${scheduledFor.toISOString()}; recovery marked pending`
    );
  } catch (error) {
    console.error("[Scheduler] Failed to persist missed execution:", error);
  }
}

export async function startScheduler(): Promise<void> {
  const isEnabled = await getSchedulerEnabled();
  if (!isEnabled) {
    setSchedulerInitialization("ready");
    console.log("[Scheduler] Not enabled, skipping start");
    return;
  }

  if (schedulerTask) {
    setSchedulerInitialization("ready");
    console.log("[Scheduler] Already running");
    return;
  }

  currentCronExpression = await getCronFromDB();

  if (!cron.validate(currentCronExpression)) {
    console.error(`[Scheduler] Invalid cron expression: ${currentCronExpression}, using default`);
    currentCronExpression = DEFAULT_CRON;
  }

  schedulerTask = cron.schedule(currentCronExpression, async () => {
    await runScheduledRefresh();
  });
  schedulerTask.on("execution:missed", handleMissedExecution);
  setSchedulerInitialization("ready");

  console.log(`[Scheduler] Started with cron: ${currentCronExpression}`);
}

export function stopScheduler(): void {
  if (schedulerTask) {
    schedulerTask.off("execution:missed", handleMissedExecution);
    schedulerTask.stop();
    schedulerTask = null;
    console.log("[Scheduler] Stopped");
  }
}

export async function restartScheduler(): Promise<void> {
  stopScheduler();
  await startScheduler();
}

async function saveLastRun(time: Date): Promise<void> {
  try {
    await db.insert(settings).values({
      key: SCHEDULER_LAST_RUN_KEY,
      value: time.toISOString(),
      updatedAt: time,
    }).onConflictDoUpdate({
      target: settings.key,
      set: { value: time.toISOString(), updatedAt: time },
    });
  } catch (error) {
    console.error("[Scheduler] Error saving lastRun:", error);
  }
}

async function runSchedulerBatch(
  triggerSource: "scheduler" | "scheduler_recovery",
  requestId?: string
): Promise<"started" | "already_running"> {
  const sessionId = crypto.randomUUID();
  if (isRunning) {
    logRuntimeEvent("scheduler", "scheduler_run_skipped", { requestId, sessionId, code: "already_running" });
    return "already_running";
  }

  // Manual requests, startup recovery, and scheduled runs share one in-process
  // supervisor so the configured local concurrency limit applies to all work.
  const leaseStore = getSchedulerLeaseStore();
  const queueService = getLocalScrapeQueueService();
  const ownerId = `scheduler-${process.pid}-${crypto.randomUUID()}`;
  let lockToken: string | null;
  try {
    lockToken = await leaseStore.acquire(ownerId);
  } catch (error) {
    recordRuntimeError("scheduler", "scheduler_lease_acquire_failed");
    logRuntimeEvent("scheduler", "scheduler_lease_acquire_failed", {
      requestId,
      sessionId,
      code: "scheduler_lease_acquire_failed",
    });
    throw error;
  }

  if (!lockToken) {
    logRuntimeEvent("scheduler", "scheduler_run_skipped", { requestId, sessionId, code: "lease_held" });
    return "already_running";
  }

  isRunning = true;
  let activeLockToken: string | null = lockToken;
  let lockLost = false;
  let refreshInFlight: Promise<void> | null = null;
  const refreshTimer = setInterval(() => {
    if (!activeLockToken || lockLost || refreshInFlight) {
      return;
    }

    const lockTokenToRefresh = activeLockToken;
    const refresh = (async () => {
      try {
        const refreshedToken = await leaseStore.refresh(lockTokenToRefresh);
        if (refreshedToken) return;
        lockLost = true;
        activeLockToken = null;
        recordRuntimeError("scheduler", "scheduler_lease_lost");
        logRuntimeEvent("scheduler", "scheduler_lease_lost", {
          requestId,
          sessionId,
          code: "scheduler_lease_lost",
        });
        console.error("[Scheduler] Lost scheduler lock while running; run will end without releasing lock token");
      } catch (error) {
        lockLost = true;
        activeLockToken = null;
        recordRuntimeError("scheduler", "scheduler_lease_refresh_failed");
        logRuntimeEvent("scheduler", "scheduler_lease_refresh_failed", {
          requestId,
          sessionId,
          code: "scheduler_lease_refresh_failed",
        });
        console.error("[Scheduler] Failed to refresh scheduler lock:", error);
      }
    })();
    refreshInFlight = refresh;
    void refresh.finally(() => {
      if (refreshInFlight === refresh) refreshInFlight = null;
    });
  }, LOCK_REFRESH_INTERVAL_MS);

  if (typeof refreshTimer === "object" && "unref" in refreshTimer) {
    refreshTimer.unref();
  }

  const startTime = new Date();
  logRuntimeEvent("scheduler", "scheduler_run_started", { requestId, sessionId });

  try {
    await queueService.scrapeAllCompanies(triggerSource);

    if (!lockLost) {
      await saveLastRun(startTime);
      await clearRecoveryState();
    } else {
      console.error("[Scheduler] Skipping state updates because lock ownership was lost");
    }

    logRuntimeEvent("scheduler", "scheduler_run_completed", { requestId, sessionId });
  } catch (error) {
    recordRuntimeError("scheduler", "scheduler_run_failed");
    logRuntimeEvent("scheduler", "scheduler_run_failed", { requestId, sessionId, code: "scheduler_run_failed" });
    console.error("[Scheduler] Error during refresh:", error);
  } finally {
    clearInterval(refreshTimer);
    await refreshInFlight;
    isRunning = false;
    if (activeLockToken) {
      try {
        await leaseStore.release(activeLockToken);
      } catch (error) {
        recordRuntimeError("scheduler", "scheduler_lease_release_failed");
        logRuntimeEvent("scheduler", "scheduler_lease_release_failed", {
          requestId,
          sessionId,
          code: "scheduler_lease_release_failed",
        });
        throw error;
      }
    }
  }

  return "started";
}

async function runScheduledRefresh(): Promise<void> {
  await runSchedulerBatch("scheduler");
}

export async function recoverMissedSchedulerRuns(requestId?: string): Promise<SchedulerRecoveryResult> {
  const isEnabled = await getSchedulerEnabled();
  const recoveryState = await getRecoveryState();

  if (!isEnabled) {
    return {
      status: "disabled",
      ...recoveryState,
    };
  }

  if (recoveryState.pendingMissedCount <= 0) {
    return {
      status: "not_needed",
      ...recoveryState,
    };
  }

  const status = await runSchedulerBatch("scheduler_recovery", requestId);
  const nextState = await getRecoveryState();

  return {
    status,
    ...nextState,
  };
}
