import cron, { type ScheduledTask, type TaskContext } from "node-cron";
import { CronExpressionParser } from "cron-parser";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { scrapeSessions, settings } from "@/lib/db/schema";
import {
  getLocalScrapeQueueService,
} from "@/lib/scraper";

import { getSchedulerLeaseStore } from "./scheduler-lease-store";

const DEFAULT_CRON = "0 */6 * * *";
const SCHEDULER_ENABLED_KEY = "scheduler_enabled";
const SCHEDULER_LAST_RUN_KEY = "scheduler.lastRun";
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
  const [pendingValue, missedCountValue, oldestValue, latestValue] = await Promise.all([
    getSettingValue(SCHEDULER_PENDING_RECOVERY_KEY),
    getSettingValue(SCHEDULER_MISSED_COUNT_KEY),
    getSettingValue(SCHEDULER_OLDEST_MISSED_RUN_KEY),
    getSettingValue(SCHEDULER_LATEST_MISSED_RUN_KEY),
  ]);

  return parseRecoveryState({
    [SCHEDULER_PENDING_RECOVERY_KEY]: pendingValue,
    [SCHEDULER_MISSED_COUNT_KEY]: missedCountValue,
    [SCHEDULER_OLDEST_MISSED_RUN_KEY]: oldestValue,
    [SCHEDULER_LATEST_MISSED_RUN_KEY]: latestValue,
  });
}

async function saveRecoveryState(state: SchedulerRecoveryState): Promise<void> {
  const updatedAt = new Date();
  const values = [
    [SCHEDULER_PENDING_RECOVERY_KEY, state.pendingMissedCount > 0 ? "true" : "false"],
    [SCHEDULER_MISSED_COUNT_KEY, String(state.pendingMissedCount)],
    [SCHEDULER_OLDEST_MISSED_RUN_KEY, state.oldestMissedRun?.toISOString() ?? null],
    [SCHEDULER_LATEST_MISSED_RUN_KEY, state.latestMissedRun?.toISOString() ?? null],
  ] as const;
  db.transaction((tx) => {
    for (const [key, value] of values) {
      tx.insert(settings).values({ key, value, updatedAt }).onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt },
      }).run();
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
    const keys = [
      SCHEDULER_PENDING_RECOVERY_KEY,
      SCHEDULER_MISSED_COUNT_KEY,
      SCHEDULER_OLDEST_MISSED_RUN_KEY,
      SCHEDULER_LATEST_MISSED_RUN_KEY,
    ];
    const persisted = Object.fromEntries(keys.map((key) => [
      key,
      tx.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()?.value ?? null,
    ]));
    const recoveryState = parseRecoveryState(persisted);
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
    const values = [
      [SCHEDULER_PENDING_RECOVERY_KEY, "true"],
      [SCHEDULER_MISSED_COUNT_KEY, String(nextState.pendingMissedCount)],
      [SCHEDULER_OLDEST_MISSED_RUN_KEY, nextState.oldestMissedRun?.toISOString() ?? null],
      [SCHEDULER_LATEST_MISSED_RUN_KEY, nextState.latestMissedRun?.toISOString() ?? null],
    ] as const;
    for (const [key, value] of values) {
      tx.insert(settings).values({ key, value, updatedAt }).onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt },
      }).run();
    }
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
    console.log("[Scheduler] Not enabled, skipping start");
    return;
  }

  if (schedulerTask) {
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

async function runSchedulerBatch(triggerSource: "scheduler" | "scheduler_recovery"): Promise<"started" | "already_running"> {
  if (isRunning) {
    console.log("[Scheduler] Already running (in-memory), skipping");
    return "already_running";
  }

  // Manual requests, startup recovery, and scheduled runs share one in-process
  // supervisor so the configured local concurrency limit applies to all work.
  const leaseStore = getSchedulerLeaseStore();
  const queueService = getLocalScrapeQueueService();
  const ownerId = `scheduler-${process.pid}-${crypto.randomUUID()}`;
  const lockToken = await leaseStore.acquire(ownerId);

  if (!lockToken) {
    console.log("[Scheduler] Another instance is running, skipping");
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
        console.error("[Scheduler] Lost scheduler lock while running; run will end without releasing lock token");
      } catch (error) {
        lockLost = true;
        activeLockToken = null;
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
  console.log(`[Scheduler] Starting ${triggerSource === "scheduler" ? "scheduled" : "recovery"} refresh`);

  try {
    const result = await queueService.scrapeAllCompanies(triggerSource);

    if (!lockLost) {
      await saveLastRun(startTime);
      await clearRecoveryState();
    } else {
      console.error("[Scheduler] Skipping state updates because lock ownership was lost");
    }

    console.log(
      `[Scheduler] Completed: ${result.summary.successfulCompanies}/${result.summary.totalCompanies} companies, ${result.summary.totalJobsAdded} jobs added`
    );
  } catch (error) {
    console.error("[Scheduler] Error during refresh:", error);
  } finally {
    clearInterval(refreshTimer);
    await refreshInFlight;
    isRunning = false;
    if (activeLockToken) {
      await leaseStore.release(activeLockToken);
    }
  }

  return "started";
}

export async function runScheduledRefresh(): Promise<void> {
  await runSchedulerBatch("scheduler");
}

export async function recoverMissedSchedulerRuns(): Promise<SchedulerRecoveryResult> {
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

  const status = await runSchedulerBatch("scheduler_recovery");
  const nextState = await getRecoveryState();

  return {
    status,
    ...nextState,
  };
}
