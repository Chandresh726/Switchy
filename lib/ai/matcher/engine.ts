import type { MatchResult, MatchResultMap, MatchSessionResult, MatchProgressCallback, MatchOptions } from "./types";
import { getMatcherConfig } from "./config";
import { withQueue, getQueueStatus } from "./queue";
import { executeMatch } from "./execution";
import { createMatchSession, finalizeMatchSession, getUnmatchedJobIds, createProgressTracker } from "./tracking";
import type { StrategyProgressCallback } from "./strategies";

export interface MatchEngine {
  matchSingle(jobId: number): Promise<MatchResult>;
  matchBulk(jobIds: number[], onProgress?: StrategyProgressCallback): Promise<MatchResultMap>;
  matchWithTracking(jobIds: number[], options: MatchOptions): Promise<MatchSessionResult>;
  getQueueStatus(): { isEnabled: boolean; pending: number; size: number; position: number };
}

export async function createMatchEngine(): Promise<MatchEngine> {
  const config = await getMatcherConfig();

  return {
    async matchSingle(jobId: number): Promise<MatchResult> {
      const results = await executeMatch({
        config,
        jobIds: [jobId],
      });

      const result = results.get(jobId);
      if (!result) {
        throw new Error(`No result for job ${jobId}`);
      }
      if (result instanceof Error) {
        throw result;
      }
      return result;
    },

    async matchBulk(
      jobIds: number[],
      onProgress?: StrategyProgressCallback
    ): Promise<MatchResultMap> {
      return withQueue(
        config,
        async () => {
          return executeMatch({
            config,
            jobIds,
            onProgress,
          });
        },
        (position) => {
          console.log(`[MatchEngine] Job in queue position ${position}`);
        }
      );
    },

    async matchWithTracking(
      jobIds: number[],
      options: MatchOptions = {}
    ): Promise<MatchSessionResult> {
      const { triggerSource = "manual", companyId, onProgress } = options;

      if (jobIds.length === 0) {
        return { sessionId: "", total: 0, succeeded: 0, failed: 0 };
      }

      const sessionId = await createMatchSession(jobIds, triggerSource, companyId);
      const progressTracker = createProgressTracker(jobIds.length, onProgress);

      console.log(
        `[MatchEngine] Starting session ${sessionId} for ${jobIds.length} jobs (bulkEnabled=${config.bulkEnabled}, serializeOperations=${config.serializeOperations})`
      );

      try {
        const results = await withQueue(
          config,
          async () => {
            progressTracker.setPhase("matching");

            return executeMatch({
              config,
              jobIds,
              sessionId,
              onProgress: (completed, total, succeeded, failed) => {
                progressTracker.setStats({ completed, succeeded, failed });
              },
            });
          },
          (position) => {
            progressTracker.setQueuePosition(position);
            progressTracker.setPhase("queued");
          }
        );

        const succeeded = Array.from(results.values()).filter((r) => !(r instanceof Error)).length;
        const failed = jobIds.length - succeeded;

        progressTracker.complete();

        console.log(
          `[MatchEngine] Session ${sessionId} completed: ${succeeded} succeeded, ${failed} failed`
        );

        return finalizeMatchSession(sessionId, succeeded, failed, jobIds.length);
      } catch (error) {
        console.error(`[MatchEngine] Session ${sessionId} failed:`, error);
        await finalizeMatchSession(sessionId, 0, jobIds.length, jobIds.length);
        throw error;
      }
    },

    getQueueStatus() {
      return getQueueStatus(config);
    },
  };
}

export async function matchSingle(jobId: number): Promise<MatchResult> {
  const engine = await createMatchEngine();
  return engine.matchSingle(jobId);
}

export async function matchBulk(
  jobIds: number[],
  onProgress?: StrategyProgressCallback
): Promise<MatchResultMap> {
  const engine = await createMatchEngine();
  return engine.matchBulk(jobIds, onProgress);
}

export async function matchWithTracking(
  jobIds: number[],
  options: MatchOptions = {}
): Promise<MatchSessionResult> {
  const engine = await createMatchEngine();
  return engine.matchWithTracking(jobIds, options);
}

export async function matchUnmatchedJobs(
  onProgress?: MatchProgressCallback
): Promise<MatchSessionResult> {
  const unmatchedJobIds = await getUnmatchedJobIds();

  if (unmatchedJobIds.length === 0) {
    return { sessionId: "", total: 0, succeeded: 0, failed: 0 };
  }

  console.log(`[MatchEngine] Found ${unmatchedJobIds.length} unmatched jobs`);

  return matchWithTracking(unmatchedJobIds, {
    triggerSource: "manual",
    onProgress,
  });
}
