import cron, { type ScheduledTask } from "node-cron";
import { CronExpressionParser } from "cron-parser";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { fetchJobsForAllCompanies } from "./fetcher";

const DEFAULT_CRON = "0 */6 * * *";

let schedulerTask: ScheduledTask | null = null;
let isRunning = false;
let currentCronExpression = DEFAULT_CRON;

export interface SchedulerStatus {
  isActive: boolean;
  isRunning: boolean;
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

  return {
    isActive: schedulerTask !== null,
    isRunning,
    lastRun,
    nextRun,
    cronExpression: currentCronExpression,
  };
}

export async function startScheduler(): Promise<void> {
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
    console.log("[Scheduler] Already running, skipping");
    return;
  }

  isRunning = true;
  const startTime = new Date();
  console.log("[Scheduler] Starting scheduled refresh");

  try {
    const result = await fetchJobsForAllCompanies("auto_scrape");

    await saveLastRun(startTime);
    console.log(
      `[Scheduler] Completed: ${result.summary.successfulCompanies}/${result.summary.totalCompanies} companies, ${result.summary.totalJobsAdded} jobs added`
    );
  } catch (error) {
    console.error("[Scheduler] Error during refresh:", error);
  } finally {
    isRunning = false;
  }
}
