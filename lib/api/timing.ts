import { AsyncLocalStorage } from "node:async_hooks";

interface RequestMetrics {
  queries: number;
}

const requestMetrics = new AsyncLocalStorage<RequestMetrics>();

export const queryMetricsLogger = {
  logQuery(): void {
    const metrics = requestMetrics.getStore();
    if (metrics) metrics.queries += 1;
  },
};

// Scope metrics to each request, including concurrent requests and serialization.
// Query parameters and result data never enter the metrics.
export async function withApiTiming<T extends Response>(operation: () => Promise<T>): Promise<T> {
  const metrics: RequestMetrics = { queries: 0 };
  return requestMetrics.run(metrics, async () => {
    const started = performance.now();
    const response = await operation();
    response.headers.append("Server-Timing", `app;dur=${(performance.now() - started).toFixed(2)}, db;desc="${metrics.queries} queries"`);
    response.headers.set("X-DB-Query-Count", String(metrics.queries));
    return response;
  });
}
