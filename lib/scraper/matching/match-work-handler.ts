import { z } from "zod";

import {
  executeMatchWork,
  type MatchWorkExecutionOptions,
} from "@/lib/ai/matcher/execution/work-executor";
import type { MatchResultMap } from "@/lib/ai/matcher/types";
import type { ScrapeMatchOutboxItem } from "@/lib/db/schema";

import type { MatchWorkResult } from "./work-contracts";
import type { MatchCheckpoint, MatchWorkStore } from "./match-work-store";

const JobIdsSchema = z.array(z.number().int().positive()).min(1);

export type MatchWorkExecutor = (
  jobIds: number[],
  options: MatchWorkExecutionOptions
) => Promise<MatchResultMap>;

function completedCount(checkpoint: MatchCheckpoint): number {
  return checkpoint.succeeded + checkpoint.failed;
}

function ownershipLost(): DOMException {
  return new DOMException("Match work ownership was lost", "AbortError");
}

export class MatchWorkHandler {
  constructor(
    private readonly store: MatchWorkStore,
    private readonly execute: MatchWorkExecutor = executeMatchWork
  ) {}

  async handle(
    item: ScrapeMatchOutboxItem,
    signal: AbortSignal,
    workerId: string
  ): Promise<MatchWorkResult> {
    const startedAt = Date.now();
    const jobIds = JobIdsSchema.parse(JSON.parse(item.jobIdsJson));
    const state = await this.store.getExecutionState(item.id, jobIds);
    if (state.completedResult) return state.completedResult;

    const completedJobIds = new Set(state.checkpoint.completedJobIds);
    const pendingJobIds = jobIds.filter((jobId) => !completedJobIds.has(jobId));
    if (pendingJobIds.length === 0) {
      return {
        sessionId: item.id,
        total: jobIds.length,
        succeeded: state.checkpoint.succeeded,
        failed: state.checkpoint.failed,
        duration: Date.now() - startedAt,
      };
    }

    const ownershipController = new AbortController();
    const executionSignal = AbortSignal.any([
      signal,
      ownershipController.signal,
    ]);
    let progressWrites: Promise<void> = Promise.resolve();
    let progressError: unknown;
    const enqueueProgressWrite = (write: () => Promise<boolean>) => {
      progressWrites = progressWrites
        .then(async () => {
          if (progressError) return;
          signal.throwIfAborted();
          if (!(await write())) throw ownershipLost();
        })
        .catch((error: unknown) => {
          progressError ??= error;
          if (!ownershipController.signal.aborted) {
            ownershipController.abort(error);
          }
        });
    };

    const results = await this.execute(pendingJobIds, {
      sessionId: item.id,
      signal: executionSignal,
      onQueued: () => {
        enqueueProgressWrite(() =>
          this.store.markQueued(item.id, workerId, state.checkpoint)
        );
      },
      onStart: async () => {
        await progressWrites;
        if (progressError) throw progressError;
        signal.throwIfAborted();
        if (
          !(await this.store.markStarted(
            item.id,
            workerId,
            state.checkpoint,
            new Date()
          ))
        ) {
          throw ownershipLost();
        }
      },
      onProgress: (completed, _total, succeeded, failed) => {
        enqueueProgressWrite(() =>
          this.store.updateProgress(
            item.id,
            workerId,
            completedCount(state.checkpoint) + completed,
            state.checkpoint.succeeded + succeeded,
            state.checkpoint.failed + failed
          )
        );
      },
    });
    await progressWrites;
    if (progressError) throw progressError;
    executionSignal.throwIfAborted();

    const succeeded =
      state.checkpoint.succeeded +
      Array.from(results.values()).filter((result) => !(result instanceof Error)).length;
    const failed =
      state.checkpoint.failed +
      pendingJobIds.length -
      (succeeded - state.checkpoint.succeeded);

    return {
      sessionId: item.id,
      total: jobIds.length,
      succeeded,
      failed,
      duration: Date.now() - startedAt,
    };
  }
}
