import { eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, profile, skills, experience, education, matchSessions, matchLogs } from "@/lib/db/schema";
import type { MatchSessionResult, TriggerSource, ProfileData, JobData } from "../types";

export async function fetchProfileData(): Promise<ProfileData | null> {
  const profiles = await db.select().from(profile).limit(1);
  if (profiles.length === 0) return null;

  const userProfile = profiles[0];

  const [userSkills, userExperience, userEducation] = await Promise.all([
    db.select().from(skills).where(eq(skills.profileId, userProfile.id)),
    db.select().from(experience).where(eq(experience.profileId, userProfile.id)),
    db.select().from(education).where(eq(education.profileId, userProfile.id)),
  ]);

  return {
    profile: userProfile,
    skills: userSkills,
    experience: userExperience,
    education: userEducation,
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

export async function getUnmatchedJobIds(): Promise<number[]> {
  const unmatchedJobs = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(isNull(jobs.matchScore));

  return unmatchedJobs.map((j) => j.id);
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
  });

  return sessionId;
}

export async function updateMatchSession(
  sessionId: string,
  updates: {
    status?: "in_progress" | "completed" | "failed";
    jobsCompleted?: number;
    jobsSucceeded?: number;
    jobsFailed?: number;
    errorCount?: number;
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
