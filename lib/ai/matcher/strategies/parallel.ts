import PQueue from "p-queue";
import { singleStrategy } from "./single";
import type { StrategyResultItem, StrategyResultMap } from "../types";
import type { ParallelStrategy } from "./types";

export const parallelStrategy: ParallelStrategy = async (ctx) => {
  const { config, jobs, onProgress, onResult, shouldStop } = ctx;

  const results: StrategyResultMap = new Map();
  
  if (jobs.length === 0) {
    return results;
  }

  const queue = new PQueue({
    concurrency: config.concurrencyLimit,
    interval: config.interRequestDelayMs > 0 ? config.interRequestDelayMs : undefined,
    intervalCap: 1,
  });

  let completed = 0;
  let succeeded = 0;
  let failed = 0;

  const reportResult = async (jobId: number, item: StrategyResultItem) => {
    if (!onResult) return;

    try {
      await onResult(jobId, item);
    } catch (error) {
      console.error(`[ParallelStrategy] Failed to report result for job ${jobId}:`, error);
    }
  };

  const jobPromises = jobs.map((job) =>
    queue.add(async () => {
      if (shouldStop && await shouldStop()) {
        return;
      }

      const startTime = Date.now();
      try {
        const result = await singleStrategy({
          ...ctx,
          job,
        });
        const item = { result, duration: Date.now() - startTime };
        results.set(job.id, item);
        await reportResult(job.id, item);
        succeeded++;
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        const item = { error: errorObj, duration: Date.now() - startTime };
        results.set(job.id, item);
        await reportResult(job.id, item);
        failed++;
        console.error(`[ParallelStrategy] Job ${job.id} failed:`, errorObj.message);
      }
      completed++;
      onProgress?.(completed, jobs.length, succeeded, failed);
    })
  );

  await Promise.all(jobPromises);

  console.log(`[ParallelStrategy] Completed: ${succeeded} succeeded, ${failed} failed out of ${jobs.length} jobs`);

  return results;
};
