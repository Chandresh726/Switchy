import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatchPendingAIWork: vi.fn(),
  importLegacyMatchWork: vi.fn(),
  recoverPending: vi.fn(),
  startScheduler: vi.fn(),
  ensureBuiltinLocalCLIProviders: vi.fn(),
  removeDeprecatedMatchingPreferenceSettings: vi.fn(),
  warmLocalCLIStatuses: vi.fn(),
}));

vi.mock("@/lib/ai/providers/provider-service", () => ({
  ensureBuiltinLocalCLIProviders: mocks.ensureBuiltinLocalCLIProviders,
}));

vi.mock("@/lib/settings/settings-service", () => ({
  removeDeprecatedMatchingPreferenceSettings: mocks.removeDeprecatedMatchingPreferenceSettings,
}));

vi.mock("@/lib/ai/local-cli/service", () => ({
  warmLocalCLIStatuses: mocks.warmLocalCLIStatuses,
}));

vi.mock("@/lib/jobs/scheduler", () => ({
  startScheduler: mocks.startScheduler,
}));

vi.mock("@/lib/scraper", () => ({
  getLocalScrapeQueueService: () => ({
    recoverPending: mocks.recoverPending,
  }),
}));

vi.mock("@/lib/ai/work-items", () => ({
  dispatchPendingAIWork: mocks.dispatchPendingAIWork,
  importLegacyMatchWork: mocks.importLegacyMatchWork,
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
    mocks.dispatchPendingAIWork.mockReturnValue(undefined);
    mocks.importLegacyMatchWork.mockReturnValue(0);
    mocks.ensureBuiltinLocalCLIProviders.mockResolvedValue(undefined);
    mocks.removeDeprecatedMatchingPreferenceSettings.mockResolvedValue(undefined);
    mocks.warmLocalCLIStatuses.mockResolvedValue(undefined);
  });

  it("does nothing outside the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");

    await register();

    expect(mocks.startScheduler).not.toHaveBeenCalled();
    expect(mocks.warmLocalCLIStatuses).not.toHaveBeenCalled();
    expect(mocks.recoverPending).not.toHaveBeenCalled();
    expect(mocks.dispatchPendingAIWork).not.toHaveBeenCalled();
  });

  it("starts scheduler, scrape recovery, and matcher recovery independently", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    await register();
    await flushPromises();

    expect(mocks.startScheduler).toHaveBeenCalledTimes(1);
    expect(mocks.recoverPending).toHaveBeenCalledTimes(1);
    expect(mocks.importLegacyMatchWork).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchPendingAIWork).toHaveBeenCalledTimes(1);
    expect(mocks.ensureBuiltinLocalCLIProviders).toHaveBeenCalledTimes(1);
    expect(mocks.removeDeprecatedMatchingPreferenceSettings).toHaveBeenCalledTimes(1);
    expect(mocks.warmLocalCLIStatuses).toHaveBeenCalledTimes(1);
  });

  it("isolates failures so every startup recovery path is still attempted", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const schedulerError = new Error("scheduler failed");
    const queueError = new Error("queue failed");
    const matcherError = new Error("matcher failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.startScheduler.mockRejectedValue(schedulerError);
    mocks.recoverPending.mockRejectedValue(queueError);
    mocks.dispatchPendingAIWork.mockImplementation(() => {
      throw matcherError;
    });

    await register();
    await flushPromises();

    expect(mocks.startScheduler).toHaveBeenCalledTimes(1);
    expect(mocks.recoverPending).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchPendingAIWork).toHaveBeenCalledTimes(1);
    expect(mocks.warmLocalCLIStatuses).toHaveBeenCalledTimes(1);
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

  it("does not delay other startup services while CLI warming is pending", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    mocks.warmLocalCLIStatuses.mockReturnValue(new Promise(() => undefined));

    await register();
    await flushPromises();

    expect(mocks.warmLocalCLIStatuses).toHaveBeenCalledTimes(1);
    expect(mocks.startScheduler).toHaveBeenCalledTimes(1);
    expect(mocks.recoverPending).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchPendingAIWork).toHaveBeenCalledTimes(1);
  });

  it("dispatches current AI work even when legacy import fails", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const importError = new Error("legacy payload failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.importLegacyMatchWork.mockImplementation(() => {
      throw importError;
    });

    await register();
    await flushPromises();

    expect(mocks.importLegacyMatchWork).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchPendingAIWork).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "[Instrumentation] Failed to import legacy matcher outbox:",
      importError
    );
  });
});
