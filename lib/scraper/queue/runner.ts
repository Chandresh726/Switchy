import type { ScrapeQueueItem } from "@/lib/db/schema";
import { createScrapeAbortError } from "@/lib/scraper/infrastructure/cancellation";

import type {
  ILocalScrapeQueueRepository,
  QueueRunSummary,
  ScrapeQueueHandler,
  ScrapeQueueStateChangeCallback,
} from "./types";

export interface LocalScrapeQueueRunnerConfig {
  concurrency: number;
  leaseDurationMs: number;
  heartbeatIntervalMs: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
}

export const DEFAULT_LOCAL_QUEUE_RUNNER_CONFIG: LocalScrapeQueueRunnerConfig = {
  concurrency: 3,
  leaseDurationMs: 2 * 60 * 1000,
  heartbeatIntervalMs: 15 * 1000,
  baseRetryDelayMs: 5 * 1000,
  maxRetryDelayMs: 5 * 60 * 1000,
};

export class LocalScrapeQueueRunner<TResult = unknown> {
  private readonly config: LocalScrapeQueueRunnerConfig;
  private readonly activeControllers = new Map<string, AbortController>();
  private stopRequested = false;
  private running = false;

  constructor(
    private readonly repository: ILocalScrapeQueueRepository,
    private readonly handler: ScrapeQueueHandler<TResult>,
    config: Partial<LocalScrapeQueueRunnerConfig> = {},
    private readonly onItemStateChange?: ScrapeQueueStateChangeCallback
  ) {
    const merged = { ...DEFAULT_LOCAL_QUEUE_RUNNER_CONFIG, ...config };
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
      baseRetryDelayMs: Math.max(0, merged.baseRetryDelayMs),
      maxRetryDelayMs: Math.max(0, merged.maxRetryDelayMs),
    };
  }

  async runAvailable(): Promise<QueueRunSummary> {
    if (this.running) throw new Error("The local scrape queue runner is already active.");
    this.running = true;
    this.stopRequested = false;

    try {
      const summary: QueueRunSummary = {
        claimed: 0,
        completed: 0,
        retried: 0,
        failed: 0,
        cancelled: 0,
        recovered: await this.repository.recoverExpired(new Date()),
        nextAvailableAt: null,
      };

      const worker = async (workerIndex: number) => {
        const workerId = `local-${process.pid}-${workerIndex}-${crypto.randomUUID()}`;
        try {
          while (!this.stopRequested) {
            const item = await this.repository.claimNext(
              workerId,
              new Date(),
              this.config.leaseDurationMs
            );
            if (!item) return;
            summary.claimed += 1;
            if (this.stopRequested) {
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
        controller.abort(new DOMException("Local queue runner stopped", "AbortError"));
      }
    }
  }

  private async executeItem(
    item: ScrapeQueueItem,
    workerId: string,
    summary: QueueRunSummary
  ): Promise<void> {
    const controller = new AbortController();
    this.activeControllers.set(item.id, controller);
    let monitorPromise: Promise<void> | null = null;
    let monitorStopped = false;
    let cancellationRequested = false;
    let leaseLost = false;

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
      const resultJson = result === undefined ? null : JSON.stringify(result);
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
      } else if (item.attemptCount < item.maxAttempts) {
        const message = error instanceof Error ? error.message : "Unknown queue handler error";
        const retryAt = new Date(
          now.getTime() + this.retryDelay(item.attemptCount, error)
        );
        const retried = await this.repository.retry(item.id, workerId, message, retryAt, now);
        if (retried) {
          summary.retried += 1;
        } else {
          await this.persistRacedCancellation(item.id, workerId, now, summary);
        }
      } else {
        const message = error instanceof Error ? error.message : "Unknown queue handler error";
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
          console.error(
            `[LocalScrapeQueueRunner] Failed to reconcile session ${item.sessionId}:`,
            error
          );
        }
      }
    }
  }

  private retryDelay(attemptCount: number, error?: unknown): number {
    const exponentialDelay = Math.min(
      this.config.maxRetryDelayMs,
      this.config.baseRetryDelayMs * 2 ** Math.max(0, attemptCount - 1)
    );
    const retryAfterMs =
      error &&
      typeof error === "object" &&
      "retryAfterMs" in error &&
      typeof error.retryAfterMs === "number" &&
      Number.isFinite(error.retryAfterMs)
        ? Math.max(0, error.retryAfterMs)
        : 0;
    return Math.min(
      this.config.maxRetryDelayMs,
      Math.max(exponentialDelay, retryAfterMs)
    );
  }

  private async persistRacedCancellation(
    itemId: string,
    workerId: string,
    now: Date,
    summary: QueueRunSummary
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
