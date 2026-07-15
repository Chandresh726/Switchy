import { eq, inArray } from "drizzle-orm";

import { fetchCandidateProfileSnapshot } from "@/lib/ai/profile/profile-snapshot";
import { sanitizeAIError } from "@/lib/ai/shared/errors";
import { db } from "@/lib/db";
import { jobs, matchSessions, matchLogs, settings } from "@/lib/db/schema";
import { chunkSqliteParameters } from "@/lib/db/sqlite-utils";

import type { ProfileData, JobData } from "../types";

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

function parsePreferenceList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toLocaleLowerCase("en-US"))
      .filter(Boolean)))
      .sort();
  } catch {
    return [];
  }
}

export async function fetchMatchingPreferences(): Promise<{
  acceptedLocationTypes: string[];
  acceptedEmploymentTypes: string[];
}> {
  const keys = [
    "matcher_accepted_location_types",
    "matcher_accepted_employment_types",
  ];
  const rows = await db.select().from(settings).where(inArray(settings.key, keys));
  const values = new Map(rows.map((row) => [row.key, row.value]));
  return {
    acceptedLocationTypes: parsePreferenceList(values.get(keys[0])),
    acceptedEmploymentTypes: parsePreferenceList(values.get(keys[1])),
  };
}

export async function persistMatchSuccess(
  sessionId: string,
  jobId: number,
  matchResultId: string,
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
  await db.insert(matchLogs).values({
    sessionId,
    jobId,
    matchResultId,
    status: "success",
    score: result.score,
    attemptCount,
    duration,
    modelUsed,
  });
}

export async function getUnmatchedJobIds(): Promise<number[]> {
  const { getFreshUnmatchedJobIds } = await import("../presentation");
  return getFreshUnmatchedJobIds();
}

export async function getUnmatchedJobCount(): Promise<number> {
  const { getFreshUnmatchedJobCount } = await import("../presentation");
  return getFreshUnmatchedJobCount();
}

export async function logMatchFailure(
  sessionId: string,
  jobId: number,
  duration: number,
  error: unknown,
  attemptCount: number,
  modelUsed: string,
  database: typeof db = db
): Promise<void> {
  const sanitized = sanitizeAIError(error);
  await database.insert(matchLogs).values({
    sessionId,
    jobId,
    status: "failed",
    errorType: sanitized.code,
    errorMessage: sanitized.message,
    attemptCount,
    duration,
    modelUsed,
  });
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
