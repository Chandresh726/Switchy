import { and, count, desc, eq, gte, lte, sql } from "drizzle-orm";

import { getCurrentMatchContext } from "@/lib/ai/matcher/presentation";
import type { StatsResponse } from "@/lib/api/contracts/stats";
import { db } from "@/lib/db";
import { companies, jobs, matchResults, people, scrapeSessions } from "@/lib/db/schema";
import { getUnmatchedCompaniesSummary } from "@/lib/people/sync/unmatched";

const DAY_MS = 24 * 60 * 60 * 1_000;

type DashboardStats = Omit<StatsResponse, "lastScan"> & {
  lastScan: typeof scrapeSessions.$inferSelect | null;
};

export async function getDashboardStats(
  days: 7 | 30 | 90 = 7,
  now: Date = new Date()
): Promise<DashboardStats> {
  const periodStart = new Date(now.getTime() - days * DAY_MS);
  const discoveredInPeriod = and(gte(jobs.discoveredAt, periodStart), lte(jobs.discoveredAt, now));
  const viewedInPeriod = and(gte(jobs.viewedAt, periodStart), lte(jobs.viewedAt, now));
  const appliedInPeriod = and(gte(jobs.appliedAt, periodStart), lte(jobs.appliedAt, now));
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
    activeHighMatchJobs: sql<number>`coalesce(sum(case when ${jobs.status} not in ('rejected', 'archived') and ${effectiveScore} >= 70 then 1 else 0 end), 0)`,
    jobsWithScore: sql<number>`coalesce(sum(case when ${effectiveScore} is not null then 1 else 0 end), 0)`,
  }).from(jobs);
  const scoreStatsPromise = currentResultJoin
    ? scoreStatsQuery.leftJoin(matchResults, currentResultJoin)
    : scoreStatsQuery;

  const [
    jobStatsResult,
    companyStatsResult,
    lastSessionResult,
    peopleStatsResult,
    scoreStatsResult,
    recentJobsResult,
  ] = await Promise.all([
    db.select({
      totalJobs: count(),
      appliedJobs: sql<number>`coalesce(sum(case when ${jobs.status} = 'applied' then 1 else 0 end), 0)`,
      newJobs: sql<number>`coalesce(sum(case when ${jobs.status} = 'new' then 1 else 0 end), 0)`,
      viewedJobs: sql<number>`coalesce(sum(case when ${jobs.status} = 'viewed' then 1 else 0 end), 0)`,
      savedJobs: sql<number>`coalesce(sum(case when ${jobs.status} = 'interested' then 1 else 0 end), 0)`,
      rejectedJobs: sql<number>`coalesce(sum(case when ${jobs.status} = 'rejected' then 1 else 0 end), 0)`,
      archivedJobs: sql<number>`coalesce(sum(case when ${jobs.status} = 'archived' then 1 else 0 end), 0)`,
      activeJobs: sql<number>`coalesce(sum(case when ${jobs.status} not in ('rejected', 'archived') then 1 else 0 end), 0)`,
    }).from(jobs),
    db.select({ totalCompanies: count() }).from(companies),
    db.select().from(scrapeSessions)
      .orderBy(desc(scrapeSessions.startedAt), desc(scrapeSessions.id))
      .limit(1),
    db.select({
      totalPeople: sql<number>`coalesce(sum(case when ${people.isActive} = 1 and ${people.archivedAt} is null then 1 else 0 end), 0)`,
      starredPeople: sql<number>`coalesce(sum(case when ${people.isActive} = 1 and ${people.archivedAt} is null and ${people.isStarred} = 1 then 1 else 0 end), 0)`,
      mappedPeople: sql<number>`coalesce(sum(case when ${people.isActive} = 1 and ${people.archivedAt} is null and ${people.mappedCompanyId} is not null then 1 else 0 end), 0)`,
    }).from(people),
    scoreStatsPromise,
    db.select({
      discovered: sql<number>`coalesce(sum(case when ${discoveredInPeriod} then 1 else 0 end), 0)`,
      viewed: sql<number>`coalesce(sum(case when ${viewedInPeriod} then 1 else 0 end), 0)`,
      applied: sql<number>`coalesce(sum(case when ${appliedInPeriod} then 1 else 0 end), 0)`,
    }).from(jobs),
  ]);
  const jobStats = jobStatsResult[0];
  const companyStats = companyStatsResult[0];
  const peopleStats = peopleStatsResult[0];
  const scoreStats = scoreStatsResult[0];
  const recentJobs = recentJobsResult[0];
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
    period: {
      days,
      start: periodStart.toISOString(),
      end: now.toISOString(),
    },
    activeJobs: Number(jobStats?.activeJobs ?? 0),
    activeHighMatchJobs: Number(scoreStats?.activeHighMatchJobs ?? 0),
    statusCounts: {
      new: Number(jobStats?.newJobs ?? 0),
      viewed: Number(jobStats?.viewedJobs ?? 0),
      interested: Number(jobStats?.savedJobs ?? 0),
      applied: Number(jobStats?.appliedJobs ?? 0),
      rejected: Number(jobStats?.rejectedJobs ?? 0),
      archived: Number(jobStats?.archivedJobs ?? 0),
    },
    recentActivity: {
      discovered: Number(recentJobs?.discovered ?? 0),
      viewed: Number(recentJobs?.viewed ?? 0),
      applied: Number(recentJobs?.applied ?? 0),
    },
  };
}
