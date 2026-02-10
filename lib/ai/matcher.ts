import { generateObject, generateText } from "ai";
import { z } from "zod";
import { inArray, eq, isNull } from "drizzle-orm";
import PQueue from "p-queue";
import { getAIClient } from "./client";
import {
  JOB_MATCHING_SYSTEM_PROMPT,
  JOB_MATCHING_USER_PROMPT,
  BULK_JOB_MATCHING_SYSTEM_PROMPT,
  BULK_JOB_MATCHING_USER_PROMPT,
  type JobForMatching,
} from "./prompts";
import { db } from "@/lib/db";
import {
  jobs,
  profile,
  skills,
  experience,
  settings,
  matcherErrors,
  matchSessions,
  matchLogs,
} from "@/lib/db/schema";
import { getMatcherCircuitBreaker, resetMatcherCircuitBreaker, CircuitState } from "./circuit-breaker";

// Setting to control whether to use generateObject or skip straight to generateText
// Set to false if your model/proxy doesn't support structured output
const USE_GENERATE_OBJECT = false;

// JSON prompt suffix for generateText fallback
const JSON_PROMPT_SUFFIX = `

CRITICAL: You MUST respond with ONLY a valid JSON object. No markdown, no code blocks, no explanations, no text before or after.

The JSON object MUST have this exact structure:
{
  "score": <number 0-100>,
  "cleanDescription": "<plain text job description>",
  "reasons": ["reason1", "reason2", ...],
  "matchedSkills": ["skill1", "skill2", ...],
  "missingSkills": ["skill1", "skill2", ...],
  "recommendations": ["recommendation1", ...]
}`;

const MatchResultSchema = z.object({
  score: z.number().min(0).max(100),
  cleanDescription: z.string().optional(),
  reasons: z.array(z.string()),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  recommendations: z.array(z.string()),
});

// Schema for bulk match results - single job within array
const BulkMatchItemSchema = z.object({
  jobId: z.number(),
  score: z.number().min(0).max(100),
  cleanDescription: z.string().optional(),
  reasons: z.array(z.string()),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  recommendations: z.array(z.string()),
});

// Schema for bulk match results array
const BulkMatchResultSchema = z.array(BulkMatchItemSchema);

export type MatchResult = z.infer<typeof MatchResultSchema>;
export type BulkMatchResult = z.infer<typeof BulkMatchItemSchema>;

// Error type categorization
type ErrorType = "network" | "validation" | "rate_limit" | "json_parse" | "no_object" | "timeout" | "circuit_breaker" | "unknown";

function categorizeError(error: Error): ErrorType {
  const message = error.message.toLowerCase();
  const name = error.name || "";

  if (name.includes("CircuitBreakerOpenError") || message.includes("circuit breaker")) {
    return "circuit_breaker";
  }
  if (name.includes("NoObjectGeneratedError") || message.includes("no object generated")) {
    return "no_object";
  }
  if (message.includes("timeout") || message.includes("timed out") || name.includes("TimeoutError")) {
    return "timeout";
  }
  if (message.includes("network") || message.includes("fetch") || message.includes("econnrefused")) {
    return "network";
  }
  if (message.includes("rate limit") || message.includes("429") || message.includes("too many requests")) {
    return "rate_limit";
  }
  if (message.includes("json") || message.includes("parse") || message.includes("unexpected token") || message.includes("syntax")) {
    return "json_parse";
  }
  if (message.includes("validation") || message.includes("zod") || message.includes("invalid") || message.includes("schema")) {
    return "validation";
  }

  return "unknown";
}

/**
 * Improved JSON extraction from text response
 * Tries multiple strategies to find valid JSON
 */
function extractJSON(text: string): unknown {
  // Strategy 1: Try markdown code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Continue to other methods
    }
  }

  // Strategy 2: Find balanced JSON objects
  const objectMatches = findBalancedJSON(text, "{", "}");
  for (const match of objectMatches) {
    try {
      return JSON.parse(match);
    } catch {
      // Try cleaning common issues
      try {
        const cleaned = cleanJSONString(match);
        return JSON.parse(cleaned);
      } catch {
        // Continue to next match
      }
    }
  }

  // Strategy 3: Find balanced JSON arrays
  const arrayMatches = findBalancedJSON(text, "[", "]");
  for (const match of arrayMatches) {
    try {
      return JSON.parse(match);
    } catch {
      try {
        const cleaned = cleanJSONString(match);
        return JSON.parse(cleaned);
      } catch {
        // Continue to next match
      }
    }
  }

  // Strategy 4: Try parsing the entire text
  try {
    return JSON.parse(text);
  } catch {
    // Last resort: try cleaning and parsing
    try {
      const cleaned = cleanJSONString(text);
      return JSON.parse(cleaned);
    } catch {
      // Provide helpful error message
      const preview = text.length > 100 ? text.substring(0, 100) + "..." : text;
      throw new Error(`Could not extract valid JSON from response. Preview: ${preview}`);
    }
  }
}

/**
 * Find balanced JSON structures in text
 */
function findBalancedJSON(text: string, openChar: string, closeChar: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let startIndex = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === openChar) {
      if (depth === 0) {
        startIndex = i;
      }
      depth++;
    } else if (text[i] === closeChar) {
      depth--;
      if (depth === 0 && startIndex !== -1) {
        results.push(text.substring(startIndex, i + 1));
        startIndex = -1;
      }
    }
  }

  return results;
}

/**
 * Clean common JSON issues
 */
function cleanJSONString(str: string): string {
  return str
    .replace(/[\x00-\x1F\x7F]/g, " ") // Remove control characters
    .replace(/,\s*([\]}])/g, "$1") // Remove trailing commas
    .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3') // Quote unquoted keys
    .trim();
}

/**
 * Timeout wrapper for async operations
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string = "Operation"
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`${operation} timed out after ${timeoutMs}ms`);
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/**
 * Log matcher error to database for tracking and debugging
 */
async function logMatcherError(
  jobId: number,
  attemptNumber: number,
  error: Error,
  scrapingLogId?: number | null
): Promise<void> {
  try {
    const errorType = categorizeError(error);

    await db.insert(matcherErrors).values({
      jobId,
      scrapingLogId: scrapingLogId || null,
      attemptNumber,
      errorType,
      errorMessage: error.message.slice(0, 1000), // Truncate long messages
    });
  } catch (dbError) {
    console.error("[Matcher] Failed to log error to database:", dbError);
  }
}

// Default matcher settings
const DEFAULT_MATCHER_SETTINGS = {
  matcher_model: "gemini-3-flash",
  matcher_bulk_enabled: true,
  matcher_batch_size: 2,
  matcher_max_retries: 3,
  matcher_concurrency_limit: 3,
  matcher_timeout_ms: 30000,
  matcher_backoff_base_delay: 2000,
  matcher_backoff_max_delay: 32000,
  matcher_circuit_breaker_threshold: 10,
  matcher_circuit_breaker_reset_timeout: 60000,
  matcher_auto_match_after_scrape: true,
};

export interface MatcherSettings {
  model: string;
  bulkEnabled: boolean;
  batchSize: number;
  maxRetries: number;
  concurrencyLimit: number;
  timeoutMs: number;
  backoffBaseDelay: number;
  backoffMaxDelay: number;
  circuitBreakerThreshold: number;
  circuitBreakerResetTimeout: number;
  autoMatchAfterScrape: boolean;
}

/**
 * Fetch matcher settings from database with defaults
 */
export async function getMatcherSettings(): Promise<MatcherSettings> {
  const settingKeys = [
    "matcher_model",
    "matcher_bulk_enabled",
    "matcher_batch_size",
    "matcher_max_retries",
    "matcher_concurrency_limit",
    "matcher_timeout_ms",
    "matcher_backoff_base_delay",
    "matcher_backoff_max_delay",
    "matcher_circuit_breaker_threshold",
    "matcher_circuit_breaker_reset_timeout",
    "matcher_auto_match_after_scrape",
  ];
  const dbSettings = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, settingKeys));

  const settingsMap = new Map(dbSettings.map((s) => [s.key, s.value]));

  return {
    model: settingsMap.get("matcher_model") || DEFAULT_MATCHER_SETTINGS.matcher_model,
    bulkEnabled: (settingsMap.get("matcher_bulk_enabled") ?? "true") === "true",
    batchSize: parseInt(settingsMap.get("matcher_batch_size") || String(DEFAULT_MATCHER_SETTINGS.matcher_batch_size), 10),
    maxRetries: parseInt(settingsMap.get("matcher_max_retries") || String(DEFAULT_MATCHER_SETTINGS.matcher_max_retries), 10),
    concurrencyLimit: parseInt(settingsMap.get("matcher_concurrency_limit") || String(DEFAULT_MATCHER_SETTINGS.matcher_concurrency_limit), 10),
    timeoutMs: parseInt(settingsMap.get("matcher_timeout_ms") || String(DEFAULT_MATCHER_SETTINGS.matcher_timeout_ms), 10),
    backoffBaseDelay: parseInt(settingsMap.get("matcher_backoff_base_delay") || String(DEFAULT_MATCHER_SETTINGS.matcher_backoff_base_delay), 10),
    backoffMaxDelay: parseInt(settingsMap.get("matcher_backoff_max_delay") || String(DEFAULT_MATCHER_SETTINGS.matcher_backoff_max_delay), 10),
    circuitBreakerThreshold: parseInt(settingsMap.get("matcher_circuit_breaker_threshold") || String(DEFAULT_MATCHER_SETTINGS.matcher_circuit_breaker_threshold), 10),
    circuitBreakerResetTimeout: parseInt(settingsMap.get("matcher_circuit_breaker_reset_timeout") || String(DEFAULT_MATCHER_SETTINGS.matcher_circuit_breaker_reset_timeout), 10),
    autoMatchAfterScrape: (settingsMap.get("matcher_auto_match_after_scrape") ?? "true") === "true",
  };
}

/**
 * Retry function with exponential backoff and jitter
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
    jobId?: number;
    scrapingLogId?: number | null;
    onRetry?: (attempt: number, delay: number, error: Error) => void;
  }
): Promise<T> {
  const { maxRetries, baseDelay, maxDelay, jobId, scrapingLogId, onRetry } = options;
  let lastError: Error = new Error("Unknown error");

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Log error for each attempt
      if (jobId) {
        await logMatcherError(jobId, attempt, lastError, scrapingLogId);
      }

      if (attempt === maxRetries) {
        // Final attempt failed
        break;
      }

      // Exponential backoff with jitter: baseDelay * 2^attempt + random jitter
      const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      const jitter = Math.random() * 1000; // Up to 1s of random jitter
      const delay = exponentialDelay + jitter;

      console.log(`[Matcher] Attempt ${attempt}/${maxRetries} failed, retrying in ${Math.round(delay)}ms: ${lastError.message}`);
      onRetry?.(attempt, delay, lastError);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

function extractRequirements(description: string | null): string[] {
  if (!description) return [];
  try {
    const matches = description.match(/[-•]\s*(.+)/g);
    if (matches) {
      return matches.map((m) => m.replace(/^[-•]\s*/, "").trim());
    }
  } catch {
    // Ignore parsing errors
  }
  return [];
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export interface MatchOptions {
  scrapingLogId?: number | null;
  sessionId?: string;
}

export async function calculateJobMatch(jobId: number, options?: MatchOptions): Promise<MatchResult> {
  // Fetch matcher settings
  const matcherSettings = await getMatcherSettings();
  const aiModel = await getAIClient(matcherSettings.model);

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

  const jobRequirements = extractRequirements(job.cleanDescription);

  const userPrompt = JOB_MATCHING_USER_PROMPT(job.title, job.cleanDescription || "", jobRequirements, {
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
  });

  // Get circuit breaker
  const circuitBreaker = getMatcherCircuitBreaker({
    failureThreshold: matcherSettings.circuitBreakerThreshold,
    resetTimeout: matcherSettings.circuitBreakerResetTimeout,
  });

  // Generate match using AI with generateObject and retry logic
  // Falls back to generateText + manual parsing if generateObject fails
  const result = await retryWithBackoff(
    async () => {
      return circuitBreaker.execute(async () => {
        return withTimeout(
          (async () => {
            // If USE_GENERATE_OBJECT is disabled, skip straight to generateText
            if (!USE_GENERATE_OBJECT) {
              const { text } = await generateText({
                model: aiModel,
                system: JOB_MATCHING_SYSTEM_PROMPT + JSON_PROMPT_SUFFIX,
                prompt: userPrompt + "\n\nRespond with ONLY the JSON object:",
              });

              const parsed = extractJSON(text);
              return MatchResultSchema.parse(parsed);
            }

            // Try generateObject first
            try {
              const { object } = await generateObject({
                model: aiModel,
                schema: MatchResultSchema,
                system: JOB_MATCHING_SYSTEM_PROMPT,
                prompt: userPrompt,
              });
              return object;
            } catch (error) {
              // Check if this is a NoObjectGeneratedError - fallback to generateText
              const errorName = (error as Error).name || "";
              const errorMessage = (error as Error).message || "";

              if (errorName.includes("NoObjectGeneratedError") || errorMessage.includes("no object generated")) {
                console.log(`[Matcher] generateObject failed for job ${jobId}, falling back to generateText`);

                const { text } = await generateText({
                  model: aiModel,
                  system: JOB_MATCHING_SYSTEM_PROMPT + JSON_PROMPT_SUFFIX,
                  prompt: userPrompt + "\n\nRespond with ONLY the JSON object:",
                });

                try {
                  const parsed = extractJSON(text);
                  return MatchResultSchema.parse(parsed);
                } catch (parseError) {
                  console.error(`[Matcher] JSON extraction failed for job ${jobId}:`, (parseError as Error).message);
                  console.error(`[Matcher] Raw response preview:`, text.substring(0, 300));
                  throw parseError;
                }
              }

              throw error;
            }
          })(),
          matcherSettings.timeoutMs,
          `Match job ${jobId}`
        );
      });
    },
    {
      maxRetries: matcherSettings.maxRetries,
      baseDelay: matcherSettings.backoffBaseDelay,
      maxDelay: matcherSettings.backoffMaxDelay,
      jobId,
      scrapingLogId: options?.scrapingLogId,
      onRetry: (attempt, delay) => {
        console.log(`[Matcher] Job ${jobId}: Retry ${attempt} scheduled after ${Math.round(delay)}ms`);
      },
    }
  );

  // Update job with match results
  await db
    .update(jobs)
    .set({
      matchScore: result.score,
      cleanDescription: result.cleanDescription || null,
      matchReasons: JSON.stringify(result.reasons),
      matchedSkills: JSON.stringify(result.matchedSkills),
      missingSkills: JSON.stringify(result.missingSkills),
      recommendations: JSON.stringify(result.recommendations),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));

  return result;
}

/**
 * Match jobs with full tracking - creates a match session and logs each job result.
 * Uses p-queue for true parallelization with configurable concurrency.
 */
export async function matchJobsWithTracking(
  jobIds: number[],
  triggerSource: "manual" | "auto_scrape" | "company_refresh" = "manual",
  companyId?: number,
  onProgress?: (completed: number, total: number, succeeded: number, failed: number) => void
): Promise<{
  sessionId: string;
  total: number;
  succeeded: number;
  failed: number;
}> {
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

  console.log(`[Matcher] Starting session ${sessionId} for ${jobIds.length} jobs (concurrency: ${matcherSettings.concurrencyLimit})`);

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

  // Fetch user profile once
  const profiles = await db.select().from(profile).limit(1);
  if (profiles.length === 0) {
    // No profile - fail all jobs
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
        modelUsed: matcherSettings.model,
      });
    }
    await db.update(matchSessions).set({
      status: "failed",
      jobsCompleted: jobIds.length,
      jobsFailed: jobIds.length,
      completedAt: new Date(),
    }).where(eq(matchSessions.id, sessionId));

    return { sessionId, total: jobIds.length, succeeded: 0, failed: jobIds.length };
  }

  const userProfile = profiles[0];
  const aiModel = await getAIClient(matcherSettings.model);

  // Fetch skills and experience once
  const [userSkills, userExperience] = await Promise.all([
    db.select().from(skills).where(eq(skills.profileId, userProfile.id)),
    db.select().from(experience).where(eq(experience.profileId, userProfile.id)),
  ]);

  const candidateProfile = {
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
  };

  // Fetch all jobs at once
  const allJobs = await db.select().from(jobs).where(inArray(jobs.id, jobIds));
  const jobsMap = new Map(allJobs.map((j) => [j.id, j]));

  // Get circuit breaker
  const circuitBreaker = getMatcherCircuitBreaker();

  // Process each job in the queue
  const jobPromises = jobIds.map((jobId) =>
    queue.add(async () => {
      const startTime = Date.now();
      const job = jobsMap.get(jobId);

      if (!job) {
        await db.insert(matchLogs).values({
          sessionId,
          jobId,
          status: "failed",
          errorType: "validation",
          errorMessage: "Job not found",
          attemptCount: 1,
          duration: Date.now() - startTime,
          modelUsed: matcherSettings.model,
        });
        failed++;
        completed++;
        await updateSessionProgress();
        onProgress?.(completed, jobIds.length, succeeded, failed);
        return;
      }

      // Check circuit breaker
      if (!circuitBreaker.canExecute()) {
        await db.insert(matchLogs).values({
          sessionId,
          jobId,
          status: "failed",
          errorType: "circuit_breaker",
          errorMessage: "Circuit breaker is open - too many failures",
          attemptCount: 0,
          duration: Date.now() - startTime,
          modelUsed: matcherSettings.model,
        });
        failed++;
        completed++;
        await updateSessionProgress();
        onProgress?.(completed, jobIds.length, succeeded, failed);
        return;
      }

      let attemptCount = 0;
      let lastError: Error | null = null;

      // Retry loop
      for (let attempt = 1; attempt <= matcherSettings.maxRetries; attempt++) {
        attemptCount = attempt;

        try {
          const jobRequirements = extractRequirements(job.cleanDescription);
          const userPrompt = JOB_MATCHING_USER_PROMPT(
            job.title,
            job.cleanDescription || "",
            jobRequirements,
            candidateProfile
          );

          const result = await withTimeout(
            (async () => {
              // If USE_GENERATE_OBJECT is disabled, skip straight to generateText
              if (!USE_GENERATE_OBJECT) {
                const { text } = await generateText({
                  model: aiModel,
                  system: JOB_MATCHING_SYSTEM_PROMPT + JSON_PROMPT_SUFFIX,
                  prompt: userPrompt + "\n\nRespond with ONLY the JSON object:",
                });

                const parsed = extractJSON(text);
                return MatchResultSchema.parse(parsed);
              }

              // Try generateObject first
              try {
                const { object } = await generateObject({
                  model: aiModel,
                  schema: MatchResultSchema,
                  system: JOB_MATCHING_SYSTEM_PROMPT,
                  prompt: userPrompt,
                });
                return object;
              } catch (error) {
                const errorName = (error as Error).name || "";
                const errorMessage = (error as Error).message || "";

                if (errorName.includes("NoObjectGeneratedError") || errorMessage.includes("no object generated")) {
                  console.log(`[Matcher] generateObject failed for job ${jobId}, falling back to generateText`);

                  const { text } = await generateText({
                    model: aiModel,
                    system: JOB_MATCHING_SYSTEM_PROMPT + JSON_PROMPT_SUFFIX,
                    prompt: userPrompt + "\n\nRespond with ONLY the JSON object:",
                  });

                  try {
                    const parsed = extractJSON(text);
                    return MatchResultSchema.parse(parsed);
                  } catch (parseError) {
                    console.error(`[Matcher] JSON extraction failed for job ${jobId}:`, (parseError as Error).message);
                    console.error(`[Matcher] Raw response preview:`, text.substring(0, 300));
                    throw parseError;
                  }
                }

                throw error;
              }
            })(),
            matcherSettings.timeoutMs,
            `Match job ${jobId}`
          );

          // Success - update job
          await db.update(jobs).set({
            matchScore: result.score,
            cleanDescription: result.cleanDescription || null,
            matchReasons: JSON.stringify(result.reasons),
            matchedSkills: JSON.stringify(result.matchedSkills),
            missingSkills: JSON.stringify(result.missingSkills),
            recommendations: JSON.stringify(result.recommendations),
            updatedAt: new Date(),
          }).where(eq(jobs.id, jobId));

          // Log success
          await db.insert(matchLogs).values({
            sessionId,
            jobId,
            status: "success",
            score: result.score,
            attemptCount,
            duration: Date.now() - startTime,
            modelUsed: matcherSettings.model,
          });

          circuitBreaker.recordSuccess();
          succeeded++;
          completed++;
          await updateSessionProgress();
          onProgress?.(completed, jobIds.length, succeeded, failed);
          return;

        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          circuitBreaker.recordFailure(lastError);

          if (attempt < matcherSettings.maxRetries) {
            // Calculate delay with jitter
            const exponentialDelay = Math.min(
              matcherSettings.backoffBaseDelay * Math.pow(2, attempt - 1),
              matcherSettings.backoffMaxDelay
            );
            const jitter = Math.random() * 1000;
            const delay = exponentialDelay + jitter;

            console.log(`[Matcher] Job ${jobId} attempt ${attempt}/${matcherSettings.maxRetries} failed, retrying in ${Math.round(delay)}ms`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      // All retries failed
      const errorType = categorizeError(lastError!);
      await db.insert(matchLogs).values({
        sessionId,
        jobId,
        status: "failed",
        errorType,
        errorMessage: lastError?.message.slice(0, 1000),
        attemptCount,
        duration: Date.now() - startTime,
        modelUsed: matcherSettings.model,
      });

      failed++;
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

  console.log(`[Matcher] Session ${sessionId} completed: ${succeeded} succeeded, ${failed} failed out of ${jobIds.length} jobs`);

  return { sessionId, total: jobIds.length, succeeded, failed };
}

/**
 * Bulk calculate match scores for multiple jobs in a single AI call.
 * More efficient than calling calculateJobMatch one-by-one.
 * Processes jobs in batches based on configured batch size.
 * Falls back to individual matching if bulk is disabled or for failed jobs.
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
  const aiModel = await getAIClient(matcherSettings.model);
  const BATCH_SIZE = matcherSettings.batchSize;

  console.log(`[Matcher] Starting with settings: model=${matcherSettings.model}, bulkEnabled=${matcherSettings.bulkEnabled}, batchSize=${BATCH_SIZE}, maxRetries=${matcherSettings.maxRetries}`);

  // If bulk matching is disabled, process jobs individually
  if (!matcherSettings.bulkEnabled) {
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

  // Fetch user profile once
  const profiles = await db.select().from(profile).limit(1);

  if (profiles.length === 0) {
    // No profile - return error for all jobs
    const error = new Error("No profile found. Please create a profile first.");
    for (const jobId of jobIds) {
      results.set(jobId, error);
      await logMatcherError(jobId, 1, error, options?.scrapingLogId);
    }
    return results;
  }

  const userProfile = profiles[0];

  // Fetch skills and experience once
  const [userSkills, userExperience] = await Promise.all([
    db.select().from(skills).where(eq(skills.profileId, userProfile.id)),
    db.select().from(experience).where(eq(experience.profileId, userProfile.id)),
  ]);

  const candidateProfile = {
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
  };

  // Fetch all jobs at once
  const allJobs = await db.select().from(jobs).where(inArray(jobs.id, jobIds));
  const jobsMap = new Map(allJobs.map((j) => [j.id, j]));

  // Process in batches
  const batches = chunkArray(jobIds, BATCH_SIZE);
  let completed = 0;

  for (const batch of batches) {
    try {
      // Prepare jobs for this batch
      const jobsForMatching: JobForMatching[] = batch
        .map((jobId) => {
          const job = jobsMap.get(jobId);
          if (!job) return null;
          return {
            id: job.id,
            title: job.title,
            description: job.cleanDescription || "",
            requirements: extractRequirements(job.cleanDescription),
          };
        })
        .filter((j): j is JobForMatching => j !== null);

      if (jobsForMatching.length === 0) {
        completed += batch.length;
        onProgress?.(completed, jobIds.length);
        continue;
      }

      // Single AI call for the batch with retry logic
      console.log(`[Matcher] Calling AI for batch of ${jobsForMatching.length} jobs (IDs: ${jobsForMatching.map(j => j.id).join(', ')})`);

      const bulkPrompt = BULK_JOB_MATCHING_USER_PROMPT(jobsForMatching, candidateProfile);

      const batchResults = await retryWithBackoff(
        async () => {
          return withTimeout(
            (async () => {
              try {
                const { object } = await generateObject({
                  model: aiModel,
                  schema: BulkMatchResultSchema,
                  system: BULK_JOB_MATCHING_SYSTEM_PROMPT,
                  prompt: bulkPrompt,
                });
                return object;
              } catch (error) {
                // Check if this is a NoObjectGeneratedError - fallback to generateText
                const errorName = (error as Error).name || "";
                const errorMessage = (error as Error).message || "";

                if (errorName.includes("NoObjectGeneratedError") || errorMessage.includes("no object generated")) {
                  console.log(`[Matcher] generateObject failed for batch, falling back to generateText`);

                  const { text } = await generateText({
                    model: aiModel,
                    system: BULK_JOB_MATCHING_SYSTEM_PROMPT + "\n\nIMPORTANT: You MUST respond with valid JSON only. No explanations, no markdown, just the JSON array.",
                    prompt: bulkPrompt,
                  });

                  const parsed = extractJSON(text);
                  return BulkMatchResultSchema.parse(parsed);
                }

                throw error;
              }
            })(),
            matcherSettings.timeoutMs * 2, // Double timeout for batch
            `Match batch of ${batch.length} jobs`
          );
        },
        {
          maxRetries: matcherSettings.maxRetries,
          baseDelay: matcherSettings.backoffBaseDelay,
          maxDelay: matcherSettings.backoffMaxDelay,
          onRetry: (attempt, delay) => {
            console.log(`[Matcher] Batch retry ${attempt} scheduled after ${Math.round(delay)}ms`);
          },
        }
      );

      console.log(`[Matcher] AI response received for batch with ${batchResults.length} results`);

      // Log which jobs were returned vs expected
      const returnedJobIds = new Set(batchResults.map((r) => r.jobId));
      const requestedJobIds = jobsForMatching.map((j) => j.id);
      const missingJobIds = requestedJobIds.filter((id) => !returnedJobIds.has(id));
      if (missingJobIds.length > 0) {
        console.warn(`[Matcher] AI did not return ${missingJobIds.length} jobs: ${missingJobIds.join(', ')}`);
      }

      // Update each job in the database
      for (const result of batchResults) {
        try {
          await db
            .update(jobs)
            .set({
              matchScore: result.score,
              cleanDescription: result.cleanDescription || null,
              matchReasons: JSON.stringify(result.reasons),
              matchedSkills: JSON.stringify(result.matchedSkills),
              missingSkills: JSON.stringify(result.missingSkills),
              recommendations: JSON.stringify(result.recommendations),
              updatedAt: new Date(),
            })
            .where(eq(jobs.id, result.jobId));

          results.set(result.jobId, {
            score: result.score,
            cleanDescription: result.cleanDescription,
            reasons: result.reasons,
            matchedSkills: result.matchedSkills,
            missingSkills: result.missingSkills,
            recommendations: result.recommendations,
          });
        } catch (dbError) {
          const errorObj = dbError instanceof Error ? dbError : new Error(String(dbError));
          results.set(result.jobId, errorObj);
          await logMatcherError(result.jobId, matcherSettings.maxRetries, errorObj, options?.scrapingLogId);
        }
      }

      // Mark any jobs not in the response as errors (will be retried individually)
      for (const jobId of batch) {
        if (!results.has(jobId)) {
          const error = new Error("Job not included in AI response");
          results.set(jobId, error);
          await logMatcherError(jobId, matcherSettings.maxRetries, error, options?.scrapingLogId);
        }
      }
    } catch (error) {
      // If batch fails after all retries, mark all jobs in batch as errors
      const errorObj = error instanceof Error ? error : new Error(String(error));
      for (const jobId of batch) {
        results.set(jobId, errorObj);
        await logMatcherError(jobId, matcherSettings.maxRetries, errorObj, options?.scrapingLogId);
      }
    }

    completed += batch.length;
    onProgress?.(completed, jobIds.length);

    // Add delay between batches to avoid rate limiting
    if (completed < jobIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Retry failed jobs individually
  const failedJobIds = Array.from(results.entries())
    .filter(([, result]) => result instanceof Error)
    .map(([jobId]) => jobId);

  if (failedJobIds.length > 0) {
    console.log(`[Matcher] Retrying ${failedJobIds.length} failed jobs individually...`);
    for (const jobId of failedJobIds) {
      try {
        const result = await calculateJobMatch(jobId, options);
        results.set(jobId, result);
        console.log(`[Matcher] Individual retry succeeded for job ${jobId}`);
      } catch (error) {
        console.error(`[Matcher] Individual retry failed for job ${jobId}:`, error);
        // Keep the original error in results - it's already logged
      }
    }
  }

  // Log final stats
  const successCount = Array.from(results.values()).filter((r) => !(r instanceof Error)).length;
  const errorCount = Array.from(results.values()).filter((r) => r instanceof Error).length;
  console.log(`[Matcher] Completed: ${successCount} successful, ${errorCount} failed out of ${jobIds.length} jobs`);

  return results;
}

/**
 * @deprecated Use bulkCalculateJobMatches instead for better performance.
 * Sequential matching (one job at a time) - kept for backwards compatibility.
 */
export async function batchCalculateJobMatches(
  jobIds: number[],
  onProgress?: (completed: number, total: number) => void,
  options?: MatchOptions
): Promise<Map<number, MatchResult | Error>> {
  // Use bulk matching instead
  return bulkCalculateJobMatches(jobIds, onProgress, options);
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
  onProgress?: (completed: number, total: number) => void
): Promise<{ total: number; matched: number; failed: number }> {
  const unmatchedJobIds = await getUnmatchedJobIds();

  if (unmatchedJobIds.length === 0) {
    return { total: 0, matched: 0, failed: 0 };
  }

  console.log(`[Matcher] Found ${unmatchedJobIds.length} unmatched jobs, starting matching...`);

  const results = await bulkCalculateJobMatches(unmatchedJobIds, onProgress);

  const matched = Array.from(results.values()).filter((r) => !(r instanceof Error)).length;
  const failed = Array.from(results.values()).filter((r) => r instanceof Error).length;

  return { total: unmatchedJobIds.length, matched, failed };
}

/**
 * Match all unmatched jobs with full tracking
 */
export async function matchUnmatchedJobsWithTracking(
  triggerSource: "manual" | "auto_scrape" | "company_refresh" = "manual",
  onProgress?: (completed: number, total: number, succeeded: number, failed: number) => void
): Promise<{ sessionId: string; total: number; succeeded: number; failed: number }> {
  const unmatchedJobIds = await getUnmatchedJobIds();

  if (unmatchedJobIds.length === 0) {
    return { sessionId: "", total: 0, succeeded: 0, failed: 0 };
  }

  console.log(`[Matcher] Found ${unmatchedJobIds.length} unmatched jobs, starting tracked matching...`);

  return matchJobsWithTracking(unmatchedJobIds, triggerSource, undefined, onProgress);
}
