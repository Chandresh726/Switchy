import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { matchSessions, matchLogs, jobs, companies } from "@/lib/db/schema";
import { and, eq, desc, count, inArray } from "drizzle-orm";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

/**
 * GET /api/match-history
 * Returns match sessions and their logs
 *
 * Query params:
 * - sessionId: Get details for a specific session
 * - limit: Number of sessions to return (default 50)
 * - offset: Pagination offset (default 0)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    // If sessionId is provided, return session details with all logs
    if (sessionId) {
      const [session] = await db
        .select({
          id: matchSessions.id,
          triggerSource: matchSessions.triggerSource,
          companyId: matchSessions.companyId,
          companyName: companies.name,
          status: matchSessions.status,
          jobsTotal: matchSessions.jobsTotal,
          jobsCompleted: matchSessions.jobsCompleted,
          jobsSucceeded: matchSessions.jobsSucceeded,
          jobsFailed: matchSessions.jobsFailed,
          errorCount: matchSessions.errorCount,
          startedAt: matchSessions.startedAt,
          completedAt: matchSessions.completedAt,
        })
        .from(matchSessions)
        .leftJoin(companies, eq(matchSessions.companyId, companies.id))
        .where(eq(matchSessions.id, sessionId));

      if (!session) {
        return NextResponse.json(
          { error: "Session not found" },
          { status: 404, headers: NO_STORE_HEADERS }
        );
      }

      // Get all logs for this session
      const logs = await db
        .select({
          id: matchLogs.id,
          sessionId: matchLogs.sessionId,
          jobId: matchLogs.jobId,
          jobTitle: jobs.title,
          companyName: companies.name,
          status: matchLogs.status,
          score: matchLogs.score,
          attemptCount: matchLogs.attemptCount,
          errorType: matchLogs.errorType,
          errorMessage: matchLogs.errorMessage,
          duration: matchLogs.duration,
          modelUsed: matchLogs.modelUsed,
          completedAt: matchLogs.completedAt,
        })
        .from(matchLogs)
        .leftJoin(jobs, eq(matchLogs.jobId, jobs.id))
        .leftJoin(companies, eq(jobs.companyId, companies.id))
        .where(eq(matchLogs.sessionId, sessionId))
        .orderBy(desc(matchLogs.completedAt));

      return NextResponse.json({
        session,
        logs,
      }, { headers: NO_STORE_HEADERS });
    }

    // Return paginated list of sessions with stats
    const sessions = await db
      .select({
        id: matchSessions.id,
        triggerSource: matchSessions.triggerSource,
        companyId: matchSessions.companyId,
        companyName: companies.name,
        status: matchSessions.status,
        jobsTotal: matchSessions.jobsTotal,
        jobsCompleted: matchSessions.jobsCompleted,
        jobsSucceeded: matchSessions.jobsSucceeded,
        jobsFailed: matchSessions.jobsFailed,
        errorCount: matchSessions.errorCount,
        startedAt: matchSessions.startedAt,
        completedAt: matchSessions.completedAt,
      })
      .from(matchSessions)
      .leftJoin(companies, eq(matchSessions.companyId, companies.id))
      .orderBy(desc(matchSessions.startedAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const [totalResult] = await db
      .select({ count: count() })
      .from(matchSessions);
    const total = totalResult?.count || 0;

    // Calculate aggregate stats
    const allSessions = await db
      .select({
        status: matchSessions.status,
        jobsSucceeded: matchSessions.jobsSucceeded,
        jobsTotal: matchSessions.jobsTotal,
        startedAt: matchSessions.startedAt,
        completedAt: matchSessions.completedAt,
      })
      .from(matchSessions);

    const completedSessions = allSessions.filter(
      (s) => s.status === "completed"
    );
    const totalJobsMatched = allSessions.reduce(
      (sum, s) => sum + (s.jobsSucceeded || 0),
      0
    );
    const totalJobsAttempted = allSessions.reduce(
      (sum, s) => sum + (s.jobsTotal || 0),
      0
    );
    const successRate = totalJobsAttempted > 0
      ? Math.round((totalJobsMatched / totalJobsAttempted) * 100)
      : 0;

    // Calculate average duration for completed sessions
    let avgDuration = 0;
    if (completedSessions.length > 0) {
      const durations = completedSessions
        .filter((s) => s.startedAt && s.completedAt)
        .map((s) => {
          const start = new Date(s.startedAt!).getTime();
          const end = new Date(s.completedAt!).getTime();
          return end - start;
        });
      if (durations.length > 0) {
        avgDuration = Math.round(
          durations.reduce((a, b) => a + b, 0) / durations.length
        );
      }
    }

    return NextResponse.json({
      sessions,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + sessions.length < total,
      },
      stats: {
        totalSessions: total,
        successRate,
        avgDuration,
        totalJobsMatched,
      },
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[Match History API] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch match history" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    if (sessionId) {
      await db.delete(matchSessions).where(eq(matchSessions.id, sessionId));
      return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
    } else {
      await db.delete(matchSessions);
      return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
    }
  } catch (error) {
    console.error("Failed to delete match history:", error);
    return NextResponse.json(
      { error: "Failed to delete match history" },
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

    const updated = await db
      .update(matchSessions)
      .set({
        status: "failed",
        completedAt: new Date(),
      })
      .where(
        and(
          eq(matchSessions.id, sessionId),
          inArray(matchSessions.status, ["in_progress", "queued"])
        )
      )
      .returning({ id: matchSessions.id });

    if (updated.length > 0) {
      return NextResponse.json({ success: true, stopped: true }, { headers: NO_STORE_HEADERS });
    }

    const [session] = await db
      .select({ id: matchSessions.id, status: matchSessions.status })
      .from(matchSessions)
      .where(eq(matchSessions.id, sessionId));

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
    console.error("Failed to stop match session:", error);
    return NextResponse.json(
      { error: "Failed to stop match session" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
