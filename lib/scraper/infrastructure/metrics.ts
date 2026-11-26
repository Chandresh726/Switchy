import { AsyncLocalStorage } from "node:async_hooks";

import type { ScrapeMetrics } from "@/lib/scraper/types/result";

const scope = new AsyncLocalStorage<ScrapeMetrics>();

export function createScrapeMetrics(readyQueueMs: number): ScrapeMetrics {
  return {
    readyQueueMs: Math.max(0, readyQueueMs), executionWaitMs: 0, platformLockWaitMs: 0,
    hostSlotWaitMs: 0, httpRequests: 0, httpMs: 0, pacingWaitMs: 0, retryWaitMs: 0,
    retries: 0, rateLimits: 0, cooldownBlocks: 0, priorityDetailsSelected: 0, maintenanceDetailsSelected: 0,
  };
}

export function withScrapeMetrics<T>(metrics: ScrapeMetrics, operation: () => Promise<T>): Promise<T> {
  return scope.run(metrics, operation);
}

export function recordScrapeMetric(name: keyof ScrapeMetrics, value = 1): void {
  const metrics = scope.getStore();
  if (metrics) metrics[name] += Math.max(0, Math.round(value));
}

export async function measureScrapeMetric<T>(name: keyof ScrapeMetrics, operation: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try { return await operation(); }
  finally { recordScrapeMetric(name, performance.now() - start); }
}
