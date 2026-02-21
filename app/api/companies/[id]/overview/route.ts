import { and, desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { handleApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { companies, jobs, linkedinConnections, matchSessions, scrapingLogs } from "@/lib/db/schema";

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

    const [
      jobStatsResult,
      connectionStatsResult,
      companyJobs,
      companyConnections,
      recentScrapeLogs,
      recentMatchSessions,
    ] = await Promise.all([
      db
        .select({
          openJobs: sql<number>`count(*)`,
          highMatchJobs: sql<number>`sum(case when ${jobs.matchScore} >= 75 then 1 else 0 end)`,
        })
        .from(jobs)
        .where(eq(jobs.companyId, parsedParams.id)),
      db
        .select({
          mappedConnections: sql<number>`count(*)`,
          starredConnections: sql<number>`sum(case when ${linkedinConnections.isStarred} = 1 then 1 else 0 end)`,
        })
        .from(linkedinConnections)
        .where(
          and(
            eq(linkedinConnections.mappedCompanyId, parsedParams.id),
            eq(linkedinConnections.isActive, true)
          )
        ),
      db
        .select({
          id: jobs.id,
          title: jobs.title,
          url: jobs.url,
          status: jobs.status,
          matchScore: jobs.matchScore,
          location: jobs.location,
          locationType: jobs.locationType,
          discoveredAt: jobs.discoveredAt,
        })
        .from(jobs)
        .where(eq(jobs.companyId, parsedParams.id))
        .orderBy(desc(jobs.discoveredAt))
        .limit(50),
      db
        .select({
          id: linkedinConnections.id,
          fullName: linkedinConnections.fullName,
          firstName: linkedinConnections.firstName,
          lastName: linkedinConnections.lastName,
          profileUrl: linkedinConnections.profileUrl,
          email: linkedinConnections.email,
          position: linkedinConnections.position,
          connectedOn: linkedinConnections.connectedOn,
          isStarred: linkedinConnections.isStarred,
          notes: linkedinConnections.notes,
        })
        .from(linkedinConnections)
        .where(
          and(
            eq(linkedinConnections.mappedCompanyId, parsedParams.id),
            eq(linkedinConnections.isActive, true)
          )
        )
        .orderBy(desc(linkedinConnections.isStarred), linkedinConnections.fullName)
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
    const connectionStats = connectionStatsResult[0];

    return NextResponse.json({
      company,
      stats: {
        openJobs: jobStats?.openJobs || 0,
        highMatchJobs: jobStats?.highMatchJobs || 0,
        mappedConnections: connectionStats?.mappedConnections || 0,
        starredConnections: connectionStats?.starredConnections || 0,
      },
      jobs: companyJobs,
      connections: companyConnections,
      activity: {
        scrapeLogs: recentScrapeLogs,
        matchSessions: recentMatchSessions,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
