import type { ScrapeQueueItem } from "@/lib/db/schema";
import type { TriggerSource } from "@/lib/scraper/types";

export type ScrapeQueueStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface EnqueueScrapeWork {
  sessionId: string;
  companyIds: number[];
  priority?: number;
  maxAttempts?: number;
  availableAt?: Date;
}

export interface EnqueueScrapeSession {
  sessionId: string;
  triggerSource: TriggerSource;
  companyIds: number[];
  priority?: number;
  maxAttempts?: number;
  availableAt?: Date;
}

export interface QueueRecoveryResult {
  requeued: number;
  failed: number;
  cancelled: number;
}

export interface QueueCancellationResult {
  cancelledQueued: number;
  signalledRunning: number;
  sessionStopped: boolean;
}

export interface ILocalScrapeQueueRepository {
  enqueue(input: EnqueueScrapeWork): Promise<ScrapeQueueItem[]>;
  createSessionAndEnqueue(input: EnqueueScrapeSession): Promise<ScrapeQueueItem[]>;
  claimNext(workerId: string, now: Date, leaseDurationMs: number): Promise<ScrapeQueueItem | null>;
  heartbeat(itemId: string, workerId: string, leaseExpiresAt: Date): Promise<boolean>;
  isCancellationRequested(itemId: string, workerId: string): Promise<boolean>;
  complete(itemId: string, workerId: string, resultJson: string | null, now: Date): Promise<boolean>;
  release(itemId: string, workerId: string, attemptCount: number, now: Date): Promise<boolean>;
  retry(itemId: string, workerId: string, error: string, availableAt: Date, now: Date): Promise<boolean>;
  fail(itemId: string, workerId: string, error: string, now: Date): Promise<boolean>;
  cancel(itemId: string, workerId: string, now: Date): Promise<boolean>;
  requestSessionCancellation(sessionId: string, now: Date): Promise<QueueCancellationResult>;
  recoverExpired(now: Date): Promise<QueueRecoveryResult>;
  listSessionItems(sessionId: string): Promise<ScrapeQueueItem[]>;
  getNextAvailableAt(): Promise<Date | null>;
}

export interface QueueWorkContext {
  signal: AbortSignal;
  workerId: string;
}

export type ScrapeQueueHandler<TResult = unknown> = (
  item: ScrapeQueueItem,
  context: QueueWorkContext
) => Promise<TResult>;

export interface QueueRunSummary {
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
  cancelled: number;
  recovered: QueueRecoveryResult;
  nextAvailableAt: Date | null;
}

export type ScrapeQueueStateChangeCallback = (
  item: ScrapeQueueItem
) => Promise<void>;
