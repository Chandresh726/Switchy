import { inArray, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, profile, skills, experience } from "@/lib/db/schema";
import { getAIClient, getAIGenerationOptions } from "../client";
import { retryWithBackoff, withTimeout } from "@/lib/utils/resilience";
import {
  BULK_JOB_MATCHING_SYSTEM_PROMPT,
  BULK_JOB_MATCHING_USER_PROMPT,
} from "../prompts";
import { generateStructured } from "./generation";
import { extractRequirements, htmlToText, chunkArray } from "./utils";
import { getMatcherSettings } from "./settings";
import {
  type MatchResult,
  type MatchOptions,
  type BulkMatchResult,
  type JobForMatching,
  type CandidateProfile,
  BulkMatchResultSchema,
} from "./types";
import { calculateJobMatch } from "./single";

/**
 * Bulk calculate match scores for multiple jobs in batches
 *
 * Strategy:
 * 1. If bulk matching is disabled, fall back to individual matching
 * 2. Process jobs in batches based on configured batch size
 * 3. For each batch, make a single AI call with all jobs
 * 4. Retry failed jobs individually
 *
 * @param jobIds - Array of job IDs to match
 * @param onProgress - Optional progress callback
 * @param options - Optional match configuration
 * @returns Map of jobId to MatchResult or Error
 */
export async function bulkCalculateJobMatches(
  jobIds: number[],
  onProgress?: (completed: number, total: number) => void,
  options?: MatchOptions
): Promise<Map<number, MatchResult | Error>> {
  const results = new Map<number, MatchResult | Error>();

  if (jobIds.length === 0) {
    return results;
  }

  // Fetch matcher settings
  const matcherSettings = await getMatcherSettings();
  const aiModel = await getAIClient(matcherSettings.model, matcherSettings.reasoningEffort);
  const providerOptions = await getAIGenerationOptions(
    matcherSettings.model,
    matcherSettings.reasoningEffort
  );

  console.log(
    `[Matcher] Starting with settings: model=${matcherSettings.model}, bulkEnabled=${matcherSettings.bulkEnabled}, batchSize=${matcherSettings.batchSize}, maxRetries=${matcherSettings.maxRetries}`
  );

  // If bulk matching is disabled, process jobs individually
  if (!matcherSettings.bulkEnabled) {
    return processJobsIndividually(jobIds, onProgress, options);
  }

  // Fetch profile data once
  const profileData = await fetchProfileData();
  if (!profileData) {
    return markAllAsError(jobIds, results, new Error("No profile found"));
  }

  // Fetch all jobs
  const allJobs = await db.select().from(jobs).where(inArray(jobs.id, jobIds));
  const jobsMap = new Map(allJobs.map((j) => [j.id, j]));

  // Process in batches
  const batches = chunkArray(jobIds, matcherSettings.batchSize);
  let completed = 0;

  for (const batch of batches) {
    await processBatch(
      batch,
      jobsMap,
      profileData,
      aiModel,
      providerOptions,
      matcherSettings,
      results,
      options?.scrapingLogId
    );

    completed += batch.length;
    onProgress?.(completed, jobIds.length);

    // Add delay between batches to avoid rate limiting
    if (completed < jobIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Retry failed jobs individually
  await retryFailedJobs(results, jobIds, onProgress, options);

  // Log final stats
  const successCount = Array.from(results.values()).filter((r) => !(r instanceof Error)).length;
  const errorCount = Array.from(results.values()).filter((r) => r instanceof Error).length;
  console.log(
    `[Matcher] Completed: ${successCount} successful, ${errorCount} failed out of ${jobIds.length} jobs`
  );

  return results;
}

/**
 * Process jobs individually (fallback when bulk is disabled)
 */
async function processJobsIndividually(
  jobIds: number[],
  onProgress?: (completed: number, total: number) => void,
  options?: MatchOptions
): Promise<Map<number, MatchResult | Error>> {
  const results = new Map<number, MatchResult | Error>();

  console.log(`[Matcher] Bulk matching disabled, processing ${jobIds.length} jobs individually...`);
  let completed = 0;

  for (const jobId of jobIds) {
    try {
      const result = await calculateJobMatch(jobId, options);
      results.set(jobId, result);
    } catch (error) {
      console.error(`[Matcher] Individual match failed for job ${jobId}:`, error);
      const errorObj = error instanceof Error ? error : new Error(String(error));
      results.set(jobId, errorObj);
    }
    completed++;
    onProgress?.(completed, jobIds.length);
  }

  return results;
}

/**
 * Mark all jobs as failed with the given error
 */
function markAllAsError(
  jobIds: number[],
  results: Map<number, MatchResult | Error>,
  error: Error
): Map<number, MatchResult | Error> {
  for (const jobId of jobIds) {
    results.set(jobId, error);
  }
  return results;
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
 * Process a batch of jobs with a single AI call
 */
async function processBatch(
  batch: number[],
  jobsMap: Map<number, { id: number; title: string; description: string | null }>,
  profileData: NonNullable<Awaited<ReturnType<typeof fetchProfileData>>>,
  aiModel: Awaited<ReturnType<typeof getAIClient>>,
  providerOptions: Record<string, unknown> | undefined,
  settings: Awaited<ReturnType<typeof getMatcherSettings>>,
  results: Map<number, MatchResult | Error>,
  scrapingLogId?: number | null
): Promise<void> {
  // Prepare jobs for this batch
  const jobsForMatching: JobForMatching[] = batch
    .map((jobId) => {
      const job = jobsMap.get(jobId);
      if (!job) return null;
      const sourceDescription = job.description || "";
      return {
        id: job.id,
        title: job.title,
        description: sourceDescription,
        requirements: extractRequirements(htmlToText(sourceDescription)),
      };
    })
    .filter((j): j is JobForMatching => j !== null);

  if (jobsForMatching.length === 0) return;

  const candidateProfile: CandidateProfile = {
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
  };

  const bulkPrompt = BULK_JOB_MATCHING_USER_PROMPT(jobsForMatching, candidateProfile);

  console.log(
    `[Matcher] Calling AI for batch of ${jobsForMatching.length} jobs (IDs: ${jobsForMatching.map((j) => j.id).join(", ")})`
  );

  try {
    const batchResults = await retryWithBackoff(
      async () => {
        return withTimeout(
          (async () => {
            const result = await generateStructured({
              model: aiModel,
              schema: BulkMatchResultSchema,
              system: BULK_JOB_MATCHING_SYSTEM_PROMPT,
              prompt: bulkPrompt,
              providerOptions,
              context: `batch of ${batch.length} jobs`,
            });
            return result.data;
          })(),
          settings.timeoutMs * 2, // Double timeout for batch
          `Match batch of ${batch.length} jobs`
        );
      },
      {
        maxRetries: settings.maxRetries,
        baseDelay: settings.backoffBaseDelay,
        maxDelay: settings.backoffMaxDelay,
        onRetry: (attempt, delay) => {
          console.log(`[Matcher] Batch retry ${attempt} scheduled after ${Math.round(delay)}ms`);
        },
      }
    );

    console.log(`[Matcher] AI response received for batch with ${batchResults.length} results`);

    // Process results
    const returnedJobIds = new Set(batchResults.map((r) => r.jobId));
    const requestedJobIds = jobsForMatching.map((j) => j.id);
    const missingJobIds = requestedJobIds.filter((id) => !returnedJobIds.has(id));

    if (missingJobIds.length > 0) {
      console.warn(`[Matcher] AI did not return ${missingJobIds.length} jobs: ${missingJobIds.join(", ")}`);
    }

    // Update each job in the database
    for (const result of batchResults) {
      await updateJobWithBulkResult(result, jobsMap);
      results.set(result.jobId, {
        score: result.score,
        reasons: result.reasons,
        matchedSkills: result.matchedSkills,
        missingSkills: result.missingSkills,
        recommendations: result.recommendations,
      });
    }

    // Mark any jobs not in the response as errors
    for (const jobId of batch) {
      if (!results.has(jobId)) {
        results.set(jobId, new Error("Job not included in AI response"));
      }
    }
  } catch (error) {
    // If batch fails after all retries, mark all jobs in batch as errors
    const errorObj = error instanceof Error ? error : new Error(String(error));
    for (const jobId of batch) {
      results.set(jobId, errorObj);
    }
  }
}

/**
 * Update job with bulk match result
 */
async function updateJobWithBulkResult(
  result: BulkMatchResult,
  jobsMap: Map<number, { description: string | null }>
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
    .where(eq(jobs.id, result.jobId));
}

/**
 * Retry failed jobs individually
 */
async function retryFailedJobs(
  results: Map<number, MatchResult | Error>,
  allJobIds: number[],
  onProgress?: (completed: number, total: number) => void,
  options?: MatchOptions
): Promise<void> {
  const failedJobIds = Array.from(results.entries())
    .filter(([, result]) => result instanceof Error)
    .map(([jobId]) => jobId);

  if (failedJobIds.length === 0) return;

  console.log(`[Matcher] Retrying ${failedJobIds.length} failed jobs individually...`);

  let completed = allJobIds.length - failedJobIds.length;

  for (const jobId of failedJobIds) {
    try {
      const result = await calculateJobMatch(jobId, options);
      results.set(jobId, result);
      console.log(`[Matcher] Individual retry succeeded for job ${jobId}`);
    } catch (error) {
      console.error(`[Matcher] Individual retry failed for job ${jobId}:`, error);
      // Keep the original error in results
    }
    completed++;
    onProgress?.(completed, allJobIds.length);
  }
}

/**
 * @deprecated Use bulkCalculateJobMatches instead for better performance.
 * Kept for backwards compatibility.
 */
export async function batchCalculateJobMatches(
  jobIds: number[],
  onProgress?: (completed: number, total: number) => void,
  options?: MatchOptions
): Promise<Map<number, MatchResult | Error>> {
  return bulkCalculateJobMatches(jobIds, onProgress, options);
}
