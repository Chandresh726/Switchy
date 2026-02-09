import { db } from "@/lib/db";
import { jobs, companies, scrapeSessions } from "@/lib/db/schema";
import { count, gte, eq, desc, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const [
      totalJobsResult,
      totalCompaniesResult,
      highMatchResult,
      appliedResult,
      newJobsResult,
      viewedJobsResult,
      savedJobsResult,
      jobsWithScoreResult,
      lastSession,
    ] = await Promise.all([
      db.select({ count: count() }).from(jobs),
      db.select({ count: count() }).from(companies),
      db.select({ count: count() }).from(jobs).where(gte(jobs.matchScore, 75)),
      db.select({ count: count() }).from(jobs).where(eq(jobs.status, "applied")),
      db.select({ count: count() }).from(jobs).where(eq(jobs.status, "new")),
      db.select({ count: count() }).from(jobs).where(eq(jobs.status, "viewed")),
      db.select({ count: count() }).from(jobs).where(eq(jobs.status, "interested")),
      db.select({ count: count() }).from(jobs).where(isNotNull(jobs.matchScore)),
      db.select().from(scrapeSessions).orderBy(desc(scrapeSessions.startedAt)).limit(1),
    ]);

    return NextResponse.json({
      totalJobs: totalJobsResult[0].count,
      totalCompanies: totalCompaniesResult[0].count,
      highMatchJobs: highMatchResult[0].count,
      appliedJobs: appliedResult[0].count,
      newJobs: newJobsResult[0].count,
      viewedJobs: viewedJobsResult[0].count,
      savedJobs: savedJobsResult[0].count,
      jobsWithScore: jobsWithScoreResult[0].count,
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
