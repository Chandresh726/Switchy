import type { ScrapeQueueItem } from "@/lib/db/schema";
import type {
  LeasedWorkContext,
  LeasedWorkHandler,
  LeasedWorkStateChangeCallback,
  LocalLeasedWorkRunSummary,
  LocalLeasedWorkStore,
} from "@/lib/scraper/runtime/leased-work-runner";
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

export interface ILocalScrapeQueueRepository
  extends LocalLeasedWorkStore<ScrapeQueueItem, QueueRecoveryResult> {
  enqueue(input: EnqueueScrapeWork): Promise<ScrapeQueueItem[]>;
  createSessionAndEnqueue(input: EnqueueScrapeSession): Promise<ScrapeQueueItem[]>;
  requestSessionCancellation(sessionId: string, now: Date): Promise<QueueCancellationResult>;
  listSessionItems(sessionId: string): Promise<ScrapeQueueItem[]>;
}

export type QueueWorkContext = LeasedWorkContext;

export type ScrapeQueueHandler<TResult = unknown> = LeasedWorkHandler<
  ScrapeQueueItem,
  TResult
>;

export type QueueRunSummary = LocalLeasedWorkRunSummary<QueueRecoveryResult>;

export type ScrapeQueueStateChangeCallback =
  LeasedWorkStateChangeCallback<ScrapeQueueItem>;
