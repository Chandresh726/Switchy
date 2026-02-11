import { db } from "@/lib/db";
import { companies, jobs, scrapingLogs, scrapeSessions, settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { scraperRegistry } from "@/lib/scrapers/registry";
import { batchDeduplicateJobs } from "./deduplicator";
import { matchJobsWithTracking, getMatcherSettings } from "@/lib/ai/matcher";

// Country/location mappings for filtering
const COUNTRY_MAPPINGS: Record<string, string[]> = {
  india: [
    "india",
    "ind",
    "bangalore",
    "bengaluru",
    "mumbai",
    "delhi",
    "hyderabad",
    "chennai",
    "pune",
    "kolkata",
    "gurugram",
    "gurgaon",
    "noida",
    "ahmedabad",
    "jaipur",
    "kochi",
    "thiruvananthapuram",
  ],
  "united states": [
    "usa",
    "us",
    "u.s.",
    "united states",
    "america",
    "new york",
    "san francisco",
    "seattle",
    "los angeles",
    "chicago",
    "austin",
    "boston",
    "denver",
  ],
  "united kingdom": [
    "uk",
    "u.k.",
    "britain",
    "england",
    "united kingdom",
    "london",
    "manchester",
    "edinburgh",
    "birmingham",
  ],
  germany: ["germany", "deutschland", "berlin", "munich", "frankfurt", "hamburg"],
  canada: ["canada", "toronto", "vancouver", "montreal", "ottawa", "calgary"],
};

/**
 * Check if a job location matches the preferred country.
 * Returns true if:
 * - Location is purely "Remote" (no country specified)
 * - Location contains the preferred country or its variations/cities
 */
function matchesPreferredCountry(
  location: string | undefined,
  preferredCountry: string
): boolean {
  if (!location) return false;

  const locationLower = location.toLowerCase().trim();
  const countryLower = preferredCountry.toLowerCase().trim();

  // Pure remote jobs (no country) are always included
  if (
    locationLower === "remote" ||
    locationLower === "remote position" ||
    locationLower === "worldwide" ||
    locationLower === "anywhere"
  ) {
    return true;
  }

  // Get variations for the country (or use the country name itself)
  const variations = COUNTRY_MAPPINGS[countryLower] || [countryLower];

  // Check if location contains any of the country variations
  return variations.some((variant) => {
    // Match as whole word to avoid false positives (e.g., "IN" matching "engineering")
    const regex = new RegExp(`\\b${variant}\\b`, "i");
    return regex.test(locationLower);
  });
}

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
  triggerSource?: "manual" | "scheduled" | "api";
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
    // Scrape jobs from the company's careers page
    const scraperResult = await scraperRegistry.scrape(
      company.careersUrl,
      company.platform || undefined,
      { boardToken: company.boardToken || undefined }
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

    // Get existing jobs for deduplication
    const existingJobs = await db
      .select({
        id: jobs.id,
        externalId: jobs.externalId,
        title: jobs.title,
        url: jobs.url,
      })
      .from(jobs)
      .where(eq(jobs.companyId, companyId));

    // Deduplicate jobs
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

    // Filter by preferred country if set in settings
    const filterCountrySetting = await db.select().from(settings).where(eq(settings.key, "scraper_filter_country"));
    const filterCountry = filterCountrySetting[0]?.value || "";
    let jobsFilteredOut = 0;

    if (filterCountry) {
      const originalCount = newJobsToInsert.length;
      newJobsToInsert = newJobsToInsert.filter((job) =>
        matchesPreferredCountry(job.location, filterCountry)
      );
      jobsFilteredOut = originalCount - newJobsToInsert.length;

      if (jobsFilteredOut > 0) {
        console.log(
          `[Filter] Filtered out ${jobsFilteredOut}/${originalCount} jobs not matching preferred country: ${filterCountry}`
        );
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
      // Check if auto-match after scrape is enabled
      const matcherSettings = await getMatcherSettings();

      if (matcherSettings.autoMatchAfterScrape) {
        console.log(`[Matcher] Auto-match enabled, starting match for ${insertedJobIds.length} jobs...`);

        // Update matcher status to in_progress
        if (logId) {
          await db.update(scrapingLogs)
            .set({ matcherStatus: "in_progress" })
            .where(eq(scrapingLogs.id, logId));
        }

        const matcherStartTime = Date.now();

        // Use matchJobsWithTracking for full session tracking
        matchJobsWithTracking(
          insertedJobIds,
          "auto_scrape",
          companyId,
          async (completed, total, succeeded, failed) => {
            console.log(`[Matcher] Progress: ${completed}/${total} jobs (${succeeded} succeeded, ${failed} failed)`);
            // Update matcher progress in the log
            if (logId) {
              await db.update(scrapingLogs)
                .set({ matcherJobsCompleted: completed })
                .where(eq(scrapingLogs.id, logId));
            }
          }
        )
          .then(async (result) => {
            console.log(`[Matcher] Completed: ${result.succeeded}/${result.total} jobs matched successfully`);
            // Update matcher status to completed
            if (logId) {
              await db.update(scrapingLogs)
                .set({
                  matcherStatus: result.failed === result.total ? "failed" : "completed",
                  matcherJobsCompleted: result.succeeded,
                  matcherErrorCount: result.failed,
                  matcherDuration: Date.now() - matcherStartTime,
                })
                .where(eq(scrapingLogs.id, logId));
            }
          })
          .catch(async (err) => {
            console.error("[Matcher] Background matching failed:", err);
            // Update matcher status to failed
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
        // Update log to indicate matcher was skipped
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
  triggerSource: "manual" | "scheduled" | "api" = "manual"
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
