import { NextRequest, NextResponse } from "next/server";
import { count, desc, eq, inArray, sql } from "drizzle-orm";

import { MatchBreakdownSchema, MatchEvidenceSchema } from "@/lib/ai/artifacts";
import { getMatchPresentations } from "@/lib/ai/matcher/presentation";
import { getMatchPipelineProgress } from "@/lib/ai/matcher/tracking";
import { getAIRunSummaries } from "@/lib/ai/observability";
import {
  assertAppRequest,
  handleApiError,
  NotFoundError,
} from "@/lib/api";
import { historyQuerySchema, historySessionQuerySchema } from "@/lib/api/contracts/history";
import { db } from "@/lib/db";
import {
  companies,
  jobAnalyses,
  jobs,
  matchLogs,
  matchResults,
  matchSessions,
} from "@/lib/db/schema";
import { loadSqliteParameterChunks } from "@/lib/db/sqlite-utils";
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
    const query = historyQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const { sessionId, limit, offset } = query;

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
        throw new NotFoundError("Session not found", "match_session_not_found");
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
      const historicalResults = await loadSqliteParameterChunks(resultIds, (resultIdChunk) =>
        db.select().from(matchResults)
          .where(inArray(matchResults.id, resultIdChunk))
      );
      const analysisIds = Array.from(new Set(historicalResults
        .map((result) => result.jobAnalysisId)
        .filter((analysisId): analysisId is string => typeof analysisId === "string")));
      const analyses = await loadSqliteParameterChunks(analysisIds, (analysisIdChunk) =>
        db.select({
            id: jobAnalyses.id,
            aiRunId: jobAnalyses.aiRunId,
          }).from(jobAnalyses).where(inArray(jobAnalyses.id, analysisIdChunk))
      );
      const analysisById = new Map(analyses.map((analysis) => [analysis.id, analysis]));
      const runSummaries = await getAIRunSummaries(historicalResults.flatMap((result) => {
        const analysisRunId = result.jobAnalysisId
          ? analysisById.get(result.jobAnalysisId)?.aiRunId
          : null;
        return [result.matchRunId, result.adjudicationRunId, analysisRunId]
          .filter((runId): runId is string => runId !== null && runId !== undefined);
      }));
      const currentJobs = await loadSqliteParameterChunks(loggedJobIds, (jobIdChunk) =>
        db.select({
            id: jobs.id,
            title: jobs.title,
            description: jobs.description,
            location: jobs.location,
            locationType: jobs.locationType,
            seniorityLevel: jobs.seniorityLevel,
            department: jobs.department,
            employmentType: jobs.employmentType,
            salary: jobs.salary,
            matchScore: jobs.matchScore,
            matchReasons: jobs.matchReasons,
            matchedSkills: jobs.matchedSkills,
          }).from(jobs).where(inArray(jobs.id, jobIdChunk))
      );
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
            matchBreakdown: null,
            matchStale: log.score !== null,
            matchSummary: "",
            matchReasoning: [],
            matchedSkills: [],
            scoringPolicyVersion: null,
            analysisRunId: null,
            analysisRun: null,
            adjudicationRunId: null,
            adjudicationRun: null,
            matchRunId: null,
            matchRun: null,
          };
        }
        const evidence = MatchEvidenceSchema.parse(JSON.parse(result.evidenceJson));
        const current = currentPresentations.get(result.jobId);
        const analysisRunId = result.jobAnalysisId
          ? analysisById.get(result.jobAnalysisId)?.aiRunId ?? null
          : null;
        return {
          ...log,
          score: result.score,
          reasons: evidence.reasoning.map((point) => point.text),
          matchedSkills: evidence.matchedSkills,
          matchResultId: result.id,
          matchBreakdown: MatchBreakdownSchema.parse(JSON.parse(result.breakdownJson)),
          matchStale: !current || current.matchResultId !== result.id || current.matchStale,
          matchSummary: evidence.summary,
          matchReasoning: evidence.reasoning,
          scoringPolicyVersion: result.scoringPolicyVersion,
          analysisRunId,
          analysisRun: analysisRunId ? runSummaries.get(analysisRunId) ?? null : null,
          adjudicationRunId: result.adjudicationRunId,
          adjudicationRun: result.adjudicationRunId
            ? runSummaries.get(result.adjudicationRunId) ?? null
            : null,
          matchRunId: result.matchRunId,
          matchRun: result.matchRunId
            ? runSummaries.get(result.matchRunId) ?? null
            : null,
          matchPolicyVersion: result.matchPolicyVersion ?? result.scoringPolicyVersion,
        };
      });

      const pipeline = await getMatchPipelineProgress(sessionId);
      return NextResponse.json({
        session,
        logs: presentedLogs,
        pipeline,
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
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch match history", fallbackCode: "match_history_fetch_failed", headers: NO_STORE_HEADERS });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);

    const { sessionId } = historyQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams)
    );

    const deleted = await getLocalDataMaintenanceService().deleteMatchHistory(
      sessionId
    );
    if (sessionId && deleted === 0) {
      throw new NotFoundError("Session not found", "match_session_not_found");
    }
    return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete match history", fallbackCode: "match_history_delete_failed", headers: NO_STORE_HEADERS });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertAppRequest(request);

    const { sessionId } = historySessionQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams)
    );

    const result = await stopMatchSession(sessionId);
    if (result.stopped) {
      return NextResponse.json({ success: true, stopped: true }, { headers: NO_STORE_HEADERS });
    }
    if (!result.exists) {
      throw new NotFoundError("Session not found", "match_session_not_found");
    }

    return NextResponse.json(
      { success: true, stopped: false, status: result.status },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to stop match session", fallbackCode: "match_session_stop_failed", headers: NO_STORE_HEADERS });
  }
}
