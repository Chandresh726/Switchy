import { count, desc, eq, inArray, sql } from "drizzle-orm";

import { MatchBreakdownSchema, MatchEvidenceSchema } from "@/lib/ai/artifacts/schemas";
import { getMatchPresentations } from "@/lib/ai/matcher/presentation";
import { getMatchPipelineProgress } from "@/lib/ai/matcher/tracking";
import { getAIRunSummaries } from "@/lib/ai/observability";
import { ConflictError, NotFoundError } from "@/lib/api";
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
import { getLocalScrapeQueueService } from "@/lib/scraper";
import { getScrapeHistoryStore } from "@/lib/scraper/history";
import { getLocalDataMaintenanceService } from "@/lib/scraper/maintenance";
import { stopMatchSession } from "@/lib/scraper/matching/lifecycle";

export async function listMatchHistory(limit: number, offset: number) {
  const sessions = await db.select({
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
  }).from(matchSessions)
    .leftJoin(companies, eq(matchSessions.companyId, companies.id))
    .orderBy(desc(matchSessions.startedAt))
    .limit(limit)
    .offset(offset);
  const [{ value: total }] = await db.select({ value: count() }).from(matchSessions);
  const [stats] = await db.select({
    totalJobsMatched: sql<number>`coalesce(sum(${matchSessions.jobsSucceeded}), 0)`,
    totalJobsAttempted: sql<number>`coalesce(sum(${matchSessions.jobsTotal}), 0)`,
    avgDuration: sql<number>`coalesce(avg(case when ${matchSessions.status} = 'completed' and ${matchSessions.startedAt} is not null and ${matchSessions.completedAt} is not null then (${matchSessions.completedAt} - ${matchSessions.startedAt}) * 1000 end), 0)`,
  }).from(matchSessions);
  const totalJobsMatched = Number(stats?.totalJobsMatched ?? 0);
  const totalJobsAttempted = Number(stats?.totalJobsAttempted ?? 0);
  return {
    sessions,
    pagination: { total, limit, offset, hasMore: offset + sessions.length < total },
    stats: {
      totalSessions: total,
      successRate: totalJobsAttempted > 0 ? Math.round((totalJobsMatched / totalJobsAttempted) * 100) : 0,
      avgDuration: Math.round(Number(stats?.avgDuration ?? 0)),
      totalJobsMatched,
    },
  };
}

export function listScrapeHistory(limit: number, offset: number) {
  return getScrapeHistoryStore().list({ limit, offset });
}

export async function getMatchHistoryDetail(sessionId: string) {
  const [session] = await db.select({
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
  }).from(matchSessions)
    .leftJoin(companies, eq(matchSessions.companyId, companies.id))
    .where(eq(matchSessions.id, sessionId));
  if (!session) throw new NotFoundError("Session not found", "match_session_not_found");

  const logs = await db.select({
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
  }).from(matchLogs)
    .leftJoin(jobs, eq(matchLogs.jobId, jobs.id))
    .leftJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(matchLogs.sessionId, sessionId))
    .orderBy(desc(matchLogs.completedAt));

  const jobIds = Array.from(new Set(logs.flatMap((log) => log.jobId === null ? [] : [log.jobId])));
  const resultIds = Array.from(new Set(logs.flatMap((log) => log.matchResultId === null ? [] : [log.matchResultId])));
  const results = await loadSqliteParameterChunks(resultIds, (ids) =>
    db.select().from(matchResults).where(inArray(matchResults.id, ids))
  );
  const analysisIds = Array.from(new Set(results.flatMap((result) => result.jobAnalysisId ? [result.jobAnalysisId] : [])));
  const analyses = await loadSqliteParameterChunks(analysisIds, (ids) =>
    db.select({ id: jobAnalyses.id, aiRunId: jobAnalyses.aiRunId })
      .from(jobAnalyses).where(inArray(jobAnalyses.id, ids))
  );
  const analysisById = new Map(analyses.map((analysis) => [analysis.id, analysis]));
  const runSummaries = await getAIRunSummaries(results.flatMap((result) => {
    const analysisRunId = result.jobAnalysisId ? analysisById.get(result.jobAnalysisId)?.aiRunId : null;
    return [result.matchRunId, result.adjudicationRunId, analysisRunId]
      .filter((id): id is string => Boolean(id));
  }));
  const currentJobs = await loadSqliteParameterChunks(jobIds, (ids) =>
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
    }).from(jobs).where(inArray(jobs.id, ids))
  );
  const currentPresentations = await getMatchPresentations(currentJobs, undefined, { includeStale: false });
  const resultsById = new Map(results.map((result) => [result.id, result]));
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
      adjudicationRun: result.adjudicationRunId ? runSummaries.get(result.adjudicationRunId) ?? null : null,
      matchRunId: result.matchRunId,
      matchRun: result.matchRunId ? runSummaries.get(result.matchRunId) ?? null : null,
      matchPolicyVersion: result.matchPolicyVersion ?? result.scoringPolicyVersion,
    };
  });

  return { session, logs: presentedLogs, pipeline: await getMatchPipelineProgress(sessionId) };
}

export async function deleteMatchHistorySession(sessionId: string) {
  const deleted = await getLocalDataMaintenanceService().deleteMatchHistory(sessionId);
  if (deleted === 0) throw new NotFoundError("Session not found", "match_session_not_found");
  return { success: true };
}

export async function cancelMatchHistorySession(sessionId: string) {
  const result = await stopMatchSession(sessionId);
  if (result.stopped) return { success: true as const, stopped: true as const };
  if (!result.exists) throw new NotFoundError("Session not found", "match_session_not_found");
  return { success: true as const, stopped: false as const, status: result.status };
}

export function getScrapeHistoryDetail(sessionId: string) {
  const detail = getScrapeHistoryStore().getDetail(sessionId);
  if (!detail) throw new NotFoundError("Session not found", "scrape_session_not_found");
  return detail;
}

export function deleteScrapeHistorySession(sessionId: string) {
  const deletion = getScrapeHistoryStore().delete(sessionId);
  if (deletion.active) {
    throw new ConflictError("Stop the active scrape before deleting its history", "scrape_session_active");
  }
  if (deletion.deleted === 0) throw new NotFoundError("Session not found", "scrape_session_not_found");
  return { success: true, deleted: deletion.deleted };
}

export async function cancelScrapeHistorySession(sessionId: string) {
  const cancellation = await getLocalScrapeQueueService().cancelSession(sessionId);
  if (cancellation.sessionStopped) return { success: true, stopped: true };
  const session = getScrapeHistoryStore().getSessionStatus(sessionId);
  if (!session) throw new NotFoundError("Session not found", "scrape_session_not_found");
  return { success: true, stopped: false, status: session.status };
}
