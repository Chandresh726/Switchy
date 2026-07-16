import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  companies,
  jobs,
  matchSessionJobs,
  type MatchSessionJob,
} from "@/lib/db/schema";
import { chunkSqliteParameters } from "@/lib/db/sqlite-utils";

export interface MatchPipelinePhaseProgress {
  total: number;
  completed: number;
  active: number;
  queued: number;
  cached: number;
  failed: number;
}

export interface MatchSessionJobProgress {
  jobId: number;
  jobTitle: string;
  companyName: string | null;
  analysisStatus: MatchSessionJob["analysisStatus"];
  matchStatus: MatchSessionJob["matchStatus"];
  errorStage: MatchSessionJob["errorStage"];
  errorCode: string | null;
  errorMessage: string | null;
  analysisStartedAt: Date | null;
  analysisCompletedAt: Date | null;
  matchStartedAt: Date | null;
  matchCompletedAt: Date | null;
  updatedAt: Date;
}

export interface MatchPipelineProgress {
  analysis: MatchPipelinePhaseProgress;
  matching: MatchPipelinePhaseProgress;
  jobs: MatchSessionJobProgress[];
  jobPagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

function sessionJobsWhere(sessionId: string, jobIds: number[]) {
  return and(
    eq(matchSessionJobs.sessionId, sessionId),
    inArray(matchSessionJobs.jobId, jobIds)
  );
}

export async function markJobAnalysisStarted(
  sessionId: string,
  jobIds: number[],
  database: typeof db = db
): Promise<void> {
  if (jobIds.length === 0) return;
  const now = new Date();
  for (const chunk of chunkSqliteParameters(Array.from(new Set(jobIds)))) {
    await database.update(matchSessionJobs).set({
      analysisStatus: "analyzing",
      analysisStartedAt: now,
      analysisCompletedAt: null,
      errorStage: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: now,
    }).where(sessionJobsWhere(sessionId, chunk));
  }
}

export async function markJobAnalysisReady(
  sessionId: string,
  input: {
    jobId: number;
    jobAnalysisId: string;
    analysisRunId?: string | null;
    cached: boolean;
  },
  database: typeof db = db
): Promise<void> {
  const now = new Date();
  await database.update(matchSessionJobs).set({
    analysisStatus: input.cached ? "cached" : "ready",
    matchStatus: "queued",
    jobAnalysisId: input.jobAnalysisId,
    analysisRunId: input.analysisRunId ?? null,
    analysisCompletedAt: now,
    errorStage: null,
    errorCode: null,
    errorMessage: null,
    updatedAt: now,
  }).where(sessionJobsWhere(sessionId, [input.jobId]));
}

export async function markJobMatchStarted(
  sessionId: string,
  jobId: number,
  database: typeof db = db
): Promise<void> {
  const now = new Date();
  await database.update(matchSessionJobs).set({
    matchStatus: "matching",
    matchStartedAt: now,
    matchCompletedAt: null,
    errorStage: null,
    errorCode: null,
    errorMessage: null,
    updatedAt: now,
  }).where(sessionJobsWhere(sessionId, [jobId]));
}

export async function getMatchPipelineProgress(
  sessionId: string,
  database: typeof db = db,
  page: { limit: number; offset: number } = { limit: 100, offset: 0 }
): Promise<MatchPipelineProgress> {
  const [summary] = await database.select({
    total: sql<number>`count(*)`,
    analysisCompleted: sql<number>`sum(case when ${matchSessionJobs.analysisStatus} in ('ready', 'cached', 'failed') then 1 else 0 end)`,
    analysisActive: sql<number>`sum(case when ${matchSessionJobs.analysisStatus} = 'analyzing' then 1 else 0 end)`,
    analysisQueued: sql<number>`sum(case when ${matchSessionJobs.analysisStatus} = 'queued' then 1 else 0 end)`,
    analysisCached: sql<number>`sum(case when ${matchSessionJobs.analysisStatus} = 'cached' then 1 else 0 end)`,
    analysisFailed: sql<number>`sum(case when ${matchSessionJobs.analysisStatus} = 'failed' then 1 else 0 end)`,
    matchingCompleted: sql<number>`sum(case when ${matchSessionJobs.matchStatus} in ('completed', 'cached', 'failed') then 1 else 0 end)`,
    matchingActive: sql<number>`sum(case when ${matchSessionJobs.matchStatus} = 'matching' then 1 else 0 end)`,
    matchingQueued: sql<number>`sum(case when ${matchSessionJobs.matchStatus} in ('blocked', 'queued') then 1 else 0 end)`,
    matchingCached: sql<number>`sum(case when ${matchSessionJobs.matchStatus} = 'cached' then 1 else 0 end)`,
    matchingFailed: sql<number>`sum(case when ${matchSessionJobs.matchStatus} = 'failed' then 1 else 0 end)`,
  }).from(matchSessionJobs).where(eq(matchSessionJobs.sessionId, sessionId));
  const rows = await database.select({
    jobId: matchSessionJobs.jobId,
    jobTitle: jobs.title,
    companyName: companies.name,
    analysisStatus: matchSessionJobs.analysisStatus,
    matchStatus: matchSessionJobs.matchStatus,
    errorStage: matchSessionJobs.errorStage,
    errorCode: matchSessionJobs.errorCode,
    errorMessage: matchSessionJobs.errorMessage,
    analysisStartedAt: matchSessionJobs.analysisStartedAt,
    analysisCompletedAt: matchSessionJobs.analysisCompletedAt,
    matchStartedAt: matchSessionJobs.matchStartedAt,
    matchCompletedAt: matchSessionJobs.matchCompletedAt,
    updatedAt: matchSessionJobs.updatedAt,
  }).from(matchSessionJobs)
    .innerJoin(jobs, eq(matchSessionJobs.jobId, jobs.id))
    .leftJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(matchSessionJobs.sessionId, sessionId))
    .orderBy(
      desc(matchSessionJobs.updatedAt),
      desc(matchSessionJobs.jobId)
    )
    .limit(page.limit)
    .offset(page.offset);
  const total = Number(summary?.total ?? 0);
  return {
    analysis: {
      total,
      completed: Number(summary?.analysisCompleted ?? 0),
      active: Number(summary?.analysisActive ?? 0),
      queued: Number(summary?.analysisQueued ?? 0),
      cached: Number(summary?.analysisCached ?? 0),
      failed: Number(summary?.analysisFailed ?? 0),
    },
    matching: {
      total,
      completed: Number(summary?.matchingCompleted ?? 0),
      active: Number(summary?.matchingActive ?? 0),
      queued: Number(summary?.matchingQueued ?? 0),
      cached: Number(summary?.matchingCached ?? 0),
      failed: Number(summary?.matchingFailed ?? 0),
    },
    jobs: rows,
    jobPagination: {
      total,
      limit: page.limit,
      offset: page.offset,
      hasMore: page.offset + rows.length < total,
    },
  };
}
