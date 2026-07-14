import { z } from "zod";

import { parseReasoningEffort } from "@/lib/ai/runtime-context";

import { BULK_MATCH_SYSTEM_PROMPT, buildBulkMatchPrompt } from "../prompts";
import { generateStructured } from "../generation";
import {
  abortableDelay,
  categorizeError,
  throwIfAborted,
} from "../resilience";
import type { StrategyResultItem, StrategyResultMap, BulkMatchResult, MatchJob } from "../types";
import { BulkMatchResultSchema } from "../types";
import { chunkArray } from "../utils";
import type { BulkStrategy } from "./types";

type BulkMatchResponse = z.infer<typeof BulkMatchResultSchema>;
type BulkProcessResult = { data: BulkMatchResponse; attemptCount: number };

const BULK_MATCH_PROMPT_VERSION = "legacy-bulk-match-v1";
const BULK_MATCH_SCHEMA_VERSION = "legacy-bulk-match-result-v1";
const MATCH_POLICY_VERSION = "legacy-matcher-policy-v1";

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
  const {
    config,
    runtime,
    circuitBreaker,
    candidateProfile,
    jobs,
    onProgress,
    onResult,
    shouldStop,
    signal,
  } = ctx;

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
      throwIfAborted(signal);
      console.error(`[BulkStrategy] Failed to report result for job ${jobId}:`, error);
    }
  };

  for (const batch of batches) {
    throwIfAborted(signal);
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
        runtime,
        candidateProfile,
        signal,
      });
      const rawBatchResults = batchResult.data.results;
      const batchAttemptCount = batchResult.attemptCount;

      const batchResults = validateBatchResponse(rawBatchResults, batch);
      const batchDuration = Date.now() - batchStartTime;

      const successfulJobIds = new Set<number>();
      for (const result of batchResults) {
        const item = {
          result: {
            score: result.score,
            reasons: result.reasons,
            matchedSkills: result.matchedSkills,
            missingSkills: result.missingSkills,
            recommendations: result.recommendations,
          },
          duration: batchDuration,
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
            duration: batchDuration,
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
      throwIfAborted(signal);
      const errorObj = error instanceof Error ? error : new Error(String(error));
      const batchDuration = Date.now() - batchStartTime;
      circuitBreaker.recordFailure(errorObj);
      const errorType = categorizeError(errorObj);
      const attemptCount = (errorObj as Error & { attemptCount?: number }).attemptCount ?? 1;
      console.error(`[BulkStrategy] Batch failed: ${errorObj.message} (type: ${errorType})`);

      for (const job of batch) {
        const item = { error: errorObj, duration: batchDuration, attemptCount };
        results.set(job.id, item);
        await reportResult(job.id, item);
        failed++;
        completed++;
        onProgress?.(completed, jobs.length, succeeded, failed);
      }
    }

    if (completed < jobs.length && config.interRequestDelayMs > 0) {
      await abortableDelay(config.interRequestDelayMs, signal);
    }
  }

  return results;
};

interface ProcessBatchContext {
  config: Parameters<BulkStrategy>[0]["config"];
  runtime: Parameters<BulkStrategy>[0]["runtime"];
  candidateProfile: Parameters<BulkStrategy>[0]["candidateProfile"];
  signal?: AbortSignal;
}

async function processBatch(
  batch: Parameters<BulkStrategy>[0]["jobs"],
  ctx: ProcessBatchContext
): Promise<BulkProcessResult> {
  const { config, runtime, candidateProfile, signal } = ctx;

  const prompt = buildBulkMatchPrompt(batch, candidateProfile);

  throwIfAborted(signal);
  const generated = await generateStructured({
    runtime,
    schema: BulkMatchResultSchema,
    instructions: BULK_MATCH_SYSTEM_PROMPT,
    prompt,
    policy: {
      maxAttempts: config.maxRetries,
      timeoutMs: config.timeoutMs * 2,
      reasoningEffort: parseReasoningEffort(config.reasoningEffort),
    },
    subject: {
      type: "job_batch",
      id: batch.map((job) => job.id).join(","),
    },
    promptVersion: BULK_MATCH_PROMPT_VERSION,
    schemaVersion: BULK_MATCH_SCHEMA_VERSION,
    policyVersion: MATCH_POLICY_VERSION,
    retry: {
      baseDelayMs: config.backoffBaseDelay,
      maxDelayMs: config.backoffMaxDelay,
    },
    signal,
  });

  return {
    data: generated.data,
    attemptCount: generated.attempts,
  };
}
