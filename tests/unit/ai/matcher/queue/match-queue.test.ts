import { afterEach, describe, expect, it, vi } from "vitest";

import { resetQueue, withQueue } from "@/lib/ai/matcher/queue/match-queue";
import type { MatcherConfig } from "@/lib/ai/matcher/types";

const config = {
  serializeOperations: true,
} as MatcherConfig;

afterEach(() => resetQueue());

describe("match queue", () => {
  it("removes cancelled work while it is waiting for the local queue", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const first = withQueue(config, async () => {
      started.resolve();
      await release.promise;
      return "first";
    });
    await started.promise;

    const controller = new AbortController();
    const queuedWork = vi.fn(async () => "second");
    const second = withQueue(config, queuedWork, undefined, controller.signal);
    const rejection = expect(second).rejects.toMatchObject({ name: "AbortError" });

    controller.abort();

    await rejection;
    expect(queuedWork).not.toHaveBeenCalled();
    release.resolve();
    await expect(first).resolves.toBe("first");
  });
});
