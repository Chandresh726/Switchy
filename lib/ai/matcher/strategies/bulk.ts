import { z } from "zod";
import { BULK_MATCH_SYSTEM_PROMPT, buildBulkMatchPrompt } from "../prompts";
import { generateStructured } from "../generation";
import { retryWithBackoff, withTimeout, isServerError, isRateLimitError, categorizeError } from "../resilience";
import type { StrategyResultItem, StrategyResultMap, BulkMatchResult, MatchJob } from "../types";
import { BulkMatchResultSchema } from "../types";
import { chunkArray } from "../utils";
import type { BulkStrategy } from "./types";

type BulkMatchResponse = z.infer<typeof BulkMatchResultSchema>;
type BulkProcessResult = { data: BulkMatchResponse; attemptCount: number };

function validateBatchResponse(batchResults: BulkMatchResult[], batchJobs: MatchJob[]): BulkMatchResult[] {
  const batchJobIds = new Set(batchJobs.map((j) => j.id));
  const returnedJobIds = new Set<number>();
  const validatedResults: BulkMatchResult[] = [];

  for (const result of batchResults) {
    if (typeof result.jobId !== "number" || isNaN(result.jobId)) {
      console.warn(`[BulkStrategy] AI returned invalid jobId: ${result.jobId}, ignoring`);
      continue;
    }
    if (!batchJobIds.has(result.jobId)) {
      console.warn(`[BulkStrategy] AI returned jobId ${result.jobId} which was not in the batch, ignoring`);
      continue;
    }
    if (returnedJobIds.has(result.jobId)) {
      console.warn(`[BulkStrategy] AI returned duplicate jobId ${result.jobId}, using first occurrence`);
      continue;
    }
    returnedJobIds.add(result.jobId);
    validatedResults.push(result);
  }

  const missingJobIds = batchJobIds.size - returnedJobIds.size;
  if (missingJobIds > 0) {
    const missingIds = Array.from(batchJobIds).filter((id) => !returnedJobIds.has(id));
    console.warn(`[BulkStrategy] AI response missing ${missingJobIds} job IDs: ${missingIds.join(", ")}`);
  }

  return validatedResults;
}

export const bulkStrategy: BulkStrategy = async (ctx) => {
  const { config, model, providerOptions, circuitBreaker, candidateProfile, jobs, onProgress, onResult, shouldStop } = ctx;

  const results: StrategyResultMap = new Map();
  
  if (jobs.length === 0) {
    return results;
  }

  const batches = chunkArray(jobs, config.batchSize);
  let completed = 0;
  let succeeded = 0;
  let failed = 0;

  const reportResult = async (jobId: number, item: StrategyResultItem) => {
    if (!onResult) return;

    try {
      await onResult(jobId, item);
    } catch (error) {
      console.error(`[BulkStrategy] Failed to report result for job ${jobId}:`, error);
    }
  };

  for (const batch of batches) {
    if (shouldStop && await shouldStop()) {
      console.log("[BulkStrategy] Stop requested, ending remaining batches");
      break;
    }

    if (!circuitBreaker.canExecute()) {
      console.log(`[BulkStrategy] Circuit breaker open, marking ${batch.length} jobs as failed`);
      for (const job of batch) {
        const item = { error: new Error("Circuit breaker open - too many failures"), duration: 0 };
        results.set(job.id, item);
        await reportResult(job.id, item);
        failed++;
      }
      completed += batch.length;
      onProgress?.(completed, jobs.length, succeeded, failed);
      continue;
    }

    const batchStartTime = Date.now();
    try {
      const batchResult = await processBatch(batch, {
        config,
        model,
        providerOptions,
        candidateProfile,
      });
      const rawBatchResults = batchResult.data.results;
      const batchAttemptCount = batchResult.attemptCount;

      const batchResults = validateBatchResponse(rawBatchResults, batch);
      const batchDuration = Date.now() - batchStartTime;

      const successfulJobIds = new Set<number>();
      for (const result of batchResults) {
        const jobDuration = Math.round(batchDuration / batch.length);
        const item = {
          result: {
            score: result.score,
            reasons: result.reasons,
            matchedSkills: result.matchedSkills,
            missingSkills: result.missingSkills,
            recommendations: result.recommendations,
          },
          duration: jobDuration,
          attemptCount: batchAttemptCount,
        };
        results.set(result.jobId, item);
        await reportResult(result.jobId, item);
        successfulJobIds.add(result.jobId);
        succeeded++;
        completed++;
        
        onProgress?.(completed, jobs.length, succeeded, failed);
      }

      for (const job of batch) {
        if (!successfulJobIds.has(job.id)) {
          const item = {
            error: new Error("AI did not return match result for this job"),
            duration: 0,
            attemptCount: batchAttemptCount,
          };
          results.set(job.id, item);
          await reportResult(job.id, item);
          failed++;
          completed++;
          onProgress?.(completed, jobs.length, succeeded, failed);
        }
      }

      circuitBreaker.recordSuccess();
      console.log(`[BulkStrategy] Batch completed: ${batchResults.length}/${batch.length} jobs`);
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      circuitBreaker.recordFailure(errorObj);
      const errorType = categorizeError(errorObj);
      const attemptCount = (errorObj as Error & { attemptCount?: number }).attemptCount ?? 1;
      console.error(`[BulkStrategy] Batch failed: ${errorObj.message} (type: ${errorType})`);

      for (const job of batch) {
        const item = { error: errorObj, duration: 0, attemptCount };
        results.set(job.id, item);
        await reportResult(job.id, item);
        failed++;
        completed++;
        onProgress?.(completed, jobs.length, succeeded, failed);
      }
    }

    if (completed < jobs.length && config.interRequestDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.interRequestDelayMs));
    }
  }

  return results;
};

interface ProcessBatchContext {
  config: Parameters<BulkStrategy>[0]["config"];
  model: Parameters<BulkStrategy>[0]["model"];
  providerOptions: Parameters<BulkStrategy>[0]["providerOptions"];
  candidateProfile: Parameters<BulkStrategy>[0]["candidateProfile"];
}

async function processBatch(
  batch: Parameters<BulkStrategy>[0]["jobs"],
  ctx: ProcessBatchContext
): Promise<BulkProcessResult> {
  const { config, model, providerOptions, candidateProfile } = ctx;
  let attemptCount = 0;

  const prompt = buildBulkMatchPrompt(batch, candidateProfile);

  try {
    const result = await retryWithBackoff(
      async () => {
        return withTimeout(
          (async () => {
            const generated = await generateStructured({
              model,
              schema: BulkMatchResultSchema,
              system: BULK_MATCH_SYSTEM_PROMPT,
              prompt,
              providerOptions,
            });
            return generated.data;
          })(),
          config.timeoutMs * 2,
          `Match batch of ${batch.length} jobs`
        );
      },
      {
        maxRetries: config.maxRetries,
        baseDelay: config.backoffBaseDelay,
        maxDelay: config.backoffMaxDelay,
        onAttempt: (attempt) => {
          attemptCount = attempt;
        },
        onRetry: (attempt, delay, error) => {
          if (error && (isServerError(error) || isRateLimitError(error))) {
            console.log(`[BulkStrategy] Batch retry ${attempt}: Server/rate limit error, returning 3x computed delay`);
            return Math.min(delay * 3, config.backoffMaxDelay);
          }
          console.log(`[BulkStrategy] Batch retry ${attempt} scheduled after ${Math.round(delay)}ms`);
        },
      }
    );

    return {
      data: result,
      attemptCount: Math.max(attemptCount, 1),
    };
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    (errorObj as Error & { attemptCount?: number }).attemptCount = Math.max(attemptCount, 1);
    throw errorObj;
  }
}
