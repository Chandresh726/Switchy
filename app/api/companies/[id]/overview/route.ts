import { and, count, desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ensureJobFingerprintProjection } from "@/lib/ai/artifacts/job-fingerprint-projection";
import {
  getCurrentMatchContext,
  getMatchPresentations,
} from "@/lib/ai/matcher/presentation";
import { handleApiError } from "@/lib/api";
import { isCompanyScrapeSupported } from "@/lib/companies/scrape-support";
import { db } from "@/lib/db";
import {
  companies,
  jobs,
  matchResults,
  matchSessions,
  people,
  scrapingLogs,
} from "@/lib/db/schema";

const ParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const parsedParams = ParamsSchema.parse(await params);

    const [company] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, parsedParams.id));

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    ensureJobFingerprintProjection();
    const currentContext = await getCurrentMatchContext();
    const jobStatsPromise = currentContext
      ? db.select({
          openJobs: count(),
          highMatchJobs: sql<number>`SUM(CASE WHEN ${matchResults.score} >= 75 THEN 1 ELSE 0 END)`,
        }).from(jobs).leftJoin(matchResults, and(
          eq(matchResults.jobId, jobs.id),
          eq(matchResults.candidateFingerprint, currentContext.candidateFingerprint),
          eq(matchResults.jobFingerprint, jobs.aiFingerprint),
          eq(matchResults.scoringPolicyVersion, currentContext.scoringPolicyVersion),
          eq(matchResults.isStale, false)
        )).where(eq(jobs.companyId, parsedParams.id))
      : db.select({
          openJobs: count(),
          highMatchJobs: sql<number>`0`,
        }).from(jobs).where(eq(jobs.companyId, parsedParams.id));

    const [
      jobStatsResult,
      peopleStatsResult,
      companyJobs,
      companyPeople,
      recentScrapeLogs,
      recentMatchSessions,
    ] = await Promise.all([
      jobStatsPromise,
      db
        .select({
          mappedPeople: sql<number>`count(*)`,
          starredPeople: sql<number>`sum(case when ${people.isStarred} = 1 then 1 else 0 end)`,
        })
        .from(people)
        .where(
          and(
            eq(people.mappedCompanyId, parsedParams.id),
            eq(people.isActive, true)
          )
        ),
      db
        .select({
          id: jobs.id,
          title: jobs.title,
          description: jobs.description,
          url: jobs.url,
          status: jobs.status,
          location: jobs.location,
          locationType: jobs.locationType,
          seniorityLevel: jobs.seniorityLevel,
          department: jobs.department,
          employmentType: jobs.employmentType,
          salary: jobs.salary,
          discoveredAt: jobs.discoveredAt,
          viewedAt: jobs.viewedAt,
        })
        .from(jobs)
        .where(eq(jobs.companyId, parsedParams.id))
        .orderBy(desc(jobs.discoveredAt))
        .limit(50),
      db
        .select({
          id: people.id,
          fullName: people.fullName,
          firstName: people.firstName,
          lastName: people.lastName,
          profileUrl: people.profileUrl,
          email: people.email,
          position: people.position,
          source: people.source,
          connectedOn: people.connectedOn,
          isStarred: people.isStarred,
          notes: people.notes,
        })
        .from(people)
        .where(
          and(
            eq(people.mappedCompanyId, parsedParams.id),
            eq(people.isActive, true)
          )
        )
        .orderBy(desc(people.isStarred), people.fullName)
        .limit(200),
      db
        .select({
          id: scrapingLogs.id,
          status: scrapingLogs.status,
          triggerSource: scrapingLogs.triggerSource,
          jobsFound: scrapingLogs.jobsFound,
          jobsAdded: scrapingLogs.jobsAdded,
          startedAt: scrapingLogs.startedAt,
          completedAt: scrapingLogs.completedAt,
        })
        .from(scrapingLogs)
        .where(eq(scrapingLogs.companyId, parsedParams.id))
        .orderBy(desc(scrapingLogs.startedAt))
        .limit(20),
      db
        .select({
          id: matchSessions.id,
          status: matchSessions.status,
          triggerSource: matchSessions.triggerSource,
          jobsTotal: matchSessions.jobsTotal,
          jobsCompleted: matchSessions.jobsCompleted,
          jobsSucceeded: matchSessions.jobsSucceeded,
          jobsFailed: matchSessions.jobsFailed,
          startedAt: matchSessions.startedAt,
          completedAt: matchSessions.completedAt,
        })
        .from(matchSessions)
        .where(eq(matchSessions.companyId, parsedParams.id))
        .orderBy(desc(matchSessions.startedAt))
        .limit(20),
    ]);

    const jobStats = jobStatsResult[0];
    const peopleStats = peopleStatsResult[0];
    const canScrapeJobs = isCompanyScrapeSupported(company.careersUrl, company.platform);
    const visiblePresentations = await getMatchPresentations(
      companyJobs,
      currentContext
    );
    const presentedCompanyJobs = companyJobs.map((job) => {
      const presentation = visiblePresentations.get(job.id);
      if (!presentation) throw new Error(`Missing match presentation for job ${job.id}`);
      return {
        ...job,
        description: undefined,
        ...presentation,
      };
    });

    return NextResponse.json({
      company: {
        ...company,
        canScrapeJobs,
      },
      stats: {
        openJobs: jobStats?.openJobs ?? 0,
        highMatchJobs: Number(jobStats?.highMatchJobs ?? 0),
        mappedPeople: peopleStats?.mappedPeople || 0,
        starredPeople: peopleStats?.starredPeople || 0,
      },
      jobs: presentedCompanyJobs,
      people: companyPeople,
      activity: {
        scrapeLogs: recentScrapeLogs,
        matchSessions: recentMatchSessions,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
