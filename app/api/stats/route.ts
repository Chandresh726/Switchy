import { db } from "@/lib/db";
import { jobs, companies, scrapeSessions, linkedinConnections } from "@/lib/db/schema";
import { count, sql, desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getUnmatchedCompaniesSummary } from "@/lib/connections/sync/unmatched";

export async function GET() {
  try {
    const [jobStatsResult, companyStatsResult, lastSessionResult, connectionStatsResult] = await Promise.all([
      db
        .select({
          totalJobs: count(),
          highMatchJobs: sql<number>`SUM(CASE WHEN ${jobs.matchScore} >= 75 THEN 1 ELSE 0 END)`,
          appliedJobs: sql<number>`SUM(CASE WHEN ${jobs.status} = 'applied' THEN 1 ELSE 0 END)`,
          newJobs: sql<number>`SUM(CASE WHEN ${jobs.status} = 'new' THEN 1 ELSE 0 END)`,
          viewedJobs: sql<number>`SUM(CASE WHEN ${jobs.status} = 'viewed' THEN 1 ELSE 0 END)`,
          savedJobs: sql<number>`SUM(CASE WHEN ${jobs.status} = 'interested' THEN 1 ELSE 0 END)`,
          jobsWithScore: sql<number>`SUM(CASE WHEN ${jobs.matchScore} IS NOT NULL THEN 1 ELSE 0 END)`,
        })
        .from(jobs),
      db.select({ totalCompanies: count() }).from(companies),
      db.select().from(scrapeSessions).orderBy(desc(scrapeSessions.startedAt)).limit(1),
      db
        .select({
          totalConnections: sql<number>`SUM(CASE WHEN ${linkedinConnections.isActive} = 1 THEN 1 ELSE 0 END)`,
          starredConnections: sql<number>`SUM(CASE WHEN ${linkedinConnections.isActive} = 1 AND ${linkedinConnections.isStarred} = 1 THEN 1 ELSE 0 END)`,
          mappedConnections: sql<number>`SUM(CASE WHEN ${linkedinConnections.isActive} = 1 AND ${linkedinConnections.mappedCompanyId} IS NOT NULL THEN 1 ELSE 0 END)`,
        })
        .from(linkedinConnections),
    ]);

    const jobStats = jobStatsResult[0];
    const companyStats = companyStatsResult[0];
    const lastSession = lastSessionResult;
    const connectionStats = connectionStatsResult[0];

    const unmatchedSummary = (connectionStats?.totalConnections ?? 0) > 0
      ? await getUnmatchedCompaniesSummary()
      : { unmatchedCompanyCount: 0, unmatchedConnectionCount: 0, ignoredCompanyCount: 0 };

    return NextResponse.json({
      totalJobs: jobStats?.totalJobs ?? 0,
      totalCompanies: companyStats?.totalCompanies ?? 0,
      highMatchJobs: jobStats?.highMatchJobs ?? 0,
      appliedJobs: jobStats?.appliedJobs ?? 0,
      newJobs: jobStats?.newJobs ?? 0,
      viewedJobs: jobStats?.viewedJobs ?? 0,
      savedJobs: jobStats?.savedJobs ?? 0,
      jobsWithScore: jobStats?.jobsWithScore ?? 0,
      lastScan: lastSession[0] || null,
      totalConnections: connectionStats?.totalConnections ?? 0,
      starredConnections: connectionStats?.starredConnections ?? 0,
      mappedConnections: connectionStats?.mappedConnections ?? 0,
      unmatchedCompanyCount: unmatchedSummary.unmatchedCompanyCount,
    });
  } catch (error) {
    console.error("Failed to fetch stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
