import cron, { type ScheduledTask } from "node-cron";
import { db } from "@/lib/db";
import { companies, settings } from "@/lib/db/schema";
import { eq, lte, and } from "drizzle-orm";
import { fetchJobsForCompany } from "./fetcher";

let schedulerTask: ScheduledTask | null = null;
let isRunning = false;
let schedulerStarting = false;

const DEFAULT_FREQUENCY_HOURS = 6;

let currentCronExpression = generateCronExpression(DEFAULT_FREQUENCY_HOURS);
let currentFrequencyHours = DEFAULT_FREQUENCY_HOURS;

// Track last run and next scheduled run times
let lastRunTime: Date | null = null;
let nextScheduledRun: Date | null = null;

export interface SchedulerStatus {
  isActive: boolean;
  lastRun: Date | null;
  nextRun: Date | null;
  frequencyHours: number;
  cronExpression: string;
}

export async function getSchedulerStatus(): Promise<SchedulerStatus> {
  // Try to get last run from database
  try {
    const lastRunSetting = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "scheduler.lastRun"))
      .limit(1);

    if (lastRunSetting.length > 0 && lastRunSetting[0].value) {
      lastRunTime = new Date(lastRunSetting[0].value);
    }
  } catch (error) {
    console.error("[Scheduler] Error fetching last run:", error);
  }

  // Calculate next run based on last run + frequency, or from now if no last run
  if (lastRunTime && currentFrequencyHours > 0) {
    nextScheduledRun = new Date(lastRunTime.getTime() + currentFrequencyHours * 60 * 60 * 1000);
  } else if (!lastRunTime && schedulerTask !== null && currentFrequencyHours > 0) {
    // If scheduler is active but no last run yet, calculate from now
    nextScheduledRun = new Date(Date.now() + currentFrequencyHours * 60 * 60 * 1000);
  }

  return {
    isActive: schedulerTask !== null,
    lastRun: lastRunTime,
    nextRun: nextScheduledRun,
    frequencyHours: currentFrequencyHours,
    cronExpression: currentCronExpression,
  };
}

// Generate cron expression based on frequency hours
function generateCronExpression(frequencyHours: number): string {
  if (!Number.isFinite(frequencyHours) || frequencyHours <= 0) {
    frequencyHours = DEFAULT_FREQUENCY_HOURS;
  }
  
  // For frequencies <= 24 hours, run at appropriate intervals
  // For frequencies > 24 hours, run daily at a specific time
  if (frequencyHours <= 24) {
    // Run every N hours (e.g., every 6 hours: "0 */6 * * *")
    return `0 */${frequencyHours} * * *`;
  } else {
    // For longer frequencies (e.g., 48 hours), run daily at midnight
    // The scheduled refresh logic will check if enough time has passed
    return "0 0 * * *";
  }
}

async function getScrapeFrequencyFromDB(): Promise<number> {
  try {
    const frequencySetting = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "global_scrape_frequency"))
      .limit(1);

    if (frequencySetting.length > 0 && frequencySetting[0].value) {
      const parsed = parseInt(frequencySetting[0].value.trim(), 10);
      // Validate: must be a finite positive integer
      if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return DEFAULT_FREQUENCY_HOURS;
  } catch (error) {
    console.error("[Scheduler] Error fetching frequency:", error);
    return DEFAULT_FREQUENCY_HOURS;
  }
}

export async function startScheduler(): Promise<void> {
  // Guard against concurrent start attempts
  if (schedulerStarting) {
    console.log("[Scheduler] Start already in progress");
    return;
  }
  
  if (schedulerTask) {
    console.log("[Scheduler] Already running");
    return;
  }

  schedulerStarting = true;

  try {
    // Get frequency from DB and generate appropriate cron
    currentFrequencyHours = await getScrapeFrequencyFromDB();
    currentCronExpression = generateCronExpression(currentFrequencyHours);

    schedulerTask = cron.schedule(currentCronExpression, async () => {
      await runScheduledRefresh();
    });

    // Calculate initial next run
    const status = await getSchedulerStatus();
    nextScheduledRun = status.nextRun;

    console.log(`[Scheduler] Started with cron: ${currentCronExpression} (every ${currentFrequencyHours} hours)`);
  } catch (error) {
    console.error("[Scheduler] Failed to start:", error);
    // Clear the guard on error so future starts are allowed
    schedulerStarting = false;
    throw error;
  } finally {
    schedulerStarting = false;
  }
}

export async function restartScheduler(): Promise<void> {
  console.log("[Scheduler] Restarting...");
  stopScheduler();
  // await startScheduler so the guard is respected
  await startScheduler();
  console.log("[Scheduler] Restarted successfully");
}

export function stopScheduler(): void {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    console.log("[Scheduler] Stopped");
  }
}

export async function runScheduledRefresh(): Promise<void> {
  if (isRunning) {
    console.log("[Scheduler] Refresh already in progress, skipping");
    return;
  }

  isRunning = true;
  console.log("[Scheduler] Starting scheduled refresh");

  try {
    // Get global scrape frequency from settings
    const frequencySetting = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "global_scrape_frequency"))
      .limit(1);

    const scrapeFrequencyHours = frequencySetting.length > 0
      ? parseInt(frequencySetting[0].value || "6", 10)
      : 6;

    console.log(`[Scheduler] Using global scrape frequency: ${scrapeFrequencyHours} hours`);

    // Find companies that need refreshing based on global schedule
    const now = new Date();
    const companiesNeedingRefresh = await db
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.isActive, true),
          // Companies with no lastScrapedAt OR where enough time has passed
          lte(
            companies.lastScrapedAt,
            new Date(now.getTime() - scrapeFrequencyHours * 60 * 60 * 1000)
          )
        )
      );

    // Also include companies never scraped
    const neverScraped = await db
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.isActive, true),
          eq(companies.lastScrapedAt, null as unknown as Date)
        )
      );

    const allCompanies = [...companiesNeedingRefresh, ...neverScraped];
    const uniqueCompanies = Array.from(
      new Map(allCompanies.map((c) => [c.id, c])).values()
    );

    console.log(`[Scheduler] Found ${uniqueCompanies.length} companies to refresh`);

    let successCount = 0;
    let failCount = 0;
    let totalJobsAdded = 0;

    for (const company of uniqueCompanies) {
      try {
        const result = await fetchJobsForCompany(company.id);
        if (result.success) {
          successCount++;
          totalJobsAdded += result.jobsAdded;
          console.log(
            `[Scheduler] ${company.name}: Found ${result.jobsFound} jobs, added ${result.jobsAdded}`
          );
        } else {
          failCount++;
          console.error(`[Scheduler] ${company.name}: Failed - ${result.error}`);
        }
      } catch (error) {
        failCount++;
        console.error(`[Scheduler] ${company.name}: Exception -`, error);
      }

      // Add a small delay between companies to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Update last run time and calculate next run
    lastRunTime = now;
    nextScheduledRun = new Date(now.getTime() + scrapeFrequencyHours * 60 * 60 * 1000);
    currentFrequencyHours = scrapeFrequencyHours;
    await db
      .insert(settings)
      .values({
        key: "scheduler.lastRun",
        value: now.toISOString(),
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: now.toISOString(), updatedAt: now },
      });

    console.log(
      `[Scheduler] Completed: ${successCount} success, ${failCount} failed, ${totalJobsAdded} jobs added`
    );
  } catch (error) {
    console.error("[Scheduler] Error during refresh:", error);
  } finally {
    isRunning = false;
  }
}

// Export for API usage
export async function triggerManualRefresh(): Promise<{
  started: boolean;
  message: string;
}> {
  if (isRunning) {
    return { started: false, message: "Refresh already in progress" };
  }

  // Don't await - let it run in background
  runScheduledRefresh()
    .then(() => {
      // Update timing variables only after successful completion
      const now = new Date();
      lastRunTime = now;
      nextScheduledRun = new Date(now.getTime() + currentFrequencyHours * 60 * 60 * 1000);
    })
    .catch((error) => {
      console.error("[Scheduler] Manual refresh failed:", error);
      // Don't update lastRunTime/nextScheduledRun on failure - they remain unchanged
    });

  return { started: true, message: "Refresh started" };
}
