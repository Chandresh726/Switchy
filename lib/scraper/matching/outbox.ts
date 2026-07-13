import { db } from "@/lib/db";
import type { ScrapeMatchOutboxItem } from "@/lib/db/schema";
import {
  LocalLeasedWorkRunner,
  type LocalLeasedWorkRunSummary,
} from "@/lib/scraper/runtime/leased-work-runner";
import { ScheduledSingleFlightDispatcher } from "@/lib/scraper/runtime/single-flight-dispatcher";

import {
  MatchWorkHandler,
  type MatchWorkExecutor,
} from "./match-work-handler";
import { DrizzleMatchWorkStore } from "./match-work-store";
import type { MatchWorkResult } from "./work-contracts";

export interface ScrapeMatchOutboxDispatcherConfig {
  leaseDurationMs: number;
  heartbeatIntervalMs: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
  busyRetries: number;
  busyRetryDelayMs: number;
}

export type ScrapeMatchOutboxRunSummary = LocalLeasedWorkRunSummary<number>;

export type ScrapeMatchExecutor = MatchWorkExecutor;

const DEFAULT_CONFIG: ScrapeMatchOutboxDispatcherConfig = {
  leaseDurationMs: 2 * 60 * 1000,
  heartbeatIntervalMs: 15 * 1000,
  baseRetryDelayMs: 5 * 1000,
  maxRetryDelayMs: 5 * 60 * 1000,
  busyRetries: 4,
  busyRetryDelayMs: 25,
};

export class ScrapeMatchOutboxDispatcher {
  private readonly store: DrizzleMatchWorkStore;
  private readonly runner: LocalLeasedWorkRunner<
    ScrapeMatchOutboxItem,
    MatchWorkResult,
    number
  >;

  constructor(
    database: typeof db = db,
    executeMatch?: MatchWorkExecutor,
    config: Partial<ScrapeMatchOutboxDispatcherConfig> = {}
  ) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    this.store = new DrizzleMatchWorkStore(database, {
      busyRetries: merged.busyRetries,
      busyRetryDelayMs: merged.busyRetryDelayMs,
    });
    const handler = new MatchWorkHandler(this.store, executeMatch);
    this.runner = new LocalLeasedWorkRunner(
      this.store,
      (item, { signal, workerId }) => handler.handle(item, signal, workerId),
      {
        workerIdPrefix: "match-outbox",
        concurrency: 1,
        leaseDurationMs: merged.leaseDurationMs,
        heartbeatIntervalMs: merged.heartbeatIntervalMs,
        baseRetryDelayMs: merged.baseRetryDelayMs,
        maxRetryDelayMs: merged.maxRetryDelayMs,
      }
    );
  }

  runAvailable(): Promise<ScrapeMatchOutboxRunSummary> {
    return this.runner.runAvailable();
  }

  stop(): void {
    this.runner.stop();
  }

  renewLease(
    itemId: string,
    workerId: string,
    leaseExpiresAt: Date
  ): Promise<boolean> {
    return this.store.heartbeat(itemId, workerId, leaseExpiresAt);
  }
}

const defaultDispatcher = new ScrapeMatchOutboxDispatcher();
const scheduledDispatcher = new ScheduledSingleFlightDispatcher({
  run: () => defaultDispatcher.runAvailable(),
  getNextRunAt: (summary) => summary.nextAvailableAt,
  failureRetryMs: DEFAULT_CONFIG.baseRetryDelayMs,
  onError: (error) => {
    console.error("[Matcher Outbox] Dispatch failed:", error);
  },
});

export function dispatchPendingScrapeMatches(): void {
  void scheduledDispatcher.request();
}

export async function recoverPendingScrapeMatches(): Promise<ScrapeMatchOutboxRunSummary> {
  return scheduledDispatcher.request({ rerunIfActive: false });
}
