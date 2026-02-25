import cron, { type ScheduledTask } from "node-cron";
import { CronExpressionParser } from "cron-parser";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createScrapingModule } from "@/lib/scraper";

const DEFAULT_CRON = "0 */6 * * *";
const SCHEDULER_ENABLED_KEY = "scheduler_enabled";
const LOCK_REFRESH_INTERVAL_MS = 60 * 1000;

let schedulerTask: ScheduledTask | null = null;
let isRunning = false;
let currentCronExpression = DEFAULT_CRON;

export interface SchedulerStatus {
  isActive: boolean;
  isRunning: boolean;
  isEnabled: boolean;
  lastRun: Date | null;
  nextRun: Date | null;
  cronExpression: string;
}

async function getCronFromDB(): Promise<string> {
  try {
    const result = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "scheduler_cron"))
      .limit(1);

    if (result.length > 0 && result[0].value) {
      const cronExpr = result[0].value.trim();
      if (cron.validate(cronExpr)) {
        return cronExpr;
      }
    }
  } catch (error) {
    console.error("[Scheduler] Error fetching cron from DB:", error);
  }
  return DEFAULT_CRON;
}

async function getLastRunFromDB(): Promise<Date | null> {
  try {
    const result = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "scheduler.lastRun"))
      .limit(1);

    if (result.length > 0 && result[0].value) {
      return new Date(result[0].value);
    }
  } catch (error) {
    console.error("[Scheduler] Error fetching lastRun from DB:", error);
  }
  return null;
}

export async function getSchedulerEnabled(): Promise<boolean> {
  try {
    const result = await db
      .select()
      .from(settings)
      .where(eq(settings.key, SCHEDULER_ENABLED_KEY))
      .limit(1);

    if (result.length > 0 && result[0].value) {
      return result[0].value === "true";
    }
  } catch (error) {
    console.error("[Scheduler] Error fetching enabled from DB:", error);
  }
  return true;
}

export function clearSchedulerEnabledCache(): void {
  // No-op: keep function for compatibility with existing callers.
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
  const lastRun = await getLastRunFromDB();
  const persistedCron = await getCronFromDB();
  const isEnabled = await getSchedulerEnabled();
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
  };
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

  console.log(`[Scheduler] Started with cron: ${currentCronExpression}`);
}

export function stopScheduler(): void {
  if (schedulerTask) {
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
    await db
      .insert(settings)
      .values({
        key: "scheduler.lastRun",
        value: time.toISOString(),
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: time.toISOString(), updatedAt: time },
      });
  } catch (error) {
    console.error("[Scheduler] Error saving lastRun:", error);
  }
}

export async function runScheduledRefresh(): Promise<void> {
  if (isRunning) {
    console.log("[Scheduler] Already running (in-memory), skipping");
    return;
  }

  // Build a fresh scraping module per run to avoid stale in-memory registry state
  // in long-lived scheduler processes.
  const { orchestrator, repository } = createScrapingModule();
  const ownerId = `scheduler-${process.pid}-${crypto.randomUUID()}`;
  const lockToken = await repository.acquireSchedulerLock(ownerId);

  if (!lockToken) {
    console.log("[Scheduler] Another instance is running, skipping");
    return;
  }

  isRunning = true;
  let activeLockToken: string | null = lockToken;
  let lockLost = false;
  let refreshInFlight = false;
  const refreshTimer = setInterval(async () => {
    if (!activeLockToken || lockLost || refreshInFlight) {
      return;
    }

    refreshInFlight = true;
    try {
      const refreshedToken = await repository.refreshSchedulerLock(activeLockToken);
      if (!refreshedToken) {
        lockLost = true;
        activeLockToken = null;
        console.error("[Scheduler] Lost scheduler lock while running; run will end without releasing lock token");
      }
    } catch (error) {
      lockLost = true;
      activeLockToken = null;
      console.error("[Scheduler] Failed to refresh scheduler lock:", error);
    } finally {
      refreshInFlight = false;
    }
  }, LOCK_REFRESH_INTERVAL_MS);
  if (typeof refreshTimer === "object" && "unref" in refreshTimer) {
    refreshTimer.unref();
  }

  const startTime = new Date();
  console.log("[Scheduler] Starting scheduled refresh");

  try {
    const result = await orchestrator.scrapeAllCompanies("scheduler");

    if (!lockLost) {
      await saveLastRun(startTime);
    } else {
      console.error("[Scheduler] Skipping lastRun update because lock ownership was lost");
    }

    console.log(
      `[Scheduler] Completed: ${result.summary.successfulCompanies}/${result.summary.totalCompanies} companies, ${result.summary.totalJobsAdded} jobs added`
    );
  } catch (error) {
    console.error("[Scheduler] Error during refresh:", error);
  } finally {
    clearInterval(refreshTimer);
    isRunning = false;
    if (activeLockToken) {
      await repository.releaseSchedulerLock(activeLockToken);
    }
  }
}
