import { db } from "@/lib/db";
import { jobs, companies, scrapeSessions } from "@/lib/db/schema";
import { count, sql, desc } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const [jobStats] = await db
      .select({
        totalJobs: count(),
        highMatchJobs: sql<number>`SUM(CASE WHEN ${jobs.matchScore} >= 75 THEN 1 ELSE 0 END)`,
        appliedJobs: sql<number>`SUM(CASE WHEN ${jobs.status} = 'applied' THEN 1 ELSE 0 END)`,
        newJobs: sql<number>`SUM(CASE WHEN ${jobs.status} = 'new' THEN 1 ELSE 0 END)`,
        viewedJobs: sql<number>`SUM(CASE WHEN ${jobs.status} = 'viewed' THEN 1 ELSE 0 END)`,
        savedJobs: sql<number>`SUM(CASE WHEN ${jobs.status} = 'interested' THEN 1 ELSE 0 END)`,
        jobsWithScore: sql<number>`SUM(CASE WHEN ${jobs.matchScore} IS NOT NULL THEN 1 ELSE 0 END)`,
      })
      .from(jobs);

    const [companyStats] = await db
      .select({ totalCompanies: count() })
      .from(companies);

    const lastSession = await db
      .select()
      .from(scrapeSessions)
      .orderBy(desc(scrapeSessions.startedAt))
      .limit(1);

    return NextResponse.json({
      totalJobs: jobStats.totalJobs,
      totalCompanies: companyStats.totalCompanies,
      highMatchJobs: jobStats.highMatchJobs,
      appliedJobs: jobStats.appliedJobs,
      newJobs: jobStats.newJobs,
      viewedJobs: jobStats.viewedJobs,
      savedJobs: jobStats.savedJobs,
      jobsWithScore: jobStats.jobsWithScore,
      lastScan: lastSession[0] || null,
    });
  } catch (error) {
    console.error("Failed to fetch stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
