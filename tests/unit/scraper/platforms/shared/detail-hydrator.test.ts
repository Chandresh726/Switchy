import { describe, expect, it, vi } from "vitest";

import { runWithScrapeSignal } from "@/lib/scraper/infrastructure/cancellation";

import { hydrateDetailsInBatches } from "@/lib/scraper/platforms/shared/detail-hydrator";

describe("hydrateDetailsInBatches", () => {
  it("rethrows abort failures instead of counting them as detail failures", async () => {
    const controller = new AbortController();
    const operation = runWithScrapeSignal(controller.signal, () =>
      hydrateDetailsInBatches({
        items: [1],
        initialBatchSize: 1,
        initialDelayMs: 0,
        fetcher: async () => {
          throw new DOMException("Scrape cancelled", "AbortError");
        },
      })
    );

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels adaptive pacing delays before the next batch starts", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async (item: number) => item);
    const operation = runWithScrapeSignal(controller.signal, () =>
      hydrateDetailsInBatches({
        items: [1, 2],
        initialBatchSize: 1,
        maxBatchSize: 1,
        initialDelayMs: 10_000,
        fetcher,
      })
    );
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    controller.abort(new DOMException("Scrape cancelled", "AbortError"));

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
