export interface DetailHydratorOptions<TItem, TResult> {
  items: TItem[];
  initialBatchSize: number;
  minBatchSize?: number;
  maxBatchSize?: number;
  initialDelayMs: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  fetcher: (item: TItem) => Promise<TResult | null>;
}

export interface DetailHydratorResult<TResult> {
  results: TResult[];
  failures: number;
}

export async function hydrateDetailsInBatches<TItem, TResult>(
  options: DetailHydratorOptions<TItem, TResult>
): Promise<DetailHydratorResult<TResult>> {
  const {
    items,
    initialBatchSize,
    minBatchSize = 1,
    maxBatchSize = initialBatchSize,
    initialDelayMs,
    minDelayMs = Math.max(0, initialDelayMs - 300),
    maxDelayMs = Math.max(initialDelayMs, initialDelayMs + 2000),
    fetcher,
  } = options;

  const results: TResult[] = [];
  let failures = 0;
  let index = 0;
  let currentBatchSize = Math.max(minBatchSize, Math.min(maxBatchSize, initialBatchSize));
  let currentDelayMs = Math.max(minDelayMs, Math.min(maxDelayMs, initialDelayMs));

  while (index < items.length) {
    const batch = items.slice(index, index + currentBatchSize);

    const batchResults = await Promise.all(
      batch.map(async (item) => {
        try {
          return await fetcher(item);
        } catch {
          return null;
        }
      })
    );

    let batchFailures = 0;
    for (const result of batchResults) {
      if (result) {
        results.push(result);
      } else {
        failures++;
        batchFailures++;
      }
    }

    if (batchFailures > 0) {
      currentBatchSize = Math.max(minBatchSize, currentBatchSize - 1);
      currentDelayMs = Math.min(maxDelayMs, currentDelayMs + 250);
    } else {
      currentBatchSize = Math.min(maxBatchSize, currentBatchSize + 1);
      currentDelayMs = Math.max(minDelayMs, currentDelayMs - 100);
    }

    index += batch.length;
    if (index < items.length) {
      await delay(currentDelayMs);
    }
  }

  return { results, failures };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
