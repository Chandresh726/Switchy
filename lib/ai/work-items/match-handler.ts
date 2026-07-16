import type { MatchWorkExecutionOptions } from "@/lib/ai/matcher/execution/work-executor";
import type { MatchResultMap } from "@/lib/ai/matcher/types";
import type { AIWorkItem } from "@/lib/db/schema";

import { parseMatchWorkPayload, type MatchWorkResult } from "./contracts";
import type { AIWorkStore, MatchCheckpoint } from "./repository";

export type MatchWorkExecutor = (
  jobIds: number[],
  options: MatchWorkExecutionOptions
) => Promise<MatchResultMap>;

const executeDefaultMatchWork: MatchWorkExecutor = async (jobIds, options) => {
  const { executeMatchWork } = await import("@/lib/ai/matcher/execution/work-executor");
  return executeMatchWork(jobIds, options);
};

function completedCount(checkpoint: MatchCheckpoint): number {
  return checkpoint.succeeded + checkpoint.failed;
}

function ownershipLost(): DOMException {
  return new DOMException("AI match work ownership was lost", "AbortError");
}

export class AIMatchWorkHandler {
  constructor(
    private readonly store: AIWorkStore,
    private readonly execute: MatchWorkExecutor = executeDefaultMatchWork
  ) {}

  async handle(item: AIWorkItem, signal: AbortSignal, workerId: string): Promise<MatchWorkResult> {
    const startedAt = Date.now();
    const payload = parseMatchWorkPayload(item.payloadJson);
    const state = await this.store.getExecutionState(item.id, payload.jobIds);
    if (state.completedResult) return state.completedResult;
    const completedJobIds = new Set(state.checkpoint.completedJobIds);
    const pendingJobIds = payload.jobIds.filter((jobId) => !completedJobIds.has(jobId));
    if (pendingJobIds.length === 0) {
      return {
        sessionId: item.id,
        total: payload.jobIds.length,
        succeeded: state.checkpoint.succeeded,
        failed: state.checkpoint.failed,
        duration: Date.now() - startedAt,
      };
    }

    const ownershipController = new AbortController();
    const executionSignal = AbortSignal.any([signal, ownershipController.signal]);
    let progressWrites: Promise<void> = Promise.resolve();
    let progressError: unknown;
    const enqueueProgressWrite = (write: () => Promise<boolean>) => {
      progressWrites = progressWrites.then(async () => {
        if (progressError) return;
        signal.throwIfAborted();
        if (!(await write())) throw ownershipLost();
      }).catch((error: unknown) => {
        progressError ??= error;
        if (!ownershipController.signal.aborted) ownershipController.abort(error);
      });
    };

    const results = await this.execute(pendingJobIds, {
      sessionId: item.id,
      signal: executionSignal,
      onQueued: () => enqueueProgressWrite(() =>
        this.store.markQueued(item.id, workerId, state.checkpoint)),
      onStart: async () => {
        await progressWrites;
        if (progressError) throw progressError;
        signal.throwIfAborted();
        if (!(await this.store.markStarted(item.id, workerId, state.checkpoint, new Date()))) {
          throw ownershipLost();
        }
      },
      onProgress: (completed, _total, succeeded, failed) => enqueueProgressWrite(() =>
        this.store.updateProgress(
          item.id,
          workerId,
          completedCount(state.checkpoint) + completed,
          state.checkpoint.succeeded + succeeded,
          state.checkpoint.failed + failed
        )),
    });
    await progressWrites;
    if (progressError) throw progressError;
    executionSignal.throwIfAborted();
    const newlySucceeded = Array.from(results.values())
      .filter((result) => !(result instanceof Error)).length;
    return {
      sessionId: item.id,
      total: payload.jobIds.length,
      succeeded: state.checkpoint.succeeded + newlySucceeded,
      failed: state.checkpoint.failed + pendingJobIds.length - newlySucceeded,
      duration: Date.now() - startedAt,
    };
  }
}
