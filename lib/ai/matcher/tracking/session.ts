import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";

import { fetchCandidateProfileSnapshot } from "@/lib/ai/profile/profile-snapshot";
import { db } from "@/lib/db";
import { jobs, matchSessions, matchLogs } from "@/lib/db/schema";

import type { MatchSessionResult, TriggerSource, ProfileData, JobData } from "../types";

export async function fetchProfileData(): Promise<ProfileData | null> {
  const snapshot = await fetchCandidateProfileSnapshot();
  if (!snapshot) {
    return null;
  }

  return {
    profile: snapshot.profile,
    skills: snapshot.skills,
    experience: snapshot.experience,
    education: snapshot.education,
  };
}

export async function fetchJobsData(jobIds: number[]): Promise<Map<number, JobData>> {
  if (jobIds.length === 0) return new Map();

  const allJobs = await db.select().from(jobs).where(inArray(jobs.id, jobIds));
  return new Map(allJobs.map((j) => [j.id, j]));
}

export async function updateJobWithMatchResult(
  jobId: number,
  result: { score: number; reasons: string[]; matchedSkills: string[]; missingSkills: string[]; recommendations: string[] }
): Promise<void> {
  await db
    .update(jobs)
    .set({
      matchScore: result.score,
      matchReasons: JSON.stringify(result.reasons),
      matchedSkills: JSON.stringify(result.matchedSkills),
      missingSkills: JSON.stringify(result.missingSkills),
      recommendations: JSON.stringify(result.recommendations),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
}

export async function persistMatchSuccess(
  sessionId: string,
  jobId: number,
  result: {
    score: number;
    reasons: string[];
    matchedSkills: string[];
    missingSkills: string[];
    recommendations: string[];
  },
  attemptCount: number,
  duration: number,
  modelUsed: string
): Promise<void> {
  db.transaction((tx) => {
    tx.update(jobs)
      .set({
        matchScore: result.score,
        matchReasons: JSON.stringify(result.reasons),
        matchedSkills: JSON.stringify(result.matchedSkills),
        missingSkills: JSON.stringify(result.missingSkills),
        recommendations: JSON.stringify(result.recommendations),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId))
      .run();

    tx.insert(matchLogs)
      .values({
        sessionId,
        jobId,
        status: "success",
        score: result.score,
        attemptCount,
        duration,
        modelUsed,
      })
      .run();
  }, { behavior: "immediate" });
}

export async function getUnmatchedJobIds(): Promise<number[]> {
  const unmatchedJobs = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(isNull(jobs.matchScore));

  return unmatchedJobs.map((j) => j.id);
}

export async function getUnmatchedJobCount(): Promise<number> {
  const [result] = await db
    .select({ value: count() })
    .from(jobs)
    .where(isNull(jobs.matchScore));

  return result?.value ?? 0;
}

export async function createMatchSession(
  jobIds: number[],
  triggerSource: TriggerSource,
  companyId?: number
): Promise<string> {
  const sessionId = crypto.randomUUID();

  await db.insert(matchSessions).values({
    id: sessionId,
    triggerSource,
    companyId: companyId || null,
    status: "in_progress",
    jobsTotal: jobIds.length,
    jobsCompleted: 0,
    jobsSucceeded: 0,
    jobsFailed: 0,
    errorCount: 0,
    startedAt: new Date(),
  });

  return sessionId;
}

export async function updateMatchSession(
  sessionId: string,
  updates: {
    status?: "queued" | "in_progress" | "completed" | "failed";
    jobsCompleted?: number;
    jobsSucceeded?: number;
    jobsFailed?: number;
    errorCount?: number;
    startedAt?: Date;
  }
): Promise<void> {
  await db
    .update(matchSessions)
    .set({
      ...updates,
      ...(updates.status === "completed" ? { completedAt: new Date() } : {}),
    })
    .where(eq(matchSessions.id, sessionId));
}

export async function updateMatchSessionIfActive(
  sessionId: string,
  updates: {
    status?: "queued" | "in_progress" | "completed" | "failed";
    jobsCompleted?: number;
    jobsSucceeded?: number;
    jobsFailed?: number;
    errorCount?: number;
    startedAt?: Date;
  }
): Promise<boolean> {
  const updated = await db
    .update(matchSessions)
    .set({
      ...updates,
      ...(updates.status === "completed" ? { completedAt: new Date() } : {}),
    })
    .where(
      and(
        eq(matchSessions.id, sessionId),
        inArray(matchSessions.status, ["in_progress", "queued"])
      )
    )
    .returning({ id: matchSessions.id });

  return updated.length > 0;
}

export async function logMatchSuccess(
  sessionId: string,
  jobId: number,
  score: number,
  attemptCount: number,
  duration: number,
  modelUsed: string
): Promise<void> {
  await db.insert(matchLogs).values({
    sessionId,
    jobId,
    status: "success",
    score,
    attemptCount,
    duration,
    modelUsed,
  });
}

export async function logMatchFailure(
  sessionId: string,
  jobId: number,
  duration: number,
  errorType: string,
  errorMessage: string,
  attemptCount: number,
  modelUsed: string
): Promise<void> {
  await db.insert(matchLogs).values({
    sessionId,
    jobId,
    status: "failed",
    errorType,
    errorMessage: errorMessage.slice(0, 1000),
    attemptCount,
    duration,
    modelUsed,
  });
}

export async function finalizeMatchSession(
  sessionId: string,
  succeeded: number,
  failed: number,
  total: number
): Promise<MatchSessionResult> {
  const finalStatus = failed === total ? "failed" : "completed";

  await db
    .update(matchSessions)
    .set({
      status: finalStatus,
      jobsCompleted: total,
      jobsSucceeded: succeeded,
      jobsFailed: failed,
      errorCount: failed,
      completedAt: new Date(),
    })
    .where(eq(matchSessions.id, sessionId));

  return {
    sessionId,
    total,
    succeeded,
    failed,
  };
}

export async function getMatchSessionStatus(sessionId: string) {
  const [session] = await db
    .select({
      id: matchSessions.id,
      status: matchSessions.status,
      jobsTotal: matchSessions.jobsTotal,
      jobsCompleted: matchSessions.jobsCompleted,
      jobsSucceeded: matchSessions.jobsSucceeded,
      jobsFailed: matchSessions.jobsFailed,
      startedAt: matchSessions.startedAt,
      completedAt: matchSessions.completedAt,
    })
    .from(matchSessions)
    .where(eq(matchSessions.id, sessionId))
    .limit(1);

  return session || null;
}

export interface MatchSessionCheckpoint {
  completedJobIds: number[];
  succeeded: number;
  failed: number;
}

export async function getMatchSessionCheckpoint(
  sessionId: string,
  jobIds: number[]
): Promise<MatchSessionCheckpoint> {
  if (jobIds.length === 0) {
    return { completedJobIds: [], succeeded: 0, failed: 0 };
  }

  const logs = await db
    .select({ id: matchLogs.id, jobId: matchLogs.jobId, status: matchLogs.status })
    .from(matchLogs)
    .where(
      and(
        eq(matchLogs.sessionId, sessionId),
        inArray(matchLogs.jobId, jobIds)
      )
    )
    .orderBy(asc(matchLogs.id));
  const finalStatusByJob = new Map<number, string>();
  for (const log of logs) {
    if (log.jobId !== null) finalStatusByJob.set(log.jobId, log.status);
  }

  const statuses = Array.from(finalStatusByJob.values());
  return {
    completedJobIds: Array.from(finalStatusByJob.keys()),
    succeeded: statuses.filter((status) => status === "success").length,
    failed: statuses.filter((status) => status !== "success").length,
  };
}
