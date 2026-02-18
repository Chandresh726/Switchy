import cron, { type ScheduledTask } from "node-cron";
import { CronExpressionParser } from "cron-parser";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getScrapingModule } from "@/lib/scraper";

const DEFAULT_CRON = "0 */6 * * *";
const SCHEDULER_ENABLED_KEY = "scheduler_enabled";

let schedulerTask: ScheduledTask | null = null;
let isRunning = false;
let currentCronExpression = DEFAULT_CRON;
let cachedEnabled: boolean | null = null;

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
  if (cachedEnabled !== null) {
    return cachedEnabled;
  }

  try {
    const result = await db
      .select()
      .from(settings)
      .where(eq(settings.key, SCHEDULER_ENABLED_KEY))
      .limit(1);

    if (result.length > 0 && result[0].value) {
      cachedEnabled = result[0].value === "true";
      return cachedEnabled;
    }
  } catch (error) {
    console.error("[Scheduler] Error fetching enabled from DB:", error);
  }
  return true;
}

export function clearSchedulerEnabledCache(): void {
  cachedEnabled = null;
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
  const nextRun = schedulerTask ? calculateNextRun(currentCronExpression) : null;
  const isEnabled = await getSchedulerEnabled();

  return {
    isActive: schedulerTask !== null,
    isRunning,
    isEnabled,
    lastRun,
    nextRun,
    cronExpression: currentCronExpression,
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

  const { orchestrator, repository } = getScrapingModule();

  if (!(await repository.acquireSchedulerLock())) {
    console.log("[Scheduler] Another instance is running, skipping");
    return;
  }

  isRunning = true;
  const startTime = new Date();
  console.log("[Scheduler] Starting scheduled refresh");

  try {
    const result = await orchestrator.scrapeAllCompanies("scheduler");

    await saveLastRun(startTime);
    console.log(
      `[Scheduler] Completed: ${result.summary.successfulCompanies}/${result.summary.totalCompanies} companies, ${result.summary.totalJobsAdded} jobs added`
    );
  } catch (error) {
    console.error("[Scheduler] Error during refresh:", error);
  } finally {
    isRunning = false;
    await repository.releaseSchedulerLock();
  }
}
