import { sanitizeAIError } from "@/lib/ai/shared/errors";
import { db } from "@/lib/db";
import type { AIWorkItem } from "@/lib/db/schema";
import {
  LocalLeasedWorkRunner,
  type LocalLeasedWorkRunSummary,
} from "@/lib/scraper/runtime/leased-work-runner";
import { ScheduledSingleFlightDispatcher } from "@/lib/scraper/runtime/single-flight-dispatcher";
import {
  recordDispatchSuccess,
  recordRuntimeError,
  setMatcherDispatchRecovery,
} from "@/lib/runtime/health";

import type { MatchWorkResult } from "./contracts";
import { AIMatchWorkHandler, type MatchWorkExecutor } from "./match-handler";
import { DrizzleAIWorkStore } from "./repository";

export type AIWorkRunSummary = LocalLeasedWorkRunSummary<number>;

const MAX_DURABLE_MATCH_WORKERS = 10;

const DEFAULT_CONFIG = {
  // Durable sessions may progress concurrently. The provider limiter remains
  // the authority for the user-selected per-provider request ceiling.
  concurrency: MAX_DURABLE_MATCH_WORKERS,
  leaseDurationMs: 2 * 60 * 1000,
  heartbeatIntervalMs: 15 * 1000,
  baseRetryDelayMs: 5 * 1000,
  maxRetryDelayMs: 5 * 60 * 1000,
};

export class AIWorkDispatcher {
  private readonly runner: LocalLeasedWorkRunner<AIWorkItem, MatchWorkResult, number>;

  constructor(
    database: typeof db = db,
    executeMatch?: MatchWorkExecutor,
    config: Partial<typeof DEFAULT_CONFIG> = {}
  ) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    const store = new DrizzleAIWorkStore(database);
    const handler = new AIMatchWorkHandler(store, executeMatch);
    this.runner = new LocalLeasedWorkRunner(
      store,
      (item, { signal, workerId }) => handler.handle(item, signal, workerId),
      { ...merged, workerIdPrefix: "ai-work" }
    );
  }

  runAvailable(): Promise<AIWorkRunSummary> {
    return this.runner.runAvailable();
  }

  stop(): void {
    this.runner.stop();
  }
}

const defaultDispatcher = new AIWorkDispatcher();
const scheduledDispatcher = new ScheduledSingleFlightDispatcher({
  run: async () => {
    const summary = await defaultDispatcher.runAvailable();
    recordDispatchSuccess();
    setMatcherDispatchRecovery("ready");
    return summary;
  },
  getNextRunAt: (summary) => summary.nextAvailableAt,
  failureRetryMs: DEFAULT_CONFIG.baseRetryDelayMs,
  onError: (error) => {
    setMatcherDispatchRecovery("failed");
    recordRuntimeError("matcher", "matcher_dispatch_failed");
    const sanitized = sanitizeAIError(error);
    console.error(`[AI Work] Dispatch failed: [${sanitized.code}] ${sanitized.message}`);
  },
});

export function dispatchPendingAIWork(): Promise<AIWorkRunSummary> {
  return scheduledDispatcher.request();
}
