import { and, count, desc, eq, sql } from "drizzle-orm";

import { getCurrentMatchContext } from "@/lib/ai/matcher/presentation";
import { db } from "@/lib/db";
import { companies, jobs, matchResults, people, scrapeSessions } from "@/lib/db/schema";
import { getUnmatchedCompaniesSummary } from "@/lib/people/sync/unmatched";

export async function getDashboardStats() {
  const currentContext = await getCurrentMatchContext();
  const currentResultJoin = currentContext ? and(
    eq(matchResults.jobId, jobs.id),
    eq(matchResults.candidateFingerprint, currentContext.candidateFingerprint),
    eq(matchResults.isStale, false)
  ) : undefined;
  const effectiveScore = currentContext
    ? sql<number | null>`coalesce(${matchResults.score}, ${jobs.matchScore})`
    : jobs.matchScore;
  const scoreStatsQuery = db.select({
    highMatchJobs: sql<number>`coalesce(sum(case when ${effectiveScore} >= 70 then 1 else 0 end), 0)`,
    jobsWithScore: sql<number>`coalesce(sum(case when ${effectiveScore} is not null then 1 else 0 end), 0)`,
  }).from(jobs);
  const scoreStatsPromise = currentResultJoin
    ? scoreStatsQuery.leftJoin(matchResults, currentResultJoin)
    : scoreStatsQuery;

  const [jobStatsResult, companyStatsResult, lastSessionResult, peopleStatsResult, scoreStatsResult] = await Promise.all([
    db.select({
      totalJobs: count(),
      appliedJobs: sql<number>`coalesce(sum(case when ${jobs.status} = 'applied' then 1 else 0 end), 0)`,
      newJobs: sql<number>`coalesce(sum(case when ${jobs.status} = 'new' then 1 else 0 end), 0)`,
      viewedJobs: sql<number>`coalesce(sum(case when ${jobs.status} = 'viewed' then 1 else 0 end), 0)`,
      savedJobs: sql<number>`coalesce(sum(case when ${jobs.status} = 'interested' then 1 else 0 end), 0)`,
    }).from(jobs),
    db.select({ totalCompanies: count() }).from(companies),
    db.select().from(scrapeSessions)
      .orderBy(desc(scrapeSessions.startedAt), desc(scrapeSessions.id))
      .limit(1),
    db.select({
      totalPeople: sql<number>`coalesce(sum(case when ${people.isActive} = 1 then 1 else 0 end), 0)`,
      starredPeople: sql<number>`coalesce(sum(case when ${people.isActive} = 1 and ${people.isStarred} = 1 then 1 else 0 end), 0)`,
      mappedPeople: sql<number>`coalesce(sum(case when ${people.isActive} = 1 and ${people.mappedCompanyId} is not null then 1 else 0 end), 0)`,
    }).from(people),
    scoreStatsPromise,
  ]);
  const jobStats = jobStatsResult[0];
  const companyStats = companyStatsResult[0];
  const peopleStats = peopleStatsResult[0];
  const scoreStats = scoreStatsResult[0];
  const unmatchedSummary = (peopleStats?.totalPeople ?? 0) > 0
    ? await getUnmatchedCompaniesSummary()
    : { unmatchedCompanyCount: 0, unmatchedPeopleCount: 0 };

  return {
    totalJobs: jobStats?.totalJobs ?? 0,
    totalCompanies: companyStats?.totalCompanies ?? 0,
    highMatchJobs: Number(scoreStats?.highMatchJobs ?? 0),
    appliedJobs: Number(jobStats?.appliedJobs ?? 0),
    newJobs: Number(jobStats?.newJobs ?? 0),
    viewedJobs: Number(jobStats?.viewedJobs ?? 0),
    savedJobs: Number(jobStats?.savedJobs ?? 0),
    jobsWithScore: Number(scoreStats?.jobsWithScore ?? 0),
    lastScan: lastSessionResult[0] ?? null,
    totalPeople: Number(peopleStats?.totalPeople ?? 0),
    starredPeople: Number(peopleStats?.starredPeople ?? 0),
    mappedPeople: Number(peopleStats?.mappedPeople ?? 0),
    unmatchedCompanyCount: unmatchedSummary.unmatchedCompanyCount,
    unmatchedPeopleCount: unmatchedSummary.unmatchedPeopleCount,
  };
}
