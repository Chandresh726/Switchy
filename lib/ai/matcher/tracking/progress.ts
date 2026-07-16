import { and, eq, inArray } from "drizzle-orm";

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

function summarizeAnalysis(rows: MatchSessionJobProgress[]): MatchPipelinePhaseProgress {
  return {
    total: rows.length,
    completed: rows.filter((row) => ["ready", "cached", "failed"].includes(row.analysisStatus)).length,
    active: rows.filter((row) => row.analysisStatus === "analyzing").length,
    queued: rows.filter((row) => row.analysisStatus === "queued").length,
    cached: rows.filter((row) => row.analysisStatus === "cached").length,
    failed: rows.filter((row) => row.analysisStatus === "failed").length,
  };
}

function summarizeMatching(rows: MatchSessionJobProgress[]): MatchPipelinePhaseProgress {
  return {
    total: rows.length,
    completed: rows.filter((row) => ["completed", "cached", "failed"].includes(row.matchStatus)).length,
    active: rows.filter((row) => row.matchStatus === "matching").length,
    queued: rows.filter((row) => ["blocked", "queued"].includes(row.matchStatus)).length,
    cached: rows.filter((row) => row.matchStatus === "cached").length,
    failed: rows.filter((row) => row.matchStatus === "failed").length,
  };
}

const STATUS_PRIORITY: Record<MatchSessionJob["matchStatus"], number> = {
  matching: 0,
  queued: 1,
  blocked: 2,
  failed: 3,
  completed: 4,
  cached: 5,
};

export async function getMatchPipelineProgress(
  sessionId: string,
  database: typeof db = db
): Promise<MatchPipelineProgress> {
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
    .where(eq(matchSessionJobs.sessionId, sessionId));
  const sorted = rows.sort((left, right) =>
    STATUS_PRIORITY[left.matchStatus] - STATUS_PRIORITY[right.matchStatus] ||
    right.updatedAt.getTime() - left.updatedAt.getTime() ||
    left.jobId - right.jobId
  );
  return {
    analysis: summarizeAnalysis(sorted),
    matching: summarizeMatching(sorted),
    jobs: sorted,
  };
}
