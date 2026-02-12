import PQueue from "p-queue";
import type { MatcherConfig } from "../types";
import type { QueueStatus, QueuePositionCallback } from "./types";

let globalQueue: PQueue | null = null;

function getOrCreateQueue(config: MatcherConfig): PQueue {
  if (!globalQueue) {
    globalQueue = new PQueue({
      concurrency: config.serializeOperations ? 1 : Infinity,
    });
    console.log(
      `[MatchQueue] Created queue with concurrency=${config.serializeOperations ? 1 : "unlimited"}`
    );
  }
  return globalQueue;
}

export function getQueueStatus(config: MatcherConfig): QueueStatus {
  const isEnabled = config.serializeOperations;
  
  if (!isEnabled) {
    return {
      isEnabled: false,
      pending: 0,
      size: 0,
      position: 0,
    };
  }
  
  const queue = getOrCreateQueue(config);
  const pending = queue.pending;
  const size = queue.size;
  
  return {
    isEnabled: true,
    pending,
    size,
    position: pending + size,
  };
}

export function getQueuePosition(config: MatcherConfig): number {
  if (!config.serializeOperations) return 0;
  const queue = getOrCreateQueue(config);
  return queue.pending + queue.size;
}

export async function withQueue<T>(
  config: MatcherConfig,
  fn: () => Promise<T>,
  onQueuePosition?: QueuePositionCallback
): Promise<T> {
  if (!config.serializeOperations) {
    return fn();
  }
  
  const queue = getOrCreateQueue(config);
  const position = queue.pending + queue.size;
  
  if (position > 0 && onQueuePosition) {
    onQueuePosition(position);
  }
  
  console.log(`[MatchQueue] Adding to queue (position: ${position})`);
  
  return queue.add(fn) as Promise<T>;
}

export function resetQueue(): void {
  if (globalQueue) {
    globalQueue.clear();
    globalQueue = null;
    console.log("[MatchQueue] Queue reset");
  }
}
