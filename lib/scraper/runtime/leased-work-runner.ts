import { getRetryAfterMs, isRateLimitError } from "@/lib/ai/shared/errors";
import { createScrapeAbortError } from "@/lib/scraper/infrastructure/cancellation";

import { resolveRetryDelay } from "./retry-policy";

export interface LeasedWorkItem {
  id: string;
  attemptCount: number;
  maxAttempts: number;
}

export interface LocalLeasedWorkStore<
  TItem extends LeasedWorkItem,
  TRecovery,
> {
  describeError?(error: unknown): string;
  claimNext(
    workerId: string,
    now: Date,
    leaseDurationMs: number
  ): Promise<TItem | null>;
  heartbeat(
    itemId: string,
    workerId: string,
    leaseExpiresAt: Date
  ): Promise<boolean>;
  isCancellationRequested(itemId: string, workerId: string): Promise<boolean>;
  complete(
    itemId: string,
    workerId: string,
    resultJson: string | null,
    now: Date
  ): Promise<boolean>;
  release(
    itemId: string,
    workerId: string,
    attemptCount: number,
    now: Date
  ): Promise<boolean>;
  retry(
    itemId: string,
    workerId: string,
    error: string,
    availableAt: Date,
    now: Date
  ): Promise<boolean>;
  defer?(itemId: string, workerId: string, error: Error, availableAt: Date, now: Date, attemptCount: number): Promise<boolean>;
  deferSuspended?(itemId: string, workerId: string, error: Error, availableAt: Date, now: Date, attemptCount: number): Promise<boolean>;
  fail(
    itemId: string,
    workerId: string,
    error: string,
    now: Date
  ): Promise<boolean>;
  cancel(itemId: string, workerId: string, now: Date): Promise<boolean>;
  recoverExpired(now: Date): Promise<TRecovery>;
  getNextAvailableAt(): Promise<Date | null>;
}

interface LeasedWorkContext {
  signal: AbortSignal;
  workerId: string;
}

export type LeasedWorkHandler<TItem extends LeasedWorkItem, TResult> = (
  item: TItem,
  context: LeasedWorkContext
) => Promise<TResult>;

export type LeasedWorkStateChangeCallback<TItem extends LeasedWorkItem> = (
  item: TItem
) => Promise<void>;

export type LeasedWorkResultSerializer<TResult> = (
  result: TResult
) => string | null;

export interface LocalLeasedWorkRunSummary<TRecovery> {
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
  cancelled: number;
  recovered: TRecovery;
  nextAvailableAt: Date | null;
}

export interface LocalLeasedWorkRunOptions {
  /** Called once expired leases are reclaimed, before any work is claimed. */
  onRecovered?: () => void;
  canClaim?: () => Promise<boolean>;
}

export interface LocalLeasedWorkRunnerConfig {
  workerIdPrefix: string;
  concurrency: number;
  leaseDurationMs: number;
  heartbeatIntervalMs: number;
  maxClockGapMs: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
  suspensionRetryDelayMs: number;
}

const DEFAULT_LOCAL_LEASED_WORK_RUNNER_CONFIG: LocalLeasedWorkRunnerConfig = {
  workerIdPrefix: "local-work",
  concurrency: 3,
  leaseDurationMs: 2 * 60 * 1000,
  heartbeatIntervalMs: 15 * 1000,
  maxClockGapMs: 60 * 1000,
  baseRetryDelayMs: 5 * 1000,
  maxRetryDelayMs: 5 * 60 * 1000,
  suspensionRetryDelayMs: 60 * 1000,
};

class LocalWorkSuspendedError extends DOMException {
  constructor() {
    super("System suspension detected; local work paused until wake", "AbortError");
  }
}

export class LocalLeasedWorkRunner<
  TItem extends LeasedWorkItem,
  TResult = unknown,
  TRecovery = unknown,
> {
  private readonly config: LocalLeasedWorkRunnerConfig;
  private readonly activeControllers = new Map<string, AbortController>();
  private stopRequested = false;
  private running = false;
  private resumeNotBefore = 0;

  constructor(
    private readonly repository: LocalLeasedWorkStore<TItem, TRecovery>,
    private readonly handler: LeasedWorkHandler<TItem, TResult>,
    config: Partial<LocalLeasedWorkRunnerConfig> = {},
    private readonly onItemStateChange?: LeasedWorkStateChangeCallback<TItem>,
    private readonly serializeResult: LeasedWorkResultSerializer<TResult> = (result) =>
      result === undefined ? null : JSON.stringify(result)
  ) {
    const merged = { ...DEFAULT_LOCAL_LEASED_WORK_RUNNER_CONFIG, ...config };
    const leaseDurationMs = Math.max(1_000, merged.leaseDurationMs);
    const maxHeartbeatIntervalMs = Math.max(100, Math.floor(leaseDurationMs / 3));
    this.config = {
      ...merged,
      concurrency: Math.max(1, Math.floor(merged.concurrency)),
      leaseDurationMs,
      heartbeatIntervalMs: Math.min(
        Math.max(100, merged.heartbeatIntervalMs),
        maxHeartbeatIntervalMs
      ),
      maxClockGapMs: Math.max(
        Math.min(Math.max(100, merged.heartbeatIntervalMs), maxHeartbeatIntervalMs) * 2,
        merged.maxClockGapMs
      ),
      baseRetryDelayMs: Math.max(0, merged.baseRetryDelayMs),
      maxRetryDelayMs: Math.max(0, merged.maxRetryDelayMs),
      suspensionRetryDelayMs: Math.max(1_000, merged.suspensionRetryDelayMs),
    };
  }

  async runAvailable(
    options: LocalLeasedWorkRunOptions = {}
  ): Promise<LocalLeasedWorkRunSummary<TRecovery>> {
    if (this.running) throw new Error("The local leased-work runner is already active.");
    this.running = true;
    this.stopRequested = false;

    try {
      const summary: LocalLeasedWorkRunSummary<TRecovery> = {
        claimed: 0,
        completed: 0,
        retried: 0,
        failed: 0,
        cancelled: 0,
        recovered: await this.repository.recoverExpired(new Date()),
        nextAvailableAt: null,
      };
      options.onRecovered?.();

      const worker = async (workerIndex: number) => {
        const workerId = `${this.config.workerIdPrefix}-${process.pid}-${workerIndex}-${crypto.randomUUID()}`;
        try {
          while (!this.stopRequested) {
            if (Date.now() < this.resumeNotBefore) return;
            if (options.canClaim && !await options.canClaim()) {
              this.resumeNotBefore = Date.now() + this.config.suspensionRetryDelayMs;
              return;
            }
            const item = await this.repository.claimNext(
              workerId,
              new Date(),
              this.config.leaseDurationMs
            );
            if (!item) return;
            summary.claimed += 1;
            if (this.stopRequested || Date.now() < this.resumeNotBefore) {
              const now = new Date();
              const released = await this.repository.release(
                item.id,
                workerId,
                item.attemptCount,
                now
              );
              if (!released) {
                await this.persistRacedCancellation(item.id, workerId, now, summary);
              }
              return;
            }
            await this.executeItem(item, workerId, summary);
          }
        } catch (error) {
          this.requestStop();
          throw error;
        }
      };

      const workerResults = await Promise.allSettled(
        Array.from({ length: this.config.concurrency }, (_, index) => worker(index))
      );
      const failedWorker = workerResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      if (failedWorker) throw failedWorker.reason;
      summary.nextAvailableAt = await this.repository.getNextAvailableAt();
      if (summary.nextAvailableAt && this.resumeNotBefore > Date.now()) {
        summary.nextAvailableAt = new Date(Math.max(
          summary.nextAvailableAt.getTime(), this.resumeNotBefore
        ));
      }
      return summary;
    } finally {
      this.running = false;
      this.activeControllers.clear();
    }
  }

  stop(): void {
    this.requestStop();
  }

  private requestStop(): void {
    this.stopRequested = true;
    for (const controller of this.activeControllers.values()) {
      if (!controller.signal.aborted) {
        controller.abort(new DOMException("Local work runner stopped", "AbortError"));
      }
    }
  }

  private async executeItem(
    item: TItem,
    workerId: string,
    summary: LocalLeasedWorkRunSummary<TRecovery>
  ): Promise<void> {
    const controller = new AbortController();
    this.activeControllers.set(item.id, controller);
    let monitorPromise: Promise<void> | null = null;
    let monitorStopped = false;
    let cancellationRequested = false;
    let leaseLost = false;
    let lastMonitorTickAt = Date.now();

    const monitor = async () => {
      try {
        cancellationRequested = await this.repository.isCancellationRequested(
          item.id,
          workerId
        );
        if (monitorStopped) return;
        if (cancellationRequested) {
          controller.abort(new DOMException("Queue item cancelled", "AbortError"));
          return;
        }
        const leaseExpiresAt = new Date(Date.now() + this.config.leaseDurationMs);
        const renewed = await this.repository.heartbeat(item.id, workerId, leaseExpiresAt);
        if (!monitorStopped && !renewed) {
          leaseLost = true;
          controller.abort(new DOMException("Queue item lease was lost", "AbortError"));
        }
      } catch (error) {
        if (!monitorStopped) {
          leaseLost = true;
          controller.abort(
            new DOMException(
              error instanceof Error ? error.message : "Queue lease monitor failed",
              "AbortError"
            )
          );
        }
      }
    };
    const monitorTimer = setInterval(() => {
      if (monitorStopped || monitorPromise) return;
      const currentTickAt = Date.now();
      const clockGapMs = currentTickAt - lastMonitorTickAt;
      lastMonitorTickAt = currentTickAt;
      if (clockGapMs > this.config.maxClockGapMs) {
        this.resumeNotBefore = currentTickAt + this.config.suspensionRetryDelayMs;
        // Pause every leased task, including tasks waiting for a resource gate.
        for (const active of this.activeControllers.values()) {
          if (!active.signal.aborted) active.abort(new LocalWorkSuspendedError());
        }
        return;
      }
      const currentMonitor = monitor();
      monitorPromise = currentMonitor;
      void currentMonitor.finally(() => {
        if (monitorPromise === currentMonitor) monitorPromise = null;
      });
    }, this.config.heartbeatIntervalMs);

    try {
      const result = await this.handler(item, { signal: controller.signal, workerId });
      if (controller.signal.aborted) throw createScrapeAbortError(controller.signal);
      cancellationRequested = await this.repository.isCancellationRequested(item.id, workerId);
      if (cancellationRequested) {
        controller.abort(new DOMException("Queue item cancelled", "AbortError"));
        throw createScrapeAbortError(controller.signal);
      }
      const resultJson = this.serializeResult(result);
      const completed = await this.repository.complete(item.id, workerId, resultJson, new Date());
      if (!completed) {
        cancellationRequested = await this.repository.isCancellationRequested(item.id, workerId);
        if (cancellationRequested) {
          controller.abort(new DOMException("Queue item cancelled", "AbortError"));
          throw createScrapeAbortError(controller.signal);
        }
        throw new Error("Queue item ownership was lost before completion.");
      }
      summary.completed += 1;
    } catch (error) {
      const now = new Date();
      if (!cancellationRequested) {
        cancellationRequested = await this.repository.isCancellationRequested(
          item.id,
          workerId
        );
      }
      if (cancellationRequested) {
        const cancelled = await this.repository.cancel(item.id, workerId, now);
        if (cancelled) summary.cancelled += 1;
      } else if (leaseLost) {
        // A cancellation can race between the monitor read and heartbeat update.
        // This no-ops safely when ownership was genuinely lost.
        await this.persistRacedCancellation(item.id, workerId, now, summary);
      } else if (this.stopRequested) {
        const released = await this.repository.release(
          item.id,
          workerId,
          item.attemptCount,
          now
        );
        if (!released) {
          await this.persistRacedCancellation(item.id, workerId, now, summary);
        }
      } else if (controller.signal.reason instanceof LocalWorkSuspendedError) {
        const defer = this.repository.deferSuspended ?? this.repository.defer;
        const deferred = defer
          ? await defer.call(this.repository,
            item.id, workerId, controller.signal.reason,
            new Date(this.resumeNotBefore), now, Math.max(0, item.attemptCount - 1)
          )
          : await this.repository.release(item.id, workerId, item.attemptCount, now);
        if (deferred) summary.retried += 1;
        else await this.persistRacedCancellation(item.id, workerId, now, summary);
      } else if (isRateLimitError(error) && this.repository.defer) {
        const until = new Date(Math.ceil((now.getTime() + Math.max(30_000, getRetryAfterMs(error) ?? 0)) / 1000) * 1000);
        const deferred = await this.repository.defer(item.id, workerId,
          error instanceof Error ? error : new Error("Provider rate limited"), until, now, Math.max(0, item.attemptCount - 1));
        if (deferred) summary.retried += 1;
        else await this.persistRacedCancellation(item.id, workerId, now, summary);
      } else if (item.attemptCount < item.maxAttempts) {
        const message = this.repository.describeError?.(error) ?? (error instanceof Error ? error.message : "Unknown queue handler error");
        const retryAt = new Date(
          now.getTime() +
            resolveRetryDelay(item.attemptCount, error, this.config)
        );
        const retried = await this.repository.retry(item.id, workerId, message, retryAt, now);
        if (retried) {
          summary.retried += 1;
        } else {
          await this.persistRacedCancellation(item.id, workerId, now, summary);
        }
      } else {
        const message = this.repository.describeError?.(error) ?? (error instanceof Error ? error.message : "Unknown queue handler error");
        const failed = await this.repository.fail(item.id, workerId, message, now);
        if (failed) {
          summary.failed += 1;
        } else {
          await this.persistRacedCancellation(item.id, workerId, now, summary);
        }
      }
    } finally {
      monitorStopped = true;
      clearInterval(monitorTimer);
      await monitorPromise;
      this.activeControllers.delete(item.id);
      if (this.onItemStateChange) {
        try {
          await this.onItemStateChange(item);
        } catch (error) {
          console.error("[LocalLeasedWorkRunner] Item state callback failed:", error);
        }
      }
    }
  }

  private async persistRacedCancellation(
    itemId: string,
    workerId: string,
    now: Date,
    summary: LocalLeasedWorkRunSummary<TRecovery>
  ): Promise<void> {
    const cancellationRequested = await this.repository.isCancellationRequested(
      itemId,
      workerId
    );
    if (!cancellationRequested) return;
    const cancelled = await this.repository.cancel(itemId, workerId, now);
    if (cancelled) summary.cancelled += 1;
  }
}
