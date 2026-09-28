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

import type { DeviceSleepInhibitorLease } from "@/lib/scraper/runtime/device-sleep-inhibitor";

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
const WATCHDOG_INTERVAL_MS = 120 * 1000;
const BOOT_RECOVERY_MAX_CATCHUP = 50;
const KEEP_AWAKE_SETTING_KEY = "scraper_keep_device_awake";
const MISSED_RUN_REASON = "Skipped while device was asleep or idle; queued for a later recovery run.";

interface SchedulerRuntimeState {
  task: ScheduledTask | null;
  isRunning: boolean;
  currentCronExpression: string;
  missedExecutionHandler: ((context: TaskContext) => Promise<void>) | null;
  watchdogTimer: ReturnType<typeof setInterval> | null;
  persistentSleepLease: DeviceSleepInhibitorLease | null;
  bootRecoveryAttempted: boolean;
}

const globalSchedulerState = globalThis as typeof globalThis & {
  __switchySchedulerRuntime?: SchedulerRuntimeState;
};

const schedulerRuntime = globalSchedulerState.__switchySchedulerRuntime ??= {
  task: null,
  isRunning: false,
  currentCronExpression: DEFAULT_CRON,
  missedExecutionHandler: null,
  watchdogTimer: null,
  persistentSleepLease: null,
  bootRecoveryAttempted: false,
};

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
  /** True when the backend owns scheduling without requiring an open UI. */
  backendOwned: boolean;
  /** True when the server-side watchdog timer is active in this process. */
  watchdogActive: boolean;
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
    return CronExpressionParser.parse(schedulerRuntime.currentCronExpression, {
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

function isSchedulerTestWorker(): boolean {
  return Boolean(process.env.VITEST_WORKER_ID) || process.env.NODE_ENV === "test";
}

async function getKeepDeviceAwake(): Promise<boolean> {
  const value = await getSettingValue(KEEP_AWAKE_SETTING_KEY);
  return value === null ? true : value !== "false";
}

/**
 * Cron occurrences strictly after `fromExclusive` up to and including
 * `toInclusive`, capped so a long-offline device coalesces into one batch.
 */
export function listMissedOccurrences(
  cronExpression: string,
  fromExclusive: Date,
  toInclusive: Date,
  maxOccurrences = BOOT_RECOVERY_MAX_CATCHUP
): Date[] {
  const occurrences: Date[] = [];
  try {
    const interval = CronExpressionParser.parse(cronExpression, {
      currentDate: fromExclusive,
    });
    for (let index = 0; index < maxOccurrences; index += 1) {
      const next = interval.next().toDate();
      if (next.getTime() > toInclusive.getTime()) break;
      occurrences.push(next);
    }
  } catch (error) {
    console.error("[Scheduler] Failed to enumerate missed cron occurrences:", error);
  }
  return occurrences;
}

/**
 * Backend-owned catch-up: derive missed ticks from the persisted cron
 * expression, so recovery does not depend on an open browser tab.
 *
 * The baseline is the last successful run, or the latest already-tracked
 * miss when recovery is pending, so earlier misses are never double-counted
 * and later ones are still appended.
 */
export async function reconcileMissedRunsOnBoot(now = new Date()): Promise<{
  reconciled: number;
  pendingMissedCount: number;
}> {
  const [isEnabled, cronExpression, lastRun, recoveryState] = await Promise.all([
    getSchedulerEnabled(),
    getCronFromDB(),
    getLastRunFromDB(),
    getRecoveryState(),
  ]);

  if (!isEnabled) {
    return { reconciled: 0, pendingMissedCount: 0 };
  }
  const baseline = recoveryState.pendingMissedCount > 0 && recoveryState.latestMissedRun
    ? recoveryState.latestMissedRun
    : lastRun;
  if (!baseline || Number.isNaN(baseline.getTime()) || baseline.getTime() > now.getTime()) {
    return { reconciled: 0, pendingMissedCount: recoveryState.pendingMissedCount };
  }

  const missed = listMissedOccurrences(cronExpression, baseline, now);
  for (const occurrence of missed) {
    try {
      await recordMissedExecution(occurrence);
    } catch (error) {
      console.error("[Scheduler] Failed to persist boot-time missed execution:", error);
      break;
    }
  }

  const nextState = await getRecoveryState();
  if (missed.length > 0) {
    console.warn(
      `[Scheduler] Reconciled ${missed.length} missed run(s) since ${baseline.toISOString()} without UI involvement`
    );
  }
  return { reconciled: missed.length, pendingMissedCount: nextState.pendingMissedCount };
}

/**
 * Called when auto-scrape is turned off: drops pending recovery so a later
 * re-enable does not resurrect work from before the toggle.
 */
export async function handleSchedulerDisabled(): Promise<void> {
  await clearRecoveryState();
}

/**
 * Called when auto-scrape is turned on: restarts the baseline at now so ticks
 * from the disabled window are never backfilled as missed on the next boot.
 */
export async function handleSchedulerEnabled(now = new Date()): Promise<void> {
  await saveLastRun(now);
  await clearRecoveryState();
}

/**
 * Runs once per process boot: reconcile missed ticks, then execute a single
 * coalesced recovery batch. Safe to call repeatedly; reconciliation happens
 * only on the first call.
 */
export async function recoverSchedulerOnBoot(
  now = new Date(),
  requestId?: string
): Promise<SchedulerRecoveryResult> {
  if (!schedulerRuntime.bootRecoveryAttempted) {
    schedulerRuntime.bootRecoveryAttempted = true;
    try {
      await reconcileMissedRunsOnBoot(now);
    } catch (error) {
      console.error("[Scheduler] Boot reconciliation failed:", error);
    }
  }
  return recoverMissedSchedulerRuns(requestId ?? "boot");
}

/**
 * Server-side watchdog tick: keeps an enabled scheduler alive in-process and
 * drains pending recovery without any frontend involvement. Never throws.
 */
export async function runSchedulerWatchdogTick(requestId = "watchdog"): Promise<void> {
  try {
    const isEnabled = await getSchedulerEnabled();
    if (!isEnabled) {
      if (schedulerRuntime.task) stopScheduler();
      return;
    }
    if (!schedulerRuntime.task) {
      try {
        await startScheduler();
      } catch (error) {
        console.error("[Scheduler] Watchdog failed to restart scheduler:", error);
        return;
      }
    }
    if (schedulerRuntime.isRunning) return;
    const recoveryState = await getRecoveryState();
    if (recoveryState.pendingMissedCount <= 0) return;
    await recoverMissedSchedulerRuns(requestId);
  } catch (error) {
    console.error("[Scheduler] Watchdog tick failed:", error);
  }
}

export function ensureSchedulerWatchdog(): void {
  if (isSchedulerTestWorker()) return;
  if (schedulerRuntime.watchdogTimer) return;
  const timer = setInterval(() => {
    void runSchedulerWatchdogTick();
  }, WATCHDOG_INTERVAL_MS);
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
  schedulerRuntime.watchdogTimer = timer;
}

// Guards the persistent sleep assertion against overlapping ensure/release
// calls (startup vs settings refresh, or a toggle mid-acquisition) so a stale
// acquire can never overwrite or outlive the current settings.
let persistentSleepEpoch = 0;
let persistentSleepAcquireInFlight: Promise<DeviceSleepInhibitorLease | null> | null = null;

async function ensurePersistentSleepAssertion(): Promise<void> {
  if (isSchedulerTestWorker()) return;
  if (process.platform !== "darwin") return;
  if (schedulerRuntime.persistentSleepLease) return;
  if (persistentSleepAcquireInFlight) {
    await persistentSleepAcquireInFlight;
    return;
  }

  const epoch = persistentSleepEpoch;
  const acquisition = (async (): Promise<DeviceSleepInhibitorLease | null> => {
    try {
      const enabled = await getSchedulerEnabled();
      const keepAwake = await getKeepDeviceAwake();
      if (epoch !== persistentSleepEpoch || !enabled || !keepAwake) return null;
      const { CaffeinateDeviceSleepInhibitor } = await import(
        "@/lib/scraper/runtime/device-sleep-inhibitor"
      );
      const lease = await new CaffeinateDeviceSleepInhibitor().acquire();
      // Re-check after acquiring: a toggle that landed mid-acquisition must
      // release immediately instead of storing a stale assertion.
      const stillEnabled = await getSchedulerEnabled();
      const stillKeepAwake = await getKeepDeviceAwake();
      if (epoch !== persistentSleepEpoch || !stillEnabled || !stillKeepAwake) {
        try {
          await lease.release();
        } catch (releaseError) {
          console.warn("[Scheduler] Failed to release stale idle-sleep assertion:", releaseError);
        }
        return null;
      }
      schedulerRuntime.persistentSleepLease = lease;
      console.log("[Scheduler] Holding idle-sleep assertion while auto-scrape is enabled");
      return lease;
    } catch (error) {
      console.warn("[Scheduler] Failed to hold idle-sleep assertion:", error);
      return null;
    }
  })();
  persistentSleepAcquireInFlight = acquisition;
  try {
    await acquisition;
  } finally {
    if (persistentSleepAcquireInFlight === acquisition) {
      persistentSleepAcquireInFlight = null;
    }
  }
}

async function releasePersistentSleepAssertion(): Promise<void> {
  persistentSleepEpoch += 1;
  const inFlight = persistentSleepAcquireInFlight;
  persistentSleepAcquireInFlight = null;
  if (inFlight) {
    try {
      const lease = await inFlight;
      if (lease) await lease.release();
    } catch (error) {
      console.warn("[Scheduler] Failed to release in-flight idle-sleep assertion:", error);
    }
  }
  const lease = schedulerRuntime.persistentSleepLease;
  schedulerRuntime.persistentSleepLease = null;
  if (!lease) return;
  try {
    await lease.release();
  } catch (error) {
    console.warn("[Scheduler] Failed to release idle-sleep assertion:", error);
  }
}

/**
 * Re-applies the persistent idle-sleep assertion after settings changes.
 * Called by the settings service; never throws.
 */
export async function refreshSchedulerPersistentState(): Promise<void> {
  try {
    const enabled = await getSchedulerEnabled();
    if (!enabled) {
      await releasePersistentSleepAssertion();
      return;
    }
    const keepAwake = await getKeepDeviceAwake();
    if (!keepAwake) {
      await releasePersistentSleepAssertion();
      return;
    }
    await ensurePersistentSleepAssertion();
  } catch (error) {
    console.warn("[Scheduler] Failed to refresh persistent scheduler state:", error);
  }
}

export async function getSchedulerStatus(): Promise<SchedulerStatus> {
  const [lastRun, persistedCron, isEnabled, recoveryState] = await Promise.all([
    getLastRunFromDB(),
    getCronFromDB(),
    getSchedulerEnabled(),
    getRecoveryState(),
  ]);

  if (!isEnabled && schedulerRuntime.task) {
    stopScheduler();
  }

  if (isEnabled && !schedulerRuntime.task) {
    try {
      await startScheduler();
    } catch (error) {
      console.error("[Scheduler] Failed lazy-start while getting status:", error);
    }
  }

  ensureSchedulerWatchdog();

  const nextRun = isEnabled ? calculateNextRun(persistedCron) : null;

  return {
    isActive: isEnabled && schedulerRuntime.task !== null,
    isRunning: schedulerRuntime.isRunning,
    isEnabled,
    lastRun,
    nextRun,
    cronExpression: persistedCron,
    backendOwned: true,
    watchdogActive: schedulerRuntime.watchdogTimer !== null,
    ...recoveryState,
  };
}

async function handleMissedExecution(context: TaskContext): Promise<void> {
  if (!await getSchedulerEnabled()) {
    stopScheduler();
    logRuntimeEvent("scheduler", "scheduler_run_skipped", { code: "disabled" });
    return;
  }

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

  if (schedulerRuntime.task) {
    setSchedulerInitialization("ready");
    console.log("[Scheduler] Already running");
    return;
  }

  schedulerRuntime.currentCronExpression = await getCronFromDB();

  if (!cron.validate(schedulerRuntime.currentCronExpression)) {
    console.error(`[Scheduler] Invalid cron expression: ${schedulerRuntime.currentCronExpression}, using default`);
    schedulerRuntime.currentCronExpression = DEFAULT_CRON;
  }

  schedulerRuntime.task = cron.schedule(schedulerRuntime.currentCronExpression, async () => {
    await runScheduledRefresh();
  });
  schedulerRuntime.missedExecutionHandler = handleMissedExecution;
  schedulerRuntime.task.on("execution:missed", schedulerRuntime.missedExecutionHandler);
  setSchedulerInitialization("ready");
  ensureSchedulerWatchdog();
  void ensurePersistentSleepAssertion();

  console.log(`[Scheduler] Started with cron: ${schedulerRuntime.currentCronExpression}`);
}

export function stopScheduler(): void {
  if (schedulerRuntime.task) {
    if (schedulerRuntime.missedExecutionHandler) {
      schedulerRuntime.task.off("execution:missed", schedulerRuntime.missedExecutionHandler);
    }
    schedulerRuntime.task.stop();
    schedulerRuntime.task = null;
    schedulerRuntime.missedExecutionHandler = null;
    console.log("[Scheduler] Stopped");
  }
  void releasePersistentSleepAssertion();
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
  if (schedulerRuntime.isRunning) {
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

  schedulerRuntime.isRunning = true;
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

    const { reconcileMatchNotifications } = await import("@/lib/notifications/service");
    await reconcileMatchNotifications();

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
    schedulerRuntime.isRunning = false;
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
  if (!await getSchedulerEnabled()) {
    stopScheduler();
    logRuntimeEvent("scheduler", "scheduler_run_skipped", { code: "disabled" });
    return;
  }

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
