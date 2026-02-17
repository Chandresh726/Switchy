import { db } from "@/lib/db";
import { companies, jobs, scrapingLogs, scrapeSessions, settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { scraperRegistry } from "@/lib/scrapers/registry";
import { batchDeduplicateJobs } from "./deduplicator";
import { matchWithTracking, getMatcherConfig } from "@/lib/ai/matcher";
import type { TriggerSource } from "@/lib/ai/matcher/types";
import {
  matchesPreferredCountry,
  matchesPreferredCity,
  parseTitleKeywordsFilter,
  matchesTitleKeywords,
} from "./filter-utils";

export interface FetchResult {
  companyId: number;
  companyName: string;
  success: boolean;
  jobsFound: number;
  jobsAdded: number;
  jobsUpdated: number;
  jobsFiltered: number;
  platform: string | null;
  error?: string;
  duration: number;
  logId?: number;
}

export interface FetchOptions {
  sessionId?: string;
  triggerSource?: TriggerSource;
}

export async function fetchJobsForCompany(
  companyId: number,
  options: FetchOptions = {}
): Promise<FetchResult> {
  const startTime = Date.now();

  // Get company details
  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, companyId));

  if (!company) {
    return {
      companyId,
      companyName: "Unknown",
      success: false,
      jobsFound: 0,
      jobsAdded: 0,
      jobsUpdated: 0,
      jobsFiltered: 0,
      platform: null,
      error: "Company not found",
      duration: Date.now() - startTime,
    };
  }

  let sessionId = options.sessionId;
  const triggerSource = options.triggerSource ?? "manual";

  // Create a session if one wasn't provided (single company refresh)
  const isStandaloneRefresh = !sessionId;
  if (isStandaloneRefresh) {
    sessionId = crypto.randomUUID();
    await db.insert(scrapeSessions).values({
      id: sessionId,
      triggerSource: triggerSource || "manual",
      status: "in_progress",
      companiesTotal: 1,
      companiesCompleted: 0,
      totalJobsFound: 0,
      totalJobsAdded: 0,
      totalJobsFiltered: 0,
    });
  }

  try {
    // Get existing jobs BEFORE scraping for early deduplication
    const existingJobs = await db
      .select({
        id: jobs.id,
        externalId: jobs.externalId,
        title: jobs.title,
        url: jobs.url,
      })
      .from(jobs)
      .where(eq(jobs.companyId, companyId));

    const existingExternalIds = new Set<string>(
      existingJobs.map(j => j.externalId).filter((id): id is string => Boolean(id))
    );

    // Load filter settings
    const filterCountrySetting = await db.select().from(settings).where(eq(settings.key, "scraper_filter_country"));
    const filterCitySetting = await db.select().from(settings).where(eq(settings.key, "scraper_filter_city"));
    const filterTitleKeywordsSetting = await db.select().from(settings).where(eq(settings.key, "scraper_filter_title_keywords"));
    const filterCountry = filterCountrySetting[0]?.value || "";
    const filterCity = filterCitySetting[0]?.value || "";
    const filterTitleKeywords = parseTitleKeywordsFilter(filterTitleKeywordsSetting[0]?.value ?? null);

    const scraperOptions = {
      boardToken: company.boardToken || undefined,
      filters: {
        country: filterCountry || undefined,
        city: filterCity || undefined,
        titleKeywords: filterTitleKeywords.length > 0 ? filterTitleKeywords : undefined,
      },
      existingExternalIds,
    };

    const scraperResult = await scraperRegistry.scrape(
      company.careersUrl,
      company.platform || undefined,
      scraperOptions
    );

    if (!scraperResult.success) {
      // Log the failure
      const [log] = await db.insert(scrapingLogs).values({
        companyId,
        sessionId,
        triggerSource,
        platform: company.platform,
        status: "error",
        jobsFound: 0,
        jobsAdded: 0,
        jobsUpdated: 0,
        jobsFiltered: 0,
        errorMessage: scraperResult.error,
        duration: Date.now() - startTime,
        completedAt: new Date(),
      }).returning({ id: scrapingLogs.id });

      // Update session if this was a standalone refresh
      if (isStandaloneRefresh && sessionId) {
        await db.update(scrapeSessions)
          .set({
            status: "failed",
            companiesCompleted: 1,
            completedAt: new Date(),
          })
          .where(eq(scrapeSessions.id, sessionId));
      }

      return {
        companyId,
        companyName: company.name,
        success: false,
        jobsFound: 0,
        jobsAdded: 0,
        jobsUpdated: 0,
        jobsFiltered: 0,
        platform: company.platform,
        error: scraperResult.error,
        duration: Date.now() - startTime,
        logId: log?.id,
      };
    }

    // Deduplicate jobs (safety net - scraper may have already done early deduplication)
    const { newJobs, duplicates } = batchDeduplicateJobs(
      scraperResult.jobs.map((j) => ({
        externalId: j.externalId,
        title: j.title,
        url: j.url,
      })),
      existingJobs
    );

    // Map back to full job objects
    let newJobsToInsert = scraperResult.jobs.filter((j) =>
      newJobs.some((nj) => nj.externalId === j.externalId)
    );

    // Post-scrape filtering (safety net for scrapers that don't support early filtering)
    let jobsFilteredOut = 0;

    if (filterCountry || filterCity) {
      const originalCount = newJobsToInsert.length;

      newJobsToInsert = newJobsToInsert.filter((job) => {
        const matchesCountry = !filterCountry || matchesPreferredCountry(job.location, filterCountry);
        const matchesCity = matchesPreferredCity(job.location, filterCity);
        return matchesCountry && matchesCity;
      });

      const filteredHere = originalCount - newJobsToInsert.length;
      jobsFilteredOut += filteredHere;
      
      if (filteredHere > 0) {
        const filterReasons = [];
        if (filterCountry) filterReasons.push(`country: ${filterCountry}`);
        if (filterCity) filterReasons.push(`city: ${filterCity}`);
        console.log(`[Filter] Post-scrape: ${filteredHere} jobs filtered (${filterReasons.join(", ")})`);
      }
    }

    if (filterTitleKeywords.length > 0) {
      const originalCount = newJobsToInsert.length;
      newJobsToInsert = newJobsToInsert.filter((job) => matchesTitleKeywords(job.title, filterTitleKeywords));
      const filteredHere = originalCount - newJobsToInsert.length;
      jobsFilteredOut += filteredHere;
      if (filteredHere > 0) {
        console.log(`[Filter] Post-scrape title filter: ${filteredHere} jobs filtered`);
      }
    }

    // Insert new jobs
    let jobsAdded = 0;
    let insertedJobIds: number[] = [];
    if (newJobsToInsert.length > 0) {
      const insertedJobs = await db.insert(jobs).values(
        newJobsToInsert.map((job) => ({
          companyId,
          externalId: job.externalId,
          title: job.title,
          url: job.url,
          location: job.location,
          locationType: job.locationType,
          department: job.department,
          description: job.description,
          descriptionFormat: job.descriptionFormat ?? "plain",
          salary: job.salary,
          employmentType: job.employmentType,
          postedDate: job.postedDate,
          status: "new" as const,
        }))
      ).returning({ id: jobs.id });
      jobsAdded = newJobsToInsert.length;
      insertedJobIds = insertedJobs.map(j => j.id);
    }

    // Update company's last scraped timestamp
    await db
      .update(companies)
      .set({ lastScrapedAt: new Date(), updatedAt: new Date() })
      .where(eq(companies.id, companyId));

    // Log the scrape result
    const [log] = await db.insert(scrapingLogs).values({
      companyId,
      sessionId,
      triggerSource,
      platform: company.platform,
      status: "success",
      jobsFound: scraperResult.jobs.length,
      jobsAdded,
      jobsUpdated: duplicates.length,
      jobsFiltered: jobsFilteredOut,
      duration: Date.now() - startTime,
      completedAt: new Date(),
      matcherStatus: insertedJobIds.length > 0 ? "pending" : null,
      matcherJobsTotal: insertedJobIds.length > 0 ? insertedJobIds.length : null,
      matcherJobsCompleted: 0,
    }).returning({ id: scrapingLogs.id });
    const logId: number | undefined = log?.id;

    // Trigger async matching for new jobs if auto-match is enabled
    if (insertedJobIds.length > 0) {
      const matcherConfig = await getMatcherConfig();

      if (matcherConfig.autoMatchAfterScrape) {
        console.log(`[Matcher] Auto-match enabled, starting match for ${insertedJobIds.length} jobs...`);

        // Update matcher status to in_progress
        if (logId) {
          await db.update(scrapingLogs)
            .set({ matcherStatus: "in_progress" })
            .where(eq(scrapingLogs.id, logId));
        }

        const matcherStartTime = Date.now();

        matchWithTracking(insertedJobIds, {
          triggerSource: "scheduler",
          companyId,
          onProgress: (progress) => {
            console.log(`[Matcher] Progress: ${progress.completed}/${progress.total} jobs (${progress.succeeded} succeeded, ${progress.failed} failed)`);
            if (logId) {
              void db
                .update(scrapingLogs)
                .set({ matcherJobsCompleted: progress.completed })
                .where(eq(scrapingLogs.id, logId))
                .catch((e) => console.error("[Matcher] Failed to persist progress:", e));
            }
          },
        })
          .then(async (result) => {
            console.log(`[Matcher] Completed: ${result.succeeded}/${result.total} jobs matched successfully`);
            if (logId) {
              await db.update(scrapingLogs)
                .set({
                  matcherStatus: result.failed === result.total ? "failed" : "completed",
                  matcherJobsCompleted: result.total,
                  matcherErrorCount: result.failed,
                  matcherDuration: Date.now() - matcherStartTime,
                })
                .where(eq(scrapingLogs.id, logId));
            }
          })
          .catch(async (err: unknown) => {
            const error = err instanceof Error ? err : new Error(String(err));
            console.error("[Matcher] Background matching failed:", error);
            if (logId) {
              await db.update(scrapingLogs)
                .set({
                  matcherStatus: "failed",
                  matcherDuration: Date.now() - matcherStartTime,
                })
                .where(eq(scrapingLogs.id, logId));
            }
          });
      } else {
        console.log(`[Matcher] Auto-match disabled, skipping matching for ${insertedJobIds.length} new jobs`);
        if (logId) {
          await db.update(scrapingLogs)
            .set({ matcherStatus: null, matcherJobsTotal: null })
            .where(eq(scrapingLogs.id, logId));
        }
      }
    }

    // Update session if this was a standalone refresh
    if (isStandaloneRefresh && sessionId) {
      await db.update(scrapeSessions)
        .set({
          status: "completed",
          companiesCompleted: 1,
          totalJobsFound: scraperResult.jobs.length,
          totalJobsAdded: jobsAdded,
          totalJobsFiltered: jobsFilteredOut,
          completedAt: new Date(),
        })
        .where(eq(scrapeSessions.id, sessionId));
    }

    return {
      companyId,
      companyName: company.name,
      success: true,
      jobsFound: scraperResult.jobs.length,
      jobsAdded,
      jobsUpdated: duplicates.length,
      jobsFiltered: jobsFilteredOut,
      platform: company.platform,
      duration: Date.now() - startTime,
      logId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Log the error
    const [log] = await db.insert(scrapingLogs).values({
      companyId,
      sessionId,
      triggerSource,
      platform: company.platform,
      status: "error",
      jobsFound: 0,
      jobsAdded: 0,
      jobsUpdated: 0,
      jobsFiltered: 0,
      errorMessage,
      duration: Date.now() - startTime,
      completedAt: new Date(),
    }).returning({ id: scrapingLogs.id });

    // Update session if this was a standalone refresh
    if (isStandaloneRefresh && sessionId) {
      await db.update(scrapeSessions)
        .set({
          status: "failed",
          companiesCompleted: 1,
          completedAt: new Date(),
        })
        .where(eq(scrapeSessions.id, sessionId));
    }

    return {
      companyId,
      companyName: company.name,
      success: false,
      jobsFound: 0,
      jobsAdded: 0,
      jobsUpdated: 0,
      jobsFiltered: 0,
      platform: company.platform,
      error: errorMessage,
      duration: Date.now() - startTime,
      logId: log?.id,
    };
  }
}

export interface BatchFetchResult {
  sessionId: string;
  results: FetchResult[];
  summary: {
    totalCompanies: number;
    successfulCompanies: number;
    failedCompanies: number;
    totalJobsFound: number;
    totalJobsAdded: number;
    totalJobsFiltered: number;
    totalDuration: number;
  };
}

export async function fetchJobsForAllCompanies(
  triggerSource: TriggerSource = "manual"
): Promise<BatchFetchResult> {
  const sessionId = crypto.randomUUID();
  const sessionStartTime = Date.now();

  const activeCompanies = await db
    .select()
    .from(companies)
    .where(eq(companies.isActive, true));

  // Create session record
  await db.insert(scrapeSessions).values({
    id: sessionId,
    triggerSource,
    status: "in_progress",
    companiesTotal: activeCompanies.length,
    companiesCompleted: 0,
    totalJobsFound: 0,
    totalJobsAdded: 0,
    totalJobsFiltered: 0,
  });

  const results: FetchResult[] = [];

  for (const company of activeCompanies) {
    const result = await fetchJobsForCompany(company.id, { sessionId, triggerSource });
    results.push(result);

    // Update session progress
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const successCount = results.filter(r => r.success).length;
    const totalJobsFound = results.reduce((sum, r) => sum + r.jobsFound, 0);
    const totalJobsAdded = results.reduce((sum, r) => sum + r.jobsAdded, 0);
    const totalJobsFiltered = results.reduce((sum, r) => sum + r.jobsFiltered, 0);

    await db.update(scrapeSessions)
      .set({
        companiesCompleted: results.length,
        totalJobsFound,
        totalJobsAdded,
        totalJobsFiltered,
      })
      .where(eq(scrapeSessions.id, sessionId));
  }

  // Finalize session
  const totalDuration = Date.now() - sessionStartTime;
  const successfulCompanies = results.filter(r => r.success).length;
  const hasFailures = results.some(r => !r.success);

  await db.update(scrapeSessions)
    .set({
      status: hasFailures ? (successfulCompanies > 0 ? "completed" : "failed") : "completed",
      completedAt: new Date(),
    })
    .where(eq(scrapeSessions.id, sessionId));

  return {
    sessionId,
    results,
    summary: {
      totalCompanies: activeCompanies.length,
      successfulCompanies,
      failedCompanies: results.length - successfulCompanies,
      totalJobsFound: results.reduce((sum, r) => sum + r.jobsFound, 0),
      totalJobsAdded: results.reduce((sum, r) => sum + r.jobsAdded, 0),
      totalJobsFiltered: results.reduce((sum, r) => sum + r.jobsFiltered, 0),
      totalDuration,
    },
  };
}
