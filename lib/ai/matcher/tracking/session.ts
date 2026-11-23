import { and, eq, inArray } from "drizzle-orm";

import { insertAICacheHit } from "@/lib/ai/observability/cache-events";
import { sanitizeAIError } from "@/lib/ai/shared/errors";
import { db } from "@/lib/db";
import {
  aiWorkItems,
  jobs,
  matchLogs,
  matchSessionJobs,
  matchSessions,
} from "@/lib/db/schema";
import { chunkSqliteParameters } from "@/lib/db/sqlite-utils";

import type { JobData } from "../types";

export async function fetchJobsData(
  jobIds: number[],
  database: typeof db = db
): Promise<Map<number, JobData>> {
  if (jobIds.length === 0) return new Map();

  const allJobs: JobData[] = [];
  for (const jobIdChunk of chunkSqliteParameters(Array.from(new Set(jobIds)))) {
    allJobs.push(
      ...await database.select().from(jobs).where(inArray(jobs.id, jobIdChunk))
    );
  }
  return new Map(allJobs.map((j) => [j.id, j]));
}

export async function persistMatchSuccess(
  sessionId: string,
  jobId: number,
  matchResultId: string,
  result: {
    score: number;
    reasons: string[];
    matchedSkills: string[];
  },
  attemptCount: number,
  duration: number,
  modelUsed: string,
  input: { matchRunId?: string | null; cached?: boolean } = {},
  database: typeof db = db
): Promise<void> {
  const now = new Date();
  database.transaction((tx) => {
    tx.insert(matchLogs).values({
      sessionId,
      jobId,
      matchResultId,
      status: "success",
      score: result.score,
      attemptCount,
      duration,
      modelUsed,
      completedAt: now,
    }).run();
    tx.update(matchSessionJobs).set({
      matchStatus: input.cached ? "cached" : "completed",
      matchResultId,
      matchRunId: input.matchRunId ?? null,
      matchCompletedAt: now,
      errorStage: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: now,
    }).where(and(
      eq(matchSessionJobs.sessionId, sessionId),
      eq(matchSessionJobs.jobId, jobId)
    )).run();
    if (input.cached) {
      insertAICacheHit({
        capability: "match_evaluation",
        subject: { type: "job", id: String(jobId) },
        sourceRunId: input.matchRunId ?? null,
        artifact: { type: "match_result", id: matchResultId },
        sessionId,
      }, tx, { createdAt: now });
    }
  }, { behavior: "immediate" });
}

export async function logMatchFailure(
  sessionId: string,
  jobId: number,
  duration: number,
  error: unknown,
  attemptCount: number,
  modelUsed: string,
  database: typeof db = db,
  stage: "analysis" | "matching" = "matching",
  aiRunId?: string | null
): Promise<void> {
  const sanitized = sanitizeAIError(error);
  const now = new Date();
  database.transaction((tx) => {
    tx.insert(matchLogs).values({
      sessionId,
      jobId,
      status: "failed",
      errorType: sanitized.code,
      errorMessage: sanitized.message,
      attemptCount,
      duration,
      modelUsed,
      completedAt: now,
    }).run();
    tx.update(matchSessionJobs).set({
      ...(stage === "analysis" ? {
        analysisStatus: "failed" as const,
        analysisCompletedAt: now,
        analysisRunId: aiRunId ?? null,
      } : {
        matchRunId: aiRunId ?? null,
      }),
      matchStatus: "failed",
      matchCompletedAt: now,
      errorStage: stage,
      errorCode: sanitized.code,
      errorMessage: sanitized.message,
      updatedAt: now,
    }).where(and(
      eq(matchSessionJobs.sessionId, sessionId),
      eq(matchSessionJobs.jobId, jobId)
    )).run();
  }, { behavior: "immediate" });
}

export async function getMatchSessionStatus(sessionId: string) {
  const [session] = await db
    .select({
      id: matchSessions.id,
      nextAttemptAt: aiWorkItems.availableAt,
      waitReason: aiWorkItems.lastError,
      status: matchSessions.status,
      jobsTotal: matchSessions.jobsTotal,
      jobsCompleted: matchSessions.jobsCompleted,
      jobsSucceeded: matchSessions.jobsSucceeded,
      jobsFailed: matchSessions.jobsFailed,
      startedAt: matchSessions.startedAt,
      completedAt: matchSessions.completedAt,
    })
    .from(matchSessions)
    .leftJoin(aiWorkItems, eq(aiWorkItems.matchSessionId, matchSessions.id))
    .where(eq(matchSessions.id, sessionId))
    .limit(1);

  return session || null;
}
