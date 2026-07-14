import type {
  MatchOptions,
  MatchProgressCallback,
  MatchResult,
  MatchResultMap,
  MatchSessionResult,
} from "./types";
import { getMatcherConfig } from "./config";
import { getQueueStatus } from "./queue";
import { executeConfiguredMatchWork } from "./execution/work-executor";
import {
  createMatchSession,
  finalizeMatchSession,
  getUnmatchedJobIds,
  createProgressTracker,
  getMatchSessionCheckpoint,
  getMatchSessionStatus,
  updateMatchSessionIfActive,
} from "./tracking";
import type { StrategyProgressCallback } from "./strategies";

export interface MatchEngine {
  matchSingle(jobId: number, signal?: AbortSignal): Promise<MatchResult>;
  matchBulk(
    jobIds: number[],
    onProgress?: StrategyProgressCallback,
    signal?: AbortSignal
  ): Promise<MatchResultMap>;
  matchWithTracking(jobIds: number[], options: MatchOptions): Promise<MatchSessionResult>;
  getQueueStatus(): { isEnabled: boolean; pending: number; size: number; position: number };
}

export async function createMatchEngine(): Promise<MatchEngine> {
  const config = await getMatcherConfig();

  return {
    async matchSingle(
      jobId: number,
      signal?: AbortSignal
    ): Promise<MatchResult> {
      const executeSingle = async () => {
        const results = await executeConfiguredMatchWork(config, [jobId], {
          signal,
        });

        const result = results.get(jobId);
        if (!result) {
          throw new Error(`No result for job ${jobId}`);
        }
        if (result instanceof Error) {
          throw result;
        }
        return result;
      };

      return executeSingle();
    },

    async matchBulk(
      jobIds: number[],
      onProgress?: StrategyProgressCallback,
      signal?: AbortSignal
    ): Promise<MatchResultMap> {
      return executeConfiguredMatchWork(config, jobIds, {
        signal,
        onProgress,
        onQueued: (position) => {
          console.log(`[MatchEngine] Job in queue position ${position}`);
        },
      });
    },

    async matchWithTracking(
      jobIds: number[],
      options: MatchOptions = {}
    ): Promise<MatchSessionResult> {
      const {
        triggerSource = "manual",
        companyId,
        sessionId: providedSessionId,
        onProgress,
        signal,
      } = options;

      signal?.throwIfAborted();

      if (jobIds.length === 0) {
        return { sessionId: "", total: 0, succeeded: 0, failed: 0 };
      }

      const sessionId = providedSessionId
        ? providedSessionId
        : await createMatchSession(jobIds, triggerSource, companyId);
      const progressTracker = createProgressTracker(jobIds.length, onProgress);
      let progressWriteChain: Promise<void> = Promise.resolve();

      const initialSession = providedSessionId
        ? await getMatchSessionStatus(sessionId)
        : null;
      if (providedSessionId && !initialSession) {
        throw new Error(`Match session ${sessionId} does not exist.`);
      }
      if (
        initialSession &&
        initialSession.status !== "in_progress" &&
        initialSession.status !== "queued"
      ) {
        return {
          sessionId,
          total: initialSession.jobsTotal ?? jobIds.length,
          succeeded: initialSession.jobsSucceeded ?? 0,
          failed: initialSession.jobsFailed ?? 0,
        };
      }

      const checkpoint = providedSessionId
        ? await getMatchSessionCheckpoint(sessionId, jobIds)
        : { completedJobIds: [], succeeded: 0, failed: 0 };
      const completedJobIds = new Set(checkpoint.completedJobIds);
      const pendingJobIds = jobIds.filter((jobId) => !completedJobIds.has(jobId));
      const baseCompleted = checkpoint.succeeded + checkpoint.failed;
      progressTracker.setStats({
        completed: baseCompleted,
        succeeded: checkpoint.succeeded,
        failed: checkpoint.failed,
      });

      const persistProgress = (completed: number, succeeded: number, failed: number) => {
        progressWriteChain = progressWriteChain
          .then(async () => {
            await updateMatchSessionIfActive(sessionId, {
              status: "in_progress",
              jobsCompleted: completed,
              jobsSucceeded: succeeded,
              jobsFailed: failed,
              errorCount: failed,
            });
          })
          .catch((error) => {
            console.error(`[MatchEngine] Failed to persist session progress for ${sessionId}:`, error);
          });
      };

      const markSessionQueued = () => {
        progressWriteChain = progressWriteChain
          .then(async () => {
            await updateMatchSessionIfActive(sessionId, {
              status: "queued",
            });
          })
          .catch((error) => {
            console.error(`[MatchEngine] Failed to persist queued state for ${sessionId}:`, error);
          });
      };

      console.log(
        `[MatchEngine] Starting session ${sessionId} for ${jobIds.length} jobs (bulkEnabled=${config.bulkEnabled}, serializeOperations=${config.serializeOperations})`
      );

      try {
        if (pendingJobIds.length === 0) {
          progressTracker.complete();
          return finalizeMatchSession(
            sessionId,
            checkpoint.succeeded,
            checkpoint.failed,
            jobIds.length
          );
        }

        const results = await executeConfiguredMatchWork(
          config,
          pendingJobIds,
          {
            sessionId,
            signal,
            onStart: async () => {
              await progressWriteChain;

              const started = await updateMatchSessionIfActive(sessionId, {
                startedAt: new Date(),
                status: "in_progress",
                jobsCompleted: baseCompleted,
                jobsSucceeded: checkpoint.succeeded,
                jobsFailed: checkpoint.failed,
                errorCount: checkpoint.failed,
              });

              if (!started) {
                return false;
              }

              progressTracker.setPhase("matching");
              return true;
            },
            shouldStop: async () => {
              signal?.throwIfAborted();
              const currentSession = await getMatchSessionStatus(sessionId);
              return (
                !currentSession ||
                (currentSession.status !== "in_progress" &&
                  currentSession.status !== "queued")
              );
            },
            onProgress: (completed, _total, succeeded, failed) => {
              const cumulativeCompleted = baseCompleted + completed;
              const cumulativeSucceeded = checkpoint.succeeded + succeeded;
              const cumulativeFailed = checkpoint.failed + failed;
              progressTracker.setStats({
                completed: cumulativeCompleted,
                succeeded: cumulativeSucceeded,
                failed: cumulativeFailed,
              });
              persistProgress(
                cumulativeCompleted,
                cumulativeSucceeded,
                cumulativeFailed
              );
            },
            onQueued: (position) => {
              progressTracker.setQueuePosition(position);
              progressTracker.setPhase("queued");
              markSessionQueued();
            },
          }
        );

        const succeeded =
          checkpoint.succeeded +
          Array.from(results.values()).filter((result) => !(result instanceof Error)).length;
        const failed = checkpoint.failed + pendingJobIds.length - (succeeded - checkpoint.succeeded);

        progressTracker.complete();
        await progressWriteChain;

        const currentSession = await getMatchSessionStatus(sessionId);
        if (
          currentSession &&
          currentSession.status !== "in_progress" &&
          currentSession.status !== "queued"
        ) {
          return {
            sessionId,
            total: currentSession.jobsTotal ?? jobIds.length,
            succeeded: currentSession.jobsSucceeded ?? 0,
            failed: currentSession.jobsFailed ?? 0,
          };
        }

        console.log(
          `[MatchEngine] Session ${sessionId} completed: ${succeeded} succeeded, ${failed} failed`
        );

        return finalizeMatchSession(sessionId, succeeded, failed, jobIds.length);
      } catch (error) {
        console.error(`[MatchEngine] Session ${sessionId} failed:`, error);
        await progressWriteChain;
        const latestCheckpoint = await getMatchSessionCheckpoint(sessionId, jobIds);
        const shouldRetryAutomatically =
          !signal?.aborted &&
          triggerSource === "auto_match" &&
          Boolean(providedSessionId);
        await updateMatchSessionIfActive(sessionId, {
          status: shouldRetryAutomatically ? "queued" : "failed",
          jobsCompleted:
            latestCheckpoint.succeeded + latestCheckpoint.failed,
          jobsSucceeded: latestCheckpoint.succeeded,
          jobsFailed: latestCheckpoint.failed,
          errorCount: latestCheckpoint.failed,
        });
        throw error;
      }
    },

    getQueueStatus() {
      return getQueueStatus(config);
    },
  };
}

export async function matchSingle(
  jobId: number,
  signal?: AbortSignal
): Promise<MatchResult> {
  const engine = await createMatchEngine();
  return engine.matchSingle(jobId, signal);
}

export async function matchBulk(
  jobIds: number[],
  onProgress?: StrategyProgressCallback,
  signal?: AbortSignal
): Promise<MatchResultMap> {
  const engine = await createMatchEngine();
  return engine.matchBulk(jobIds, onProgress, signal);
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
