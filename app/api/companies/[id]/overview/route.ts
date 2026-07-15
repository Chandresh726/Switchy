import { and, count, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ensureJobFingerprintProjection } from "@/lib/ai/artifacts/job-fingerprint-projection";
import {
  getCurrentMatchContext,
  getMatchPresentations,
} from "@/lib/ai/matcher/presentation";
import { countPromotedMatchRows } from "@/lib/ai/matcher/promotion";
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

const COMPANY_JOB_SELECTION = {
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
  matchScore: jobs.matchScore,
  matchReasons: jobs.matchReasons,
  matchedSkills: jobs.matchedSkills,
  missingSkills: jobs.missingSkills,
  recommendations: jobs.recommendations,
  discoveredAt: jobs.discoveredAt,
  viewedAt: jobs.viewedAt,
} as const;

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
    const currentResultJoin = currentContext
      ? and(
          eq(matchResults.jobId, jobs.id),
          eq(matchResults.candidateFingerprint, currentContext.candidateFingerprint),
          eq(matchResults.jobFingerprint, jobs.aiFingerprint),
          eq(matchResults.scoringPolicyVersion, currentContext.scoringPolicyVersion),
          eq(matchResults.isStale, false)
        )
      : null;
    const jobStatsPromise = db.select({
      openJobs: count(),
    }).from(jobs).where(eq(jobs.companyId, parsedParams.id));
    const promotionRowsPromise = currentContext
      ? db
          .select({
            evidenceJson: matchResults.evidenceJson,
            legacyScore: jobs.matchScore,
          })
          .from(jobs)
          .leftJoin(matchResults, currentResultJoin!)
          .where(eq(jobs.companyId, parsedParams.id))
      : db
          .select({
            evidenceJson: sql<string | null>`null`,
            legacyScore: jobs.matchScore,
          })
          .from(jobs)
          .where(eq(jobs.companyId, parsedParams.id));
    const topMatchJobsPromise = currentContext
      ? db
          .select(COMPANY_JOB_SELECTION)
          .from(jobs)
          .leftJoin(matchResults, currentResultJoin!)
          .where(and(
            eq(jobs.companyId, parsedParams.id),
            or(
              eq(sql<string | null>`json_extract(${matchResults.evidenceJson}, '$.matchBand')`, "high"),
              eq(sql<string | null>`json_extract(${matchResults.evidenceJson}, '$.matchBand')`, "good"),
              and(isNull(matchResults.id), gte(jobs.matchScore, 70))
            )
          ))
          .orderBy(
            desc(sql<number | null>`coalesce(${matchResults.score}, ${jobs.matchScore})`),
            desc(jobs.discoveredAt)
          )
          .limit(3)
      : db
          .select(COMPANY_JOB_SELECTION)
          .from(jobs)
          .where(and(eq(jobs.companyId, parsedParams.id), gte(jobs.matchScore, 70)))
          .orderBy(desc(jobs.matchScore), desc(jobs.discoveredAt))
          .limit(3);

    const [
      jobStatsResult,
      peopleStatsResult,
      companyJobs,
      companyPeople,
      recentScrapeLogs,
      recentMatchSessions,
      promotionRows,
      topMatchJobs,
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
        .select(COMPANY_JOB_SELECTION)
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
      promotionRowsPromise,
      topMatchJobsPromise,
    ]);

    const jobStats = jobStatsResult[0];
    const peopleStats = peopleStatsResult[0];
    const canScrapeJobs = isCompanyScrapeSupported(company.careersUrl, company.platform);
    const [visiblePresentations, topMatchPresentations] = await Promise.all([
      getMatchPresentations(companyJobs, currentContext),
      getMatchPresentations(topMatchJobs, currentContext, { includeStale: false }),
    ]);
    const presentedCompanyJobs = companyJobs.map((job) => {
      const presentation = visiblePresentations.get(job.id);
      if (!presentation) throw new Error(`Missing match presentation for job ${job.id}`);
      return {
        ...job,
        description: undefined,
        ...presentation,
      };
    });
    const presentedTopMatches = topMatchJobs.map((job) => {
      const presentation = topMatchPresentations.get(job.id);
      if (!presentation) throw new Error(`Missing match presentation for job ${job.id}`);
      return {
        ...job,
        description: undefined,
        ...presentation,
      };
    });
    const highMatchJobs = countPromotedMatchRows(promotionRows);

    return NextResponse.json({
      company: {
        ...company,
        canScrapeJobs,
      },
      stats: {
        openJobs: jobStats?.openJobs ?? 0,
        highMatchJobs,
        mappedPeople: peopleStats?.mappedPeople || 0,
        starredPeople: peopleStats?.starredPeople || 0,
      },
      jobs: presentedCompanyJobs,
      topMatches: presentedTopMatches,
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
