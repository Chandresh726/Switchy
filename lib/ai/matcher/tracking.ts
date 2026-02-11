import { inArray, eq, isNull } from "drizzle-orm";
import PQueue from "p-queue";
import { db } from "@/lib/db";
import { jobs, profile, skills, experience, matchSessions, matchLogs } from "@/lib/db/schema";
import { getMatcherCircuitBreaker, resetMatcherCircuitBreaker } from "../circuit-breaker";
import { getAIClient, getAIGenerationOptions } from "../client";
import { withTimeout } from "@/lib/utils/resilience";
import {
  JOB_MATCHING_SYSTEM_PROMPT,
  JOB_MATCHING_USER_PROMPT,
} from "../prompts";
import { generateStructured } from "./generation";
import { extractRequirements, htmlToText } from "./utils";
import { getMatcherSettings } from "./settings";
import {
  type MatchResult,
  type MatchSessionResult,
  type MatchProgressCallback,
  MatchResultSchema,
} from "./types";
import { categorizeError } from "./errors";

/**
 * Match jobs with full tracking - creates a match session and logs each job result.
 * Uses p-queue for true parallelization with configurable concurrency.
 *
 * @param jobIds - Array of job IDs to match
 * @param triggerSource - Source of the match trigger
 * @param companyId - Optional company ID for context
 * @param onProgress - Optional progress callback
 * @returns MatchSessionResult with session ID and stats
 */
export async function matchJobsWithTracking(
  jobIds: number[],
  triggerSource: "manual" | "auto_scrape" | "company_refresh" = "manual",
  companyId?: number,
  onProgress?: MatchProgressCallback
): Promise<MatchSessionResult> {
  if (jobIds.length === 0) {
    return { sessionId: "", total: 0, succeeded: 0, failed: 0 };
  }

  // Fetch matcher settings
  const matcherSettings = await getMatcherSettings();

  // Reset circuit breaker with current settings
  resetMatcherCircuitBreaker({
    failureThreshold: matcherSettings.circuitBreakerThreshold,
    resetTimeout: matcherSettings.circuitBreakerResetTimeout,
  });

  // Create match session
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

  console.log(
    `[Matcher] Starting session ${sessionId} for ${jobIds.length} jobs (concurrency: ${matcherSettings.concurrencyLimit})`
  );

  // Create queue with concurrency limit
  const queue = new PQueue({ concurrency: matcherSettings.concurrencyLimit });

  let completed = 0;
  let succeeded = 0;
  let failed = 0;

  // Helper to update session progress in database
  const updateSessionProgress = async () => {
    await db.update(matchSessions).set({
      jobsCompleted: completed,
      jobsSucceeded: succeeded,
      jobsFailed: failed,
      errorCount: failed,
    }).where(eq(matchSessions.id, sessionId));
  };

  try {
    // Fetch profile data once
    const profileData = await fetchProfileData();
    if (!profileData) {
      // No profile - fail all jobs with proper error count
      await failAllJobsNoProfile(sessionId, jobIds, matcherSettings.model);
      await db.update(matchSessions).set({
        status: "failed",
        jobsCompleted: jobIds.length,
        jobsFailed: jobIds.length,
        errorCount: jobIds.length,
        completedAt: new Date(),
      }).where(eq(matchSessions.id, sessionId));

      return { sessionId, total: jobIds.length, succeeded: 0, failed: jobIds.length };
    }

    // Fetch all jobs
    const allJobs = await db.select().from(jobs).where(inArray(jobs.id, jobIds));
    const jobsMap = new Map(allJobs.map((j) => [j.id, j]));

    // Get circuit breaker and AI model
    const circuitBreaker = getMatcherCircuitBreaker();
    const aiModel = await getAIClient(matcherSettings.model, matcherSettings.reasoningEffort);
    const providerOptions = await getAIGenerationOptions(
      matcherSettings.model,
      matcherSettings.reasoningEffort
    );

    // Process each job in the queue
    const jobPromises = jobIds.map((jobId) =>
      queue.add(async () => {
        const result = await processJobWithTracking(
          jobId,
          jobsMap,
          profileData,
          aiModel,
          providerOptions,
          matcherSettings,
          circuitBreaker,
          sessionId
        );

        if (result.success) {
          succeeded++;
        } else {
          failed++;
        }
        completed++;
        await updateSessionProgress();
        onProgress?.(completed, jobIds.length, succeeded, failed);
      })
    );

    // Wait for all jobs to complete
    await Promise.all(jobPromises);

    // Update session with final stats
    const finalStatus = failed === jobIds.length ? "failed" : "completed";
    await db.update(matchSessions).set({
      status: finalStatus,
      jobsCompleted: completed,
      jobsSucceeded: succeeded,
      jobsFailed: failed,
      errorCount: failed,
      completedAt: new Date(),
    }).where(eq(matchSessions.id, sessionId));

    console.log(
      `[Matcher] Session ${sessionId} completed: ${succeeded} succeeded, ${failed} failed out of ${jobIds.length} jobs`
    );

    return { sessionId, total: jobIds.length, succeeded, failed };
  } catch (error) {
    // On any error, mark session as failed
    console.error(`[Matcher] Session ${sessionId} failed:`, error);
    await db.update(matchSessions).set({
      status: "failed",
      jobsCompleted: completed || jobIds.length,
      jobsFailed: failed || jobIds.length,
      errorCount: failed || jobIds.length,
      completedAt: new Date(),
    }).where(eq(matchSessions.id, sessionId));
    throw error;
  }
}

/**
 * Fetch profile data for matching
 */
async function fetchProfileData(): Promise<{
  profile: { id: number; summary: string | null };
  skills: { name: string; proficiency: number; category: string | null }[];
  experience: { title: string; company: string; description: string | null }[];
} | null> {
  const profiles = await db.select().from(profile).limit(1);
  if (profiles.length === 0) return null;

  const userProfile = profiles[0];

  const [userSkills, userExperience] = await Promise.all([
    db.select().from(skills).where(eq(skills.profileId, userProfile.id)),
    db.select().from(experience).where(eq(experience.profileId, userProfile.id)),
  ]);

  return {
    profile: userProfile,
    skills: userSkills,
    experience: userExperience,
  };
}

/**
 * Fail all jobs when no profile exists
 */
async function failAllJobsNoProfile(
  sessionId: string,
  jobIds: number[],
  modelUsed: string
): Promise<void> {
  const error = new Error("No profile found. Please create a profile first.");

  for (const jobId of jobIds) {
    await db.insert(matchLogs).values({
      sessionId,
      jobId,
      status: "failed",
      errorType: "validation",
      errorMessage: error.message,
      attemptCount: 1,
      duration: 0,
      modelUsed,
    });
  }
}

/**
 * Process a single job with full tracking
 */
async function processJobWithTracking(
  jobId: number,
  jobsMap: Map<number, { id: number; title: string; description: string | null }>,
  profileData: NonNullable<Awaited<ReturnType<typeof fetchProfileData>>>,
  aiModel: Awaited<ReturnType<typeof getAIClient>>,
  providerOptions: Record<string, unknown> | undefined,
  settings: Awaited<ReturnType<typeof getMatcherSettings>>,
  circuitBreaker: ReturnType<typeof getMatcherCircuitBreaker>,
  sessionId: string
): Promise<{ success: boolean }> {
  const startTime = Date.now();
  const job = jobsMap.get(jobId);

  if (!job) {
    await logMatchFailure(sessionId, jobId, 0, "validation", "Job not found", 1, settings.model);
    return { success: false };
  }

  // Check circuit breaker
  if (!circuitBreaker.canExecute()) {
    await logMatchFailure(
      sessionId,
      jobId,
      Date.now() - startTime,
      "circuit_breaker",
      "Circuit breaker is open - too many failures",
      0,
      settings.model
    );
    return { success: false };
  }

  let attemptCount = 0;

  // Retry loop
  for (let attempt = 1; attempt <= settings.maxRetries; attempt++) {
    attemptCount = attempt;

    try {
      const result = await executeMatchAttempt(
        job,
        profileData,
        aiModel,
        providerOptions,
        settings
      );

      // Success - update job and log
      await updateJobWithResult(job.id, result);
      await logMatchSuccess(sessionId, jobId, result.score, attemptCount, Date.now() - startTime, settings.model);

      return { success: true };
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      circuitBreaker.recordFailure(errorObj);

      if (attempt < settings.maxRetries) {
        // Calculate delay with jitter
        const exponentialDelay = Math.min(
          settings.backoffBaseDelay * Math.pow(2, attempt - 1),
          settings.backoffMaxDelay
        );
        const jitter = Math.random() * 1000;
        const delay = exponentialDelay + jitter;

        console.log(
          `[Matcher] Job ${jobId} attempt ${attempt}/${settings.maxRetries} failed, retrying in ${Math.round(delay)}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // All retries failed
  const lastError = new Error("All retries exhausted");
  const errorType = categorizeError(lastError);
  await logMatchFailure(
    sessionId,
    jobId,
    Date.now() - startTime,
    errorType,
    lastError.message,
    attemptCount,
    settings.model
  );

  return { success: false };
}

/**
 * Execute a single match attempt
 */
async function executeMatchAttempt(
  job: { id: number; title: string; description: string | null },
  profileData: NonNullable<Awaited<ReturnType<typeof fetchProfileData>>>,
  aiModel: Awaited<ReturnType<typeof getAIClient>>,
  providerOptions: Record<string, unknown> | undefined,
  settings: Awaited<ReturnType<typeof getMatcherSettings>>
): Promise<MatchResult> {
  const sourceDescription = job.description || "";
  const jobRequirements = extractRequirements(htmlToText(sourceDescription));

  const userPrompt = JOB_MATCHING_USER_PROMPT(job.title, sourceDescription, jobRequirements, {
    summary: profileData.profile.summary || undefined,
    skills: profileData.skills.map((s) => ({
      name: s.name,
      proficiency: s.proficiency,
      category: s.category || undefined,
    })),
    experience: profileData.experience.map((e) => ({
      title: e.title,
      company: e.company,
      description: e.description || undefined,
    })),
  });

  return withTimeout(
    (async () => {
      const result = await generateStructured({
        model: aiModel,
        schema: MatchResultSchema,
        system: JOB_MATCHING_SYSTEM_PROMPT,
        prompt: userPrompt,
        providerOptions,
        context: `job ${job.id}`,
      });

      return result.data;
    })(),
    settings.timeoutMs,
    `Match job ${job.id}`
  );
}

/**
 * Update job with match result
 */
async function updateJobWithResult(
  jobId: number,
  result: MatchResult
): Promise<void> {
  await db.update(jobs).set({
    matchScore: result.score,
    matchReasons: JSON.stringify(result.reasons),
    matchedSkills: JSON.stringify(result.matchedSkills),
    missingSkills: JSON.stringify(result.missingSkills),
    recommendations: JSON.stringify(result.recommendations),
    updatedAt: new Date(),
  }).where(eq(jobs.id, jobId));
}

/**
 * Log successful match
 */
async function logMatchSuccess(
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

/**
 * Log failed match
 */
async function logMatchFailure(
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

/**
 * Get all job IDs that don't have a match score yet
 */
export async function getUnmatchedJobIds(): Promise<number[]> {
  const unmatchedJobs = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(isNull(jobs.matchScore));

  return unmatchedJobs.map((j) => j.id);
}

/**
 * Run matcher on all jobs that don't have a score yet
 */
export async function matchUnmatchedJobs(
  onProgress?: MatchProgressCallback
): Promise<{ total: number; matched: number; failed: number }> {
  const unmatchedJobIds = await getUnmatchedJobIds();

  if (unmatchedJobIds.length === 0) {
    return { total: 0, matched: 0, failed: 0 };
  }

  console.log(`[Matcher] Found ${unmatchedJobIds.length} unmatched jobs, starting matching...`);

  const results = await import("./bulk").then((m) =>
    m.bulkCalculateJobMatches(unmatchedJobIds, onProgress)
  );

  const matched = Array.from(results.values()).filter((r) => !(r instanceof Error)).length;
  const failed = Array.from(results.values()).filter((r) => r instanceof Error).length;

  return { total: unmatchedJobIds.length, matched, failed };
}

/**
 * Match all unmatched jobs with full tracking
 */
export async function matchUnmatchedJobsWithTracking(
  triggerSource: "manual" | "auto_scrape" | "company_refresh" = "manual",
  onProgress?: MatchProgressCallback
): Promise<MatchSessionResult> {
  const unmatchedJobIds = await getUnmatchedJobIds();

  if (unmatchedJobIds.length === 0) {
    return { sessionId: "", total: 0, succeeded: 0, failed: 0 };
  }

  console.log(`[Matcher] Found ${unmatchedJobIds.length} unmatched jobs, starting tracked matching...`);

  return matchJobsWithTracking(unmatchedJobIds, triggerSource, undefined, onProgress);
}
