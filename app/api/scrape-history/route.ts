import { db } from "@/lib/db";
import { scrapeSessions, scrapingLogs, companies } from "@/lib/db/schema";
import { getScrapingModule } from "@/lib/scraper";
import { desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = parseInt(searchParams.get("offset") || "0");
    const sessionId = searchParams.get("sessionId");

    if (sessionId) {
      // Get specific session with all its logs
      const [session] = await db
        .select()
        .from(scrapeSessions)
        .where(eq(scrapeSessions.id, sessionId));

      if (!session) {
        return NextResponse.json({ error: "Session not found" }, { status: 404, headers: NO_STORE_HEADERS });
      }

      // Get all logs for this session with company info
      const logs = await db
        .select({
          id: scrapingLogs.id,
          companyId: scrapingLogs.companyId,
          companyName: companies.name,
          companyLogoUrl: companies.logoUrl,
          platform: scrapingLogs.platform,
          status: scrapingLogs.status,
          jobsFound: scrapingLogs.jobsFound,
          jobsAdded: scrapingLogs.jobsAdded,
          jobsUpdated: scrapingLogs.jobsUpdated,
          jobsFiltered: scrapingLogs.jobsFiltered,
          jobsArchived: scrapingLogs.jobsArchived,
          errorMessage: scrapingLogs.errorMessage,
          duration: scrapingLogs.duration,
          startedAt: scrapingLogs.startedAt,
          completedAt: scrapingLogs.completedAt,
          matcherStatus: scrapingLogs.matcherStatus,
          matcherJobsTotal: scrapingLogs.matcherJobsTotal,
          matcherJobsCompleted: scrapingLogs.matcherJobsCompleted,
          matcherDuration: scrapingLogs.matcherDuration,
          matcherErrorCount: scrapingLogs.matcherErrorCount,
        })
        .from(scrapingLogs)
        .leftJoin(companies, eq(scrapingLogs.companyId, companies.id))
        .where(eq(scrapingLogs.sessionId, sessionId))
        .orderBy(scrapingLogs.startedAt);

      return NextResponse.json({ session, logs }, { headers: NO_STORE_HEADERS });
    }

    // Get all sessions with summary stats
    const sessions = await db
      .select()
      .from(scrapeSessions)
      .orderBy(desc(scrapeSessions.startedAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(scrapeSessions);

    // Get aggregated stats
    const [stats] = await db
      .select({
        totalSessions: sql<number>`count(*)`,
        successRate: sql<number>`ROUND(CAST(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) * 100, 1)`,
        avgDuration: sql<number>`ROUND(AVG((completed_at - started_at) * 1000), 0)`,
      })
      .from(scrapeSessions);

    return NextResponse.json({
      sessions,
      pagination: {
        total: count,
        limit,
        offset,
        hasMore: offset + limit < count,
      },
      stats: {
        totalSessions: stats?.totalSessions || 0,
        successRate: stats?.successRate || 0,
        avgDuration: stats?.avgDuration || 0,
      },
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("Failed to fetch scrape history:", error);
    return NextResponse.json(
      { error: "Failed to fetch scrape history" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    if (sessionId) {
      await db.delete(scrapeSessions).where(eq(scrapeSessions.id, sessionId));
      return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
    } else {
      await db.delete(scrapeSessions);
      return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
    }
  } catch (error) {
    console.error("Failed to delete scrape history:", error);
    return NextResponse.json(
      { error: "Failed to delete scrape history" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const { repository } = getScrapingModule();
    const stopped = await repository.stopSession(sessionId);

    if (stopped) {
      return NextResponse.json({ success: true, stopped: true }, { headers: NO_STORE_HEADERS });
    }

    const [session] = await db
      .select({ id: scrapeSessions.id, status: scrapeSessions.status })
      .from(scrapeSessions)
      .where(eq(scrapeSessions.id, sessionId));

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      { success: true, stopped: false, status: session.status },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("Failed to stop scrape session:", error);
    return NextResponse.json(
      { error: "Failed to stop scrape session" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
