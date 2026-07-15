import { NextResponse } from "next/server";

import { and, count, desc, eq, sql } from "drizzle-orm";

import { ensureJobFingerprintProjection } from "@/lib/ai/artifacts/job-fingerprint-projection";
import { getCurrentMatchContext } from "@/lib/ai/matcher/presentation";
import { countPromotedMatchRows } from "@/lib/ai/matcher/promotion";
import { db } from "@/lib/db";
import { companies, jobs, matchResults, people, scrapeSessions } from "@/lib/db/schema";
import { getUnmatchedCompaniesSummary } from "@/lib/people/sync/unmatched";

export async function GET() {
  try {
    ensureJobFingerprintProjection();
    const currentContext = await getCurrentMatchContext();
    const matchStatsPromise = currentContext
      ? db.select({
          evidenceJson: matchResults.evidenceJson,
          legacyScore: jobs.matchScore,
        }).from(jobs).leftJoin(matchResults, and(
          eq(matchResults.jobId, jobs.id),
          eq(matchResults.candidateFingerprint, currentContext.candidateFingerprint),
          eq(matchResults.jobFingerprint, jobs.aiFingerprint),
          eq(matchResults.scoringPolicyVersion, currentContext.scoringPolicyVersion),
          eq(matchResults.isStale, false)
        ))
      : db.select({
          evidenceJson: sql<string | null>`null`,
          legacyScore: jobs.matchScore,
        }).from(jobs);
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
    const highMatchJobs = countPromotedMatchRows(matchStatsResult);
    const jobsWithScore = matchStatsResult.filter((row) =>
      row.evidenceJson !== null || row.legacyScore !== null
    ).length;

    const unmatchedSummary = (peopleStats?.totalPeople ?? 0) > 0
      ? await getUnmatchedCompaniesSummary()
      : { unmatchedCompanyCount: 0, unmatchedPeopleCount: 0, ignoredCompanyCount: 0 };

    return NextResponse.json({
      totalJobs: jobStats?.totalJobs ?? 0,
      totalCompanies: companyStats?.totalCompanies ?? 0,
      highMatchJobs,
      appliedJobs: jobStats?.appliedJobs ?? 0,
      newJobs: jobStats?.newJobs ?? 0,
      viewedJobs: jobStats?.viewedJobs ?? 0,
      savedJobs: jobStats?.savedJobs ?? 0,
      jobsWithScore,
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
