import { NextRequest, NextResponse } from "next/server";
import { count, desc, eq, inArray, sql } from "drizzle-orm";

import { MatchBreakdownSchema, MatchEvidenceSchema } from "@/lib/ai/artifacts";
import { getMatchPresentations } from "@/lib/ai/matcher/presentation";
import { assertAppRequest } from "@/lib/api";
import { db } from "@/lib/db";
import {
  companies,
  jobs,
  matchLogs,
  matchResults,
  matchSessions,
} from "@/lib/db/schema";
import { getLocalDataMaintenanceService } from "@/lib/scraper/maintenance";
import { stopMatchSession } from "@/lib/scraper/matching/lifecycle";
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
          matchResultId: matchLogs.matchResultId,
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

      const loggedJobIds = Array.from(new Set(logs
        .map((log) => log.jobId)
        .filter((jobId): jobId is number => jobId !== null)));
      const resultIds = Array.from(new Set(logs
        .map((log) => log.matchResultId)
        .filter((resultId): resultId is string => resultId !== null)));
      const historicalResults = resultIds.length === 0
        ? []
        : await db.select().from(matchResults)
            .where(inArray(matchResults.id, resultIds));
      const currentJobs = loggedJobIds.length === 0
        ? []
        : await db.select({
            id: jobs.id,
            title: jobs.title,
            description: jobs.description,
            location: jobs.location,
            locationType: jobs.locationType,
            seniorityLevel: jobs.seniorityLevel,
            department: jobs.department,
            employmentType: jobs.employmentType,
            salary: jobs.salary,
          }).from(jobs).where(inArray(jobs.id, loggedJobIds));
      const currentPresentations = await getMatchPresentations(
        currentJobs,
        undefined,
        { includeStale: false }
      );
      const resultsById = new Map(historicalResults.map((result) => [result.id, result]));
      const presentedLogs = logs.map((log) => {
        const result = log.status === "success" && log.matchResultId
          ? resultsById.get(log.matchResultId)
          : undefined;
        if (!result) {
          return {
            ...log,
            matchResultId: null,
            matchConfidence: null,
            matchBreakdown: null,
            matchStale: log.score !== null,
            scoringPolicyVersion: null,
          };
        }
        const evidence = MatchEvidenceSchema.parse(JSON.parse(result.evidenceJson));
        const current = currentPresentations.get(result.jobId);
        return {
          ...log,
          score: result.score,
          reasons: evidence.reasons,
          matchedSkills: evidence.matchedSkills,
          missingSkills: evidence.missingSkills,
          recommendations: evidence.recommendations,
          matchResultId: result.id,
          matchConfidence: result.confidence,
          matchBreakdown: MatchBreakdownSchema.parse(JSON.parse(result.breakdownJson)),
          matchStale: !current || current.matchResultId !== result.id || current.matchStale,
          scoringPolicyVersion: result.scoringPolicyVersion,
        };
      });

      return NextResponse.json({
        session,
        logs: presentedLogs,
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

    const [statsResult] = await db
      .select({
        totalJobsMatched: sql<number>`coalesce(sum(${matchSessions.jobsSucceeded}), 0)`,
        totalJobsAttempted: sql<number>`coalesce(sum(${matchSessions.jobsTotal}), 0)`,
        avgDuration: sql<number>`coalesce(avg(case when ${matchSessions.status} = 'completed' and ${matchSessions.startedAt} is not null and ${matchSessions.completedAt} is not null then (${matchSessions.completedAt} - ${matchSessions.startedAt}) * 1000 end), 0)`,
      })
      .from(matchSessions);

    const totalJobsMatched = Number(statsResult?.totalJobsMatched ?? 0);
    const totalJobsAttempted = Number(statsResult?.totalJobsAttempted ?? 0);
    const successRate = totalJobsAttempted > 0
      ? Math.round((totalJobsMatched / totalJobsAttempted) * 100)
      : 0;
    const avgDuration = Math.round(Number(statsResult?.avgDuration ?? 0));

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
    assertAppRequest(request);

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    await getLocalDataMaintenanceService().deleteMatchHistory(
      sessionId ?? undefined
    );
    return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
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
    assertAppRequest(request);

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const result = await stopMatchSession(sessionId);
    if (result.stopped) {
      return NextResponse.json({ success: true, stopped: true }, { headers: NO_STORE_HEADERS });
    }
    if (!result.exists) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      { success: true, stopped: false, status: result.status },
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
