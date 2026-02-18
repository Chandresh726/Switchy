import { db } from "@/lib/db";
import { companies, jobs, scrapingLogs, scrapeSessions, settings } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { scraperRegistry } from "@/lib/scrapers/registry";
import { batchDeduplicateJobs } from "@/lib/jobs/deduplicator";
import { getMatcherConfig, matchWithTracking } from "@/lib/ai/matcher";
import { applyFilters, parseTitleKeywordsFilter } from "@/lib/jobs/filter-utils";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { companyIds } = body as { companyIds: number[] };

    if (!Array.isArray(companyIds) || companyIds.length === 0) {
      return NextResponse.json(
        { error: "companyIds must be a non-empty array" },
        { status: 400 }
      );
    }

    const companiesList = await db
      .select()
      .from(companies)
      .where(inArray(companies.id, companyIds));

    const sessionId = crypto.randomUUID();
    await db.insert(scrapeSessions).values({
      id: sessionId,
      triggerSource: "manual",
      status: "in_progress",
      companiesTotal: companiesList.length,
      companiesCompleted: 0,
      totalJobsFound: 0,
      totalJobsAdded: 0,
      totalJobsFiltered: 0,
    });

    // Load filter settings once for all companies
    const settingsKeys = ["scraper_filter_country", "scraper_filter_city", "scraper_filter_title_keywords"];
    const settingsData = await db.select().from(settings).where(inArray(settings.key, settingsKeys));
    const settingsMap = new Map(settingsData.map((s) => [s.key, s.value]));
    const filterCountry = settingsMap.get("scraper_filter_country") || "";
    const filterCity = settingsMap.get("scraper_filter_city") || "";
    const filterTitleKeywords = parseTitleKeywordsFilter(settingsMap.get("scraper_filter_title_keywords") ?? null);

    let totalJobsFound = 0;
    let totalJobsAdded = 0;
    let totalJobsFiltered = 0;
    let completed = 0;

    for (const company of companiesList) {
      try {
        const startTime = Date.now();

        // Get existing jobs for early deduplication
        const existingJobs = await db
          .select({
            id: jobs.id,
            externalId: jobs.externalId,
            title: jobs.title,
            url: jobs.url,
          })
          .from(jobs)
          .where(eq(jobs.companyId, company.id));

        const existingExternalIds = new Set<string>(
          existingJobs.map(j => j.externalId).filter((id): id is string => Boolean(id))
        );

        const scraperResult = await scraperRegistry.scrape(
          company.careersUrl,
          company.platform || undefined,
          {
            boardToken: company.boardToken || undefined,
            filters: {
              country: filterCountry || undefined,
              city: filterCity || undefined,
              titleKeywords: filterTitleKeywords.length > 0 ? filterTitleKeywords : undefined,
            },
            existingExternalIds,
          }
        );

        if (!scraperResult.success) {
          await db.insert(scrapingLogs).values({
            companyId: company.id,
            sessionId,
            triggerSource: "manual",
            platform: company.platform,
            status: "error",
            jobsFound: 0,
            jobsAdded: 0,
            jobsUpdated: 0,
            jobsFiltered: 0,
            errorMessage: scraperResult.error,
            duration: Date.now() - startTime,
            completedAt: new Date(),
          });
          completed++;
          continue;
        }

        const { newJobs } = batchDeduplicateJobs(
          scraperResult.jobs.map((j) => ({
            externalId: j.externalId,
            title: j.title,
            url: j.url,
          })),
          existingJobs
        );

        let newJobsToInsert = scraperResult.jobs.filter((j) =>
          newJobs.some((nj) => nj.externalId === j.externalId)
        );

        const { filtered, filteredOut } = applyFilters(newJobsToInsert, {
          country: filterCountry || undefined,
          city: filterCity || undefined,
          titleKeywords: filterTitleKeywords.length > 0 ? filterTitleKeywords : undefined,
        });
        newJobsToInsert = filtered;
        const jobsFilteredOut = filteredOut;

        let jobsAdded = 0;
        let insertedJobIds: number[] = [];
        if (newJobsToInsert.length > 0) {
          const insertedJobs = await db.insert(jobs).values(
            newJobsToInsert.map((job) => ({
              companyId: company.id,
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
          insertedJobIds = insertedJobs.map((j) => j.id);
        }

        // Save detected boardToken if present
        const companyUpdateData: {
          lastScrapedAt: Date;
          updatedAt: Date;
          boardToken?: string;
        } = {
          lastScrapedAt: new Date(),
          updatedAt: new Date(),
        };
        if (scraperResult.detectedBoardToken && !company.boardToken) {
          companyUpdateData.boardToken = scraperResult.detectedBoardToken;
        }

        await db
          .update(companies)
          .set(companyUpdateData)
          .where(eq(companies.id, company.id));

        await db.insert(scrapingLogs).values({
          companyId: company.id,
          sessionId,
          triggerSource: "manual",
          platform: company.platform,
          status: "success",
          jobsFound: scraperResult.jobs.length,
          jobsAdded,
          jobsUpdated: 0,
          jobsFiltered: jobsFilteredOut,
          duration: Date.now() - startTime,
          completedAt: new Date(),
        });

        totalJobsFound += scraperResult.jobs.length;
        totalJobsAdded += jobsAdded;
        totalJobsFiltered += jobsFilteredOut;
        completed++;

        await db
          .update(scrapeSessions)
          .set({
            companiesCompleted: completed,
            totalJobsFound,
            totalJobsAdded,
            totalJobsFiltered,
          })
          .where(eq(scrapeSessions.id, sessionId));

        if (insertedJobIds.length > 0) {
          const matcherConfig = await getMatcherConfig();
          if (matcherConfig.autoMatchAfterScrape) {
            matchWithTracking(insertedJobIds, {
              triggerSource: "scheduler",
              companyId: company.id,
            }).catch((err) => console.error("[Bulk Refresh] Matching failed:", err));
          }
        }
      } catch (companyError) {
        console.error(`[Bulk Refresh] Failed for company ${company.id}:`, companyError);
        completed++;
      }
    }

    await db
      .update(scrapeSessions)
      .set({
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(scrapeSessions.id, sessionId));

    return NextResponse.json({
      success: true,
      sessionId,
      totalCompanies: companiesList.length,
      totalJobsFound,
      totalJobsAdded,
      message: `Refreshed jobs for ${companiesList.length} companies. Found ${totalJobsFound} jobs, added ${totalJobsAdded} new.`,
    });
  } catch (error) {
    console.error("Failed to refresh jobs:", error);
    return NextResponse.json(
      { error: "Failed to refresh jobs" },
      { status: 500 }
    );
  }
}
