import { NextResponse } from "next/server";

import { and, count, desc, eq, sql } from "drizzle-orm";

import { ensureJobFingerprintProjection } from "@/lib/ai/artifacts/job-fingerprint-projection";
import { getCurrentMatchContext } from "@/lib/ai/matcher/presentation";
import { db } from "@/lib/db";
import { companies, jobs, matchResults, people, scrapeSessions } from "@/lib/db/schema";
import { getUnmatchedCompaniesSummary } from "@/lib/people/sync/unmatched";

export async function GET() {
  try {
    ensureJobFingerprintProjection();
    const currentContext = await getCurrentMatchContext();
    const matchStatsPromise = currentContext
      ? db.select({
          highMatchJobs: sql<number>`SUM(CASE WHEN ${matchResults.score} >= 75 THEN 1 ELSE 0 END)`,
          jobsWithScore: count(),
        }).from(jobs).innerJoin(matchResults, and(
          eq(matchResults.jobId, jobs.id),
          eq(matchResults.candidateFingerprint, currentContext.candidateFingerprint),
          eq(matchResults.jobFingerprint, jobs.aiFingerprint),
          eq(matchResults.scoringPolicyVersion, currentContext.scoringPolicyVersion),
          eq(matchResults.isStale, false)
        ))
      : Promise.resolve([{ highMatchJobs: 0, jobsWithScore: 0 }]);
    const [
      jobStatsResult,
      companyStatsResult,
      lastSessionResult,
      peopleStatsResult,
      matchStatsResult,
    ] = await Promise.all([
      db
        .select({
          totalJobs: count(),
          appliedJobs: sql<number>`SUM(CASE WHEN ${jobs.status} = 'applied' THEN 1 ELSE 0 END)`,
          newJobs: sql<number>`SUM(CASE WHEN ${jobs.status} = 'new' THEN 1 ELSE 0 END)`,
          viewedJobs: sql<number>`SUM(CASE WHEN ${jobs.status} = 'viewed' THEN 1 ELSE 0 END)`,
          savedJobs: sql<number>`SUM(CASE WHEN ${jobs.status} = 'interested' THEN 1 ELSE 0 END)`,
        })
        .from(jobs),
      db.select({ totalCompanies: count() }).from(companies),
      db
        .select()
        .from(scrapeSessions)
        .orderBy(desc(sql`coalesce(${scrapeSessions.scheduledForAt}, ${scrapeSessions.startedAt})`))
        .limit(1),
      db
        .select({
          totalPeople: sql<number>`SUM(CASE WHEN ${people.isActive} = 1 THEN 1 ELSE 0 END)`,
          starredPeople: sql<number>`SUM(CASE WHEN ${people.isActive} = 1 AND ${people.isStarred} = 1 THEN 1 ELSE 0 END)`,
          mappedPeople: sql<number>`SUM(CASE WHEN ${people.isActive} = 1 AND ${people.mappedCompanyId} IS NOT NULL THEN 1 ELSE 0 END)`,
        })
        .from(people),
      matchStatsPromise,
    ]);

    const jobStats = jobStatsResult[0];
    const companyStats = companyStatsResult[0];
    const lastSession = lastSessionResult;
    const peopleStats = peopleStatsResult[0];
    const matchStats = matchStatsResult[0];

    const unmatchedSummary = (peopleStats?.totalPeople ?? 0) > 0
      ? await getUnmatchedCompaniesSummary()
      : { unmatchedCompanyCount: 0, unmatchedPeopleCount: 0, ignoredCompanyCount: 0 };

    return NextResponse.json({
      totalJobs: jobStats?.totalJobs ?? 0,
      totalCompanies: companyStats?.totalCompanies ?? 0,
      highMatchJobs: Number(matchStats?.highMatchJobs ?? 0),
      appliedJobs: jobStats?.appliedJobs ?? 0,
      newJobs: jobStats?.newJobs ?? 0,
      viewedJobs: jobStats?.viewedJobs ?? 0,
      savedJobs: jobStats?.savedJobs ?? 0,
      jobsWithScore: matchStats?.jobsWithScore ?? 0,
      lastScan: lastSession[0] || null,
      totalPeople: peopleStats?.totalPeople ?? 0,
      starredPeople: peopleStats?.starredPeople ?? 0,
      mappedPeople: peopleStats?.mappedPeople ?? 0,
      unmatchedCompanyCount: unmatchedSummary.unmatchedCompanyCount,
      unmatchedPeopleCount: unmatchedSummary.unmatchedPeopleCount,
    });
  } catch (error) {
    console.error("Failed to fetch stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
