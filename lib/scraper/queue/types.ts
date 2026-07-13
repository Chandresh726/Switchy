import type { ScrapeQueueItem } from "@/lib/db/schema";
import type {
  LocalLeasedWorkRunSummary,
  LocalLeasedWorkStore,
} from "@/lib/scraper/runtime/leased-work-runner";
import type { TriggerSource } from "@/lib/scraper/types";

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
  createSessionAndEnqueue(input: EnqueueScrapeSession): Promise<ScrapeQueueItem[]>;
  requestSessionCancellation(sessionId: string, now: Date): Promise<QueueCancellationResult>;
  listSessionItems(sessionId: string): Promise<ScrapeQueueItem[]>;
}

export type QueueRunSummary = LocalLeasedWorkRunSummary<QueueRecoveryResult>;
