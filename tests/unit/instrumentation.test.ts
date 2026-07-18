import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatchPendingAIWork: vi.fn(),
  importLegacyMatchWork: vi.fn(),
  recoverPending: vi.fn(),
  startScheduler: vi.fn(),
  migrateSchedulerRecoveryState: vi.fn(),
  reconcileConfiguredLocalCLIProviders: vi.fn(),
  removeDeprecatedMatchingPreferenceSettings: vi.fn(),
  warmLocalCLIStatuses: vi.fn(),
  registerRuntimeLock: vi.fn(),
  reconcileResumeStorage: vi.fn(),
  setSchedulerInitialization: vi.fn(),
  setScrapeQueueRecovery: vi.fn(),
  setMatcherDispatchRecovery: vi.fn(),
  setLegacyMatchImportRecovery: vi.fn(),
  recordDispatchSuccess: vi.fn(),
  recordRuntimeError: vi.fn(),
  logRuntimeEvent: vi.fn(),
}));

vi.mock("@/lib/runtime/health", () => ({
  setSchedulerInitialization: mocks.setSchedulerInitialization,
  setScrapeQueueRecovery: mocks.setScrapeQueueRecovery,
  setMatcherDispatchRecovery: mocks.setMatcherDispatchRecovery,
  setLegacyMatchImportRecovery: mocks.setLegacyMatchImportRecovery,
  recordDispatchSuccess: mocks.recordDispatchSuccess,
  recordRuntimeError: mocks.recordRuntimeError,
  logRuntimeEvent: mocks.logRuntimeEvent,
}));

vi.mock("@/lib/state/runtime-lock", () => ({
  registerRuntimeLock: mocks.registerRuntimeLock,
}));

vi.mock("@/lib/application/profile-resume-service", () => ({
  reconcileResumeStorage: mocks.reconcileResumeStorage,
}));

vi.mock("@/lib/ai/providers/provider-service", () => ({
  reconcileConfiguredLocalCLIProviders: mocks.reconcileConfiguredLocalCLIProviders,
}));

vi.mock("@/lib/settings/settings-service", () => ({
  removeDeprecatedMatchingPreferenceSettings: mocks.removeDeprecatedMatchingPreferenceSettings,
}));

vi.mock("@/lib/ai/local-cli/service", () => ({
  warmLocalCLIStatuses: mocks.warmLocalCLIStatuses,
}));

vi.mock("@/lib/jobs/scheduler", () => ({
  startScheduler: mocks.startScheduler,
  migrateSchedulerRecoveryState: mocks.migrateSchedulerRecoveryState,
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
    mocks.reconcileConfiguredLocalCLIProviders.mockResolvedValue(["codex_cli"]);
    mocks.removeDeprecatedMatchingPreferenceSettings.mockResolvedValue(undefined);
    mocks.warmLocalCLIStatuses.mockResolvedValue(undefined);
    mocks.reconcileResumeStorage.mockResolvedValue({
      ready: 0,
      deleted: 0,
      missing: 0,
      orphanedDeleted: 0,
      failed: 0,
    });
  });

  it("does nothing outside the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");

    await register();

    expect(mocks.registerRuntimeLock).not.toHaveBeenCalled();
    expect(mocks.reconcileResumeStorage).not.toHaveBeenCalled();
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
    expect(mocks.migrateSchedulerRecoveryState).toHaveBeenCalledTimes(1);
    expect(mocks.registerRuntimeLock).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileResumeStorage).toHaveBeenCalledTimes(1);
    expect(mocks.recoverPending).toHaveBeenCalledTimes(1);
    expect(mocks.importLegacyMatchWork).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchPendingAIWork).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileConfiguredLocalCLIProviders).toHaveBeenCalledTimes(1);
    expect(mocks.removeDeprecatedMatchingPreferenceSettings).toHaveBeenCalledTimes(1);
    expect(mocks.warmLocalCLIStatuses).toHaveBeenCalledWith(["codex_cli"]);
    expect(mocks.setScrapeQueueRecovery).toHaveBeenLastCalledWith("ready");
    expect(mocks.setMatcherDispatchRecovery).toHaveBeenLastCalledWith("ready");
    expect(mocks.setLegacyMatchImportRecovery).toHaveBeenLastCalledWith("ready");
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
    expect(mocks.setScrapeQueueRecovery).toHaveBeenLastCalledWith("failed");
    expect(mocks.setMatcherDispatchRecovery).toHaveBeenLastCalledWith("failed");
    expect(mocks.setLegacyMatchImportRecovery).toHaveBeenLastCalledWith("ready");
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
    expect(mocks.setLegacyMatchImportRecovery).toHaveBeenLastCalledWith("failed");
    expect(mocks.setMatcherDispatchRecovery).toHaveBeenLastCalledWith("ready");
    expect(consoleError).toHaveBeenCalledWith(
      "[Instrumentation] Failed to import legacy matcher outbox:",
      importError
    );
  });
});
