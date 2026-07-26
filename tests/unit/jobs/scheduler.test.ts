import { beforeEach, describe, expect, it, vi } from "vitest";

type SettingsRow = {
  key: string;
  value: string | null;
  updatedAt?: Date;
};

type SessionRow = Record<string, unknown>;

const store = vi.hoisted(() => ({
  settings: new Map<string, SettingsRow>(),
  sessions: [] as SessionRow[],
  task: null as {
    execute: () => Promise<void>;
    stop: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    listeners: Map<string, (context: { date: Date }) => Promise<void> | void>;
  } | null,
  acquireSchedulerLock: vi.fn(),
  refreshSchedulerLock: vi.fn(),
  releaseSchedulerLock: vi.fn(),
  scrapeAllCompanies: vi.fn(),
  validate: vi.fn(),
  failSettingKey: null as string | null,
}));

vi.mock("drizzle-orm", () => ({
  eq: (_column: unknown, value: string) => value,
}));

vi.mock("@/lib/db/schema", () => ({
  settings: { __table: "settings", key: "key" },
  scrapeSessions: { __table: "scrape_sessions" },
}));

vi.mock("@/lib/db", () => ({
  db: (() => {
    const select = () => ({
      from: (table: { __table?: string }) => ({
        where: (value: string) => ({
          get: () => table.__table === "settings" ? store.settings.get(value) : undefined,
          limit: async () => {
            if (table.__table === "settings") {
              const row = store.settings.get(value);
              return row ? [row] : [];
            }
            return [];
          },
        }),
      }),
    });
    const insert = (table: { __table?: string }) => ({
      values: (value: Record<string, unknown>) => {
        let executed = false;
        const executeSession = () => {
          if (!executed && table.__table === "scrape_sessions") store.sessions.push(value);
          executed = true;
        };
        if (table.__table === "scrape_sessions") {
          return {
            run: executeSession,
            then: (resolve: (value?: unknown) => void) => { executeSession(); resolve(); },
          };
        }
        const upsert = ({ set }: { set: { value: string | null; updatedAt: Date } }) => {
          const executeSetting = () => {
            if (executed) return;
            if (store.failSettingKey === String(value.key)) {
              throw new Error("injected scheduler persistence failure");
            }
            store.settings.set(String(value.key), {
              key: String(value.key),
              value: set.value,
              updatedAt: set.updatedAt,
            });
            executed = true;
          };
          return {
            run: executeSetting,
            then: (resolve: (value?: unknown) => void) => { executeSetting(); resolve(); },
          };
        };
        return { onConflictDoUpdate: upsert };
      },
    });
    const remove = () => ({
      where: (key: string) => ({
        run: () => { store.settings.delete(key); },
      }),
    });
    const database = {
      select,
      insert,
      delete: remove,
      transaction: (operation: (tx: { select: typeof select; insert: typeof insert; delete: typeof remove }) => unknown) => {
        const settingsBefore = new Map(store.settings);
        const sessionsBefore = [...store.sessions];
        try {
          return operation({ select, insert, delete: remove });
        } catch (error) {
          store.settings.clear();
          for (const [key, value] of settingsBefore) store.settings.set(key, value);
          store.sessions.splice(0, store.sessions.length, ...sessionsBefore);
          throw error;
        }
      },
    };
    return database;
  })(),
}));

vi.mock("node-cron", () => {
  const schedule = vi.fn((expression: string, fn: () => Promise<void>) => {
    void expression;
    void fn;
    const listeners = new Map<string, (context: { date: Date }) => Promise<void> | void>();
    const task = {
      execute: fn,
      stop: vi.fn(),
      on: vi.fn((event: string, listener: (context: { date: Date }) => Promise<void> | void) => {
        listeners.set(event, listener);
      }),
      off: vi.fn((event: string) => {
        listeners.delete(event);
      }),
      listeners,
    };
    store.task = task;
    return task;
  });

  return {
    default: {
      schedule,
      validate: store.validate,
    },
    schedule,
    validate: store.validate,
  };
});

vi.mock("@/lib/scraper", () => ({
  getLocalScrapeQueueService: () => ({
    scrapeAllCompanies: store.scrapeAllCompanies,
  }),
}));

vi.mock("@/lib/jobs/scheduler-lease-store", () => ({
  getSchedulerLeaseStore: () => ({
    acquire: store.acquireSchedulerLock,
    refresh: store.refreshSchedulerLock,
    release: store.releaseSchedulerLock,
  }),
}));

describe("scheduler recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    store.settings.clear();
    store.sessions.length = 0;
    store.task = null;
    store.failSettingKey = null;
    store.validate.mockReturnValue(true);
    store.acquireSchedulerLock.mockResolvedValue("lock-token");
    store.refreshSchedulerLock.mockResolvedValue("lock-token");
    store.releaseSchedulerLock.mockResolvedValue(undefined);
    store.scrapeAllCompanies.mockResolvedValue({
      summary: {
        successfulCompanies: 1,
        totalCompanies: 1,
        totalJobsAdded: 3,
      },
    });
  });

  it("records missed executions as skipped sessions and pending recovery", async () => {
    const scheduler = await import("@/lib/jobs/scheduler");
    const missedAt = new Date(2026, 3, 5, 6, 30);
    const expectedScheduledFor = new Date(2026, 3, 5, 6);

    await scheduler.startScheduler();
    await store.task?.listeners.get("execution:missed")?.({
      date: missedAt,
    });

    const status = await scheduler.getSchedulerStatus();

    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]?.status).toBe("skipped");
    expect(store.sessions[0]?.triggerSource).toBe("scheduler");
    expect(
      (store.sessions[0]?.scheduledForAt as Date)?.toISOString()
    ).toBe(expectedScheduledFor.toISOString());
    expect(
      (store.sessions[0]?.startedAt as Date)?.toISOString()
    ).toBe(expectedScheduledFor.toISOString());
    expect(status.pendingMissedCount).toBe(1);
    expect(status.oldestMissedRun?.toISOString()).toBe(
      expectedScheduledFor.toISOString()
    );
  });

  it("migrates legacy scheduler keys into one versioned recovery record", async () => {
    store.settings.set("scheduler.pendingRecovery", { key: "scheduler.pendingRecovery", value: "true" });
    store.settings.set("scheduler.missedCount", { key: "scheduler.missedCount", value: "2" });
    store.settings.set("scheduler.oldestMissedRun", { key: "scheduler.oldestMissedRun", value: "2026-04-05T00:30:00.000Z" });
    store.settings.set("scheduler.latestMissedRun", { key: "scheduler.latestMissedRun", value: "2026-04-05T06:30:00.000Z" });
    const scheduler = await import("@/lib/jobs/scheduler");

    scheduler.migrateSchedulerRecoveryState();

    expect(JSON.parse(store.settings.get("scheduler.recovery.v1")?.value ?? "{}")).toEqual({
      version: 1,
      pendingMissedCount: 2,
      oldestMissedRun: "2026-04-05T00:30:00.000Z",
      latestMissedRun: "2026-04-05T06:30:00.000Z",
    });
    expect(store.settings.has("scheduler.pendingRecovery")).toBe(false);
    expect(store.settings.has("scheduler.missedCount")).toBe(false);
  });

  it("preserves unsupported future scheduler recovery records", async () => {
    const future = JSON.stringify({
      version: 2,
      pendingMissedCount: 3,
      oldestMissedRun: "2026-04-05T00:30:00.000Z",
      latestMissedRun: "2026-04-05T06:30:00.000Z",
    });
    store.settings.set("scheduler.recovery.v1", { key: "scheduler.recovery.v1", value: future });
    store.settings.set("scheduler.pendingRecovery", { key: "scheduler.pendingRecovery", value: "true" });
    const scheduler = await import("@/lib/jobs/scheduler");

    expect(() => scheduler.migrateSchedulerRecoveryState()).toThrow(
      "Scheduler recovery state version is unsupported"
    );
    expect(store.settings.get("scheduler.recovery.v1")?.value).toBe(future);
    expect(store.settings.has("scheduler.pendingRecovery")).toBe(true);
  });

  it("rejects invalid persisted scheduler timestamps without deleting legacy state", async () => {
    const invalid = JSON.stringify({
      version: 1,
      pendingMissedCount: 1,
      oldestMissedRun: "not-a-date",
      latestMissedRun: "2026-04-05T06:30:00.000Z",
    });
    store.settings.set("scheduler.recovery.v1", { key: "scheduler.recovery.v1", value: invalid });
    store.settings.set("scheduler.missedCount", { key: "scheduler.missedCount", value: "1" });
    const scheduler = await import("@/lib/jobs/scheduler");

    expect(() => scheduler.migrateSchedulerRecoveryState()).toThrow(
      "Scheduler recovery state is invalid"
    );
    expect(store.settings.get("scheduler.recovery.v1")?.value).toBe(invalid);
    expect(store.settings.has("scheduler.missedCount")).toBe(true);
  });

  it("rolls back scheduler recovery state and session metadata on an injected write failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.failSettingKey = "scheduler.recovery.v1";
    const scheduler = await import("@/lib/jobs/scheduler");

    await scheduler.startScheduler();
    await store.task?.listeners.get("execution:missed")?.({
      date: new Date("2026-04-05T06:30:00.000Z"),
    });

    expect(store.settings.has("scheduler.recovery.v1")).toBe(false);
    expect(store.sessions).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      "[Scheduler] Failed to persist missed execution:",
      expect.objectContaining({ message: "injected scheduler persistence failure" })
    );
  });

  it("coalesces multiple missed executions into one recovery batch and clears pending state", async () => {
    const scheduler = await import("@/lib/jobs/scheduler");

    await scheduler.startScheduler();
    const missedListener = store.task?.listeners.get("execution:missed");
    await missedListener?.({ date: new Date("2026-04-05T06:30:00.000Z") });
    await missedListener?.({ date: new Date("2026-04-05T12:30:00.000Z") });

    const result = await scheduler.recoverMissedSchedulerRuns();
    const status = await scheduler.getSchedulerStatus();

    expect(result.status).toBe("started");
    expect(store.scrapeAllCompanies).toHaveBeenCalledTimes(1);
    expect(store.scrapeAllCompanies).toHaveBeenCalledWith("scheduler_recovery");
    expect(status.pendingMissedCount).toBe(0);
  });

  it("executes the normal cron callback with the scheduler trigger and releases its lock", async () => {
    const scheduler = await import("@/lib/jobs/scheduler");

    await scheduler.startScheduler();
    await store.task?.execute();

    expect(store.acquireSchedulerLock).toHaveBeenCalledTimes(1);
    expect(store.scrapeAllCompanies).toHaveBeenCalledWith("scheduler");
    expect(store.releaseSchedulerLock).toHaveBeenCalledWith("lock-token");
    expect(store.settings.get("scheduler.lastRun")?.value).toMatch(
      /^\d{4}-\d{2}-\d{2}T/
    );
  });

  it("releases the scheduler lock when a normal refresh fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.scrapeAllCompanies.mockRejectedValue(new Error("refresh failed"));
    const scheduler = await import("@/lib/jobs/scheduler");

    await scheduler.startScheduler();
    await store.task?.execute();

    expect(store.releaseSchedulerLock).toHaveBeenCalledWith("lock-token");
    expect(store.settings.has("scheduler.lastRun")).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      "[Scheduler] Error during refresh:",
      expect.objectContaining({ message: "refresh failed" })
    );
  });

  it("waits for an in-flight lease refresh before releasing the lock", async () => {
    vi.useFakeTimers();
    let resolveRefresh!: (token: string) => void;
    let resolveScrape!: (result: {
      summary: {
        successfulCompanies: number;
        totalCompanies: number;
        totalJobsAdded: number;
      };
    }) => void;
    store.refreshSchedulerLock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveRefresh = resolve;
        })
    );
    store.scrapeAllCompanies.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveScrape = resolve;
        })
    );
    const scheduler = await import("@/lib/jobs/scheduler");

    await scheduler.startScheduler();
    const run = store.task?.execute();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.scrapeAllCompanies).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.refreshSchedulerLock).toHaveBeenCalledWith("lock-token");
    resolveScrape({
      summary: {
        successfulCompanies: 1,
        totalCompanies: 1,
        totalJobsAdded: 0,
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(store.releaseSchedulerLock).not.toHaveBeenCalled();

    resolveRefresh("lock-token");
    await run;
    expect(store.releaseSchedulerLock).toHaveBeenCalledWith("lock-token");
  });

  it("does not recover when scheduler is disabled", async () => {
    store.settings.set("scheduler_enabled", {
      key: "scheduler_enabled",
      value: "false",
    });

    const scheduler = await import("@/lib/jobs/scheduler");
    const result = await scheduler.recoverMissedSchedulerRuns();

    expect(result.status).toBe("disabled");
    expect(store.scrapeAllCompanies).not.toHaveBeenCalled();
  });

  it("returns already_running for concurrent recovery attempts", async () => {
    const scheduler = await import("@/lib/jobs/scheduler");

    await scheduler.startScheduler();
    await store.task?.listeners.get("execution:missed")?.({
      date: new Date("2026-04-05T06:30:00.000Z"),
    });

    let resolveRun: (() => void) | null = null;
    store.acquireSchedulerLock
      .mockResolvedValueOnce("lock-token")
      .mockResolvedValueOnce(null);
    store.scrapeAllCompanies.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRun = () =>
            resolve({
              summary: {
                successfulCompanies: 1,
                totalCompanies: 1,
                totalJobsAdded: 0,
              },
            });
        })
    );

    const firstRecovery = scheduler.recoverMissedSchedulerRuns();
    const secondRecovery = await scheduler.recoverMissedSchedulerRuns();
    const completeRun = resolveRun as (() => void) | null;
    if (!completeRun) {
      throw new Error("Expected recovery run to be pending");
    }
    completeRun();
    await firstRecovery;

    expect(secondRecovery.status).toBe("already_running");
    expect(store.scrapeAllCompanies).toHaveBeenCalledTimes(1);
  });
});
