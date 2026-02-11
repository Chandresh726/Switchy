import cron, { type ScheduledTask } from "node-cron";
import { db } from "@/lib/db";
import { companies, settings } from "@/lib/db/schema";
import { eq, lte, and } from "drizzle-orm";
import { fetchJobsForCompany } from "./fetcher";

let schedulerTask: ScheduledTask | null = null;
let isRunning = false;

interface SchedulerStatus {
  isActive: boolean;
  lastRun: Date | null;
  nextRun: Date | null;
  cronExpression: string;
}

const DEFAULT_CRON = "0 * * * *"; // Every hour

export function getSchedulerStatus(): SchedulerStatus {
  return {
    isActive: schedulerTask !== null,
    lastRun: null, // Would need to track this in settings
    nextRun: null, // node-cron doesn't expose this easily
    cronExpression: DEFAULT_CRON,
  };
}

export function startScheduler(): void {
  if (schedulerTask) {
    console.log("[Scheduler] Already running");
    return;
  }

  schedulerTask = cron.schedule(DEFAULT_CRON, async () => {
    await runScheduledRefresh();
  });

  console.log(`[Scheduler] Started with cron: ${DEFAULT_CRON}`);
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

    // Update last run time in settings
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
  runScheduledRefresh().catch(console.error);

  return { started: true, message: "Refresh started" };
}
