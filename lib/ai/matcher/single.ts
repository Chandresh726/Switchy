import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, profile, skills, experience, matcherErrors } from "@/lib/db/schema";
import { getMatcherCircuitBreaker } from "../circuit-breaker";
import { getAIClient, getAIGenerationOptions } from "../client";
import { retryWithBackoff, withTimeout } from "@/lib/utils/resilience";
import {
  JOB_MATCHING_SYSTEM_PROMPT,
  JOB_MATCHING_USER_PROMPT,
} from "../prompts";
import { extractRequirements, htmlToText } from "./utils";
import { generateStructured } from "./generation";
import {
  type MatchResult,
  type MatchOptions,
  type MatcherSettings,
  MatchResultSchema,
} from "./types";
import { categorizeError } from "./errors";

/**
 * Calculate match score for a single job
 *
 * @param jobId - The job ID to match
 * @param options - Optional match configuration
 * @returns MatchResult with score and analysis
 * @throws Error if job or profile not found, or if AI generation fails
 */
export async function calculateJobMatch(
  jobId: number,
  options?: MatchOptions
): Promise<MatchResult> {
  // Fetch matcher settings
  const matcherSettings = await import("./settings").then((m) =>
    m.getMatcherSettings()
  );

  // Fetch job details
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));

  if (!job) {
    throw new Error("Job not found");
  }

  // Fetch user profile
  const profiles = await db.select().from(profile).limit(1);

  if (profiles.length === 0) {
    throw new Error("No profile found. Please create a profile first.");
  }

  const userProfile = profiles[0];

  // Fetch skills and experience
  const [userSkills, userExperience] = await Promise.all([
    db.select().from(skills).where(eq(skills.profileId, userProfile.id)),
    db.select().from(experience).where(eq(experience.profileId, userProfile.id)),
  ]);

  const sourceDescription = job.description || "";
  const jobRequirements = extractRequirements(htmlToText(sourceDescription));

  const userPrompt = JOB_MATCHING_USER_PROMPT(
    job.title,
    sourceDescription,
    jobRequirements,
    {
      summary: userProfile.summary || undefined,
      skills: userSkills.map((s) => ({
        name: s.name,
        proficiency: s.proficiency,
        category: s.category || undefined,
      })),
      experience: userExperience.map((e) => ({
        title: e.title,
        company: e.company,
        description: e.description || undefined,
      })),
    }
  );

  // Get AI model and provider options
  const aiModel = await getAIClient(matcherSettings.model, matcherSettings.reasoningEffort);
  const providerOptions = await getAIGenerationOptions(
    matcherSettings.model,
    matcherSettings.reasoningEffort
  );

  // Get circuit breaker
  const circuitBreaker = getMatcherCircuitBreaker({
    failureThreshold: matcherSettings.circuitBreakerThreshold,
    resetTimeout: matcherSettings.circuitBreakerResetTimeout,
  });

  // Execute match with retry and circuit breaker
  const matchResult = await executeMatchWithResilience(
    jobId,
    aiModel,
    providerOptions,
    userPrompt,
    matcherSettings,
    circuitBreaker,
    options?.scrapingLogId
  );

  // Update job with match results
  await updateJobWithMatchResult(jobId, matchResult);

  return matchResult;
}

/**
 * Execute match with retry, timeout, and circuit breaker protection
 */
async function executeMatchWithResilience(
  jobId: number,
  aiModel: ReturnType<typeof getAIClient> extends Promise<infer T> ? T : never,
  providerOptions: Record<string, unknown> | undefined,
  userPrompt: string,
  settings: MatcherSettings,
  circuitBreaker: ReturnType<typeof getMatcherCircuitBreaker>,
  scrapingLogId?: number | null
): Promise<MatchResult> {
  return retryWithBackoff(
    async () => {
      return circuitBreaker.execute(async () => {
        return withTimeout(
          (async () => {
            const result = await generateStructured({
              model: aiModel,
              schema: MatchResultSchema,
              system: JOB_MATCHING_SYSTEM_PROMPT,
              prompt: userPrompt,
              providerOptions,
              context: `job ${jobId}`,
            });

            return result.data;
          })(),
          settings.timeoutMs,
          `Match job ${jobId}`
        );
      });
    },
    {
      maxRetries: settings.maxRetries,
      baseDelay: settings.backoffBaseDelay,
      maxDelay: settings.backoffMaxDelay,
      onRetry: (attempt, delay) => {
        console.log(
          `[Matcher] Job ${jobId}: Retry ${attempt} scheduled after ${Math.round(delay)}ms`
        );
      },
      logError: async (attempt, error) => {
        await logMatcherError(jobId, attempt, error, scrapingLogId);
      },
    }
  );
}

/**
 * Update job record with match results
 */
async function updateJobWithMatchResult(
  jobId: number,
  result: MatchResult
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

/**
 * Sanitize error message to remove PII and sensitive data
 */
function sanitizeErrorMessage(message: string): string {
  let sanitized = message;

  // Strip email addresses
  sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL_REDACTED]");

  // Strip API keys/tokens (long hex/base64 strings: 32+ alphanumeric characters)
  sanitized = sanitized.replace(/\b[a-fA-F0-9]{32,}\b/g, "[API_KEY_REDACTED]");
  sanitized = sanitized.replace(/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, "[TOKEN_REDACTED]");

  // Strip Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+\S+/gi, "Bearer [TOKEN_REDACTED]");

  // Strip long numeric sequences (16+ digits - could be credit cards, API keys)
  sanitized = sanitized.replace(/\b\d{16,}\b/g, "[NUMERIC_REDACTED]");

  // Strip request-like JSON payloads that might contain sensitive keys
  sanitized = sanitized.replace(
    /\{[^}]*["'](api_key|token|key|secret|password|auth)["'][^}]*\}/gi,
    "[JSON_PAYLOAD_REDACTED]"
  );

  // Truncate to 1000 characters
  return sanitized.slice(0, 1000);
}
async function logMatcherError(
  jobId: number,
  attemptNumber: number,
  error: Error,
  scrapingLogId?: number | null
): Promise<void> {
  try {
    const errorType = categorizeError(error);
    const sanitizedMessage = sanitizeErrorMessage(error.message);

    // Log original error to console only (not DB)
    console.error(`[Matcher] Job ${jobId} attempt ${attemptNumber} error:`, error.message);

    await db.insert(matcherErrors).values({
      jobId,
      scrapingLogId: scrapingLogId || null,
      attemptNumber,
      errorType,
      errorMessage: sanitizedMessage,
    });
  } catch (dbError) {
    console.error("[Matcher] Failed to log error to database:", dbError);
  }
}
