import { db } from "@/lib/db";
import { companies, jobs, scrapingLogs, scrapeSessions } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { scraperRegistry } from "@/lib/scrapers/registry";
import { batchDeduplicateJobs } from "@/lib/jobs/deduplicator";
import { getMatcherConfig, matchWithTracking } from "@/lib/ai/matcher";

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

    let totalJobsFound = 0;
    let totalJobsAdded = 0;
    let completed = 0;

    for (const company of companiesList) {
      try {
        const startTime = Date.now();

        const scraperResult = await scraperRegistry.scrape(
          company.careersUrl,
          company.platform || undefined,
          { boardToken: company.boardToken || undefined }
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

        const existingJobs = await db
          .select({
            id: jobs.id,
            externalId: jobs.externalId,
            title: jobs.title,
            url: jobs.url,
          })
          .from(jobs)
          .where(eq(jobs.companyId, company.id));

        const { newJobs } = batchDeduplicateJobs(
          scraperResult.jobs.map((j) => ({
            externalId: j.externalId,
            title: j.title,
            url: j.url,
          })),
          existingJobs
        );

        const newJobsToInsert = scraperResult.jobs.filter((j) =>
          newJobs.some((nj) => nj.externalId === j.externalId)
        );

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

        await db
          .update(companies)
          .set({ lastScrapedAt: new Date(), updatedAt: new Date() })
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
          jobsFiltered: 0,
          duration: Date.now() - startTime,
          completedAt: new Date(),
        });

        totalJobsFound += scraperResult.jobs.length;
        totalJobsAdded += jobsAdded;
        completed++;

        await db
          .update(scrapeSessions)
          .set({
            companiesCompleted: completed,
            totalJobsFound,
            totalJobsAdded,
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
