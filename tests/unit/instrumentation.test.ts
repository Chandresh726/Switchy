import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatchPendingScrapeMatches: vi.fn(),
  recoverPending: vi.fn(),
  startScheduler: vi.fn(),
}));

vi.mock("@/lib/jobs/scheduler", () => ({
  startScheduler: mocks.startScheduler,
}));

vi.mock("@/lib/scraper", () => ({
  getLocalScrapeQueueService: () => ({
    recoverPending: mocks.recoverPending,
  }),
}));

vi.mock("@/lib/scraper/matching/outbox", () => ({
  dispatchPendingScrapeMatches: mocks.dispatchPendingScrapeMatches,
}));

import { register } from "@/instrumentation";

const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("server startup instrumentation", () => {
  beforeEach(() => {
    mocks.startScheduler.mockResolvedValue(undefined);
    mocks.recoverPending.mockResolvedValue({
      recovered: 0,
      claimed: 0,
      completed: 0,
      retried: 0,
      failed: 0,
      cancelled: 0,
      nextAvailableAt: null,
    });
    mocks.dispatchPendingScrapeMatches.mockReturnValue(undefined);
  });

  it("does nothing outside the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");

    await register();

    expect(mocks.startScheduler).not.toHaveBeenCalled();
    expect(mocks.recoverPending).not.toHaveBeenCalled();
    expect(mocks.dispatchPendingScrapeMatches).not.toHaveBeenCalled();
  });

  it("starts scheduler, scrape recovery, and matcher recovery independently", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    await register();
    await flushPromises();

    expect(mocks.startScheduler).toHaveBeenCalledTimes(1);
    expect(mocks.recoverPending).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchPendingScrapeMatches).toHaveBeenCalledTimes(1);
  });

  it("isolates failures so every startup recovery path is still attempted", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const schedulerError = new Error("scheduler failed");
    const queueError = new Error("queue failed");
    const matcherError = new Error("matcher failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.startScheduler.mockRejectedValue(schedulerError);
    mocks.recoverPending.mockRejectedValue(queueError);
    mocks.dispatchPendingScrapeMatches.mockImplementation(() => {
      throw matcherError;
    });

    await register();
    await flushPromises();

    expect(mocks.startScheduler).toHaveBeenCalledTimes(1);
    expect(mocks.recoverPending).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchPendingScrapeMatches).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "[Instrumentation] Failed to start scheduler:",
      schedulerError
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[Instrumentation] Failed to recover local scrape queue:",
      queueError
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[Instrumentation] Failed to recover matcher outbox:",
      matcherError
    );
  });
});
