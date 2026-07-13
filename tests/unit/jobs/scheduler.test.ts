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
}));

vi.mock("drizzle-orm", () => ({
  eq: (_column: unknown, value: string) => value,
}));

vi.mock("@/lib/db/schema", () => ({
  settings: { __table: "settings", key: "key" },
  scrapeSessions: { __table: "scrape_sessions" },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __table?: string }) => ({
        where: (value: string) => ({
          limit: async () => {
            if (table.__table === "settings") {
              const row = store.settings.get(value);
              return row ? [row] : [];
            }
            return [];
          },
        }),
      }),
    }),
    insert: (table: { __table?: string }) => ({
      values: (value: Record<string, unknown>) => {
        if (table.__table === "scrape_sessions") {
          store.sessions.push(value);
          return Promise.resolve();
        }

        return {
          onConflictDoUpdate: async ({ set }: { set: { value: string | null; updatedAt: Date } }) => {
            store.settings.set(String(value.key), {
              key: String(value.key),
              value: set.value,
              updatedAt: set.updatedAt,
            });
          },
        };
      },
    }),
  },
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
  getScrapingModule: () => ({
    orchestrator: {
      scrapeAllCompanies: store.scrapeAllCompanies,
    },
    repository: {
      acquireSchedulerLock: store.acquireSchedulerLock,
      refreshSchedulerLock: store.refreshSchedulerLock,
      releaseSchedulerLock: store.releaseSchedulerLock,
    },
  }),
}));

describe("scheduler recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    store.settings.clear();
    store.sessions.length = 0;
    store.task = null;
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

    await scheduler.startScheduler();
    await store.task?.listeners.get("execution:missed")?.({
      date: new Date("2026-04-05T06:30:00.000Z"),
    });

    const status = await scheduler.getSchedulerStatus();

    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]?.status).toBe("skipped");
    expect(store.sessions[0]?.triggerSource).toBe("scheduler");
    expect((store.sessions[0]?.scheduledForAt as Date)?.toISOString()).toBe("2026-04-05T00:30:00.000Z");
    expect((store.sessions[0]?.startedAt as Date)?.toISOString()).toBe("2026-04-05T00:30:00.000Z");
    expect(status.pendingMissedCount).toBe(1);
    expect(status.oldestMissedRun?.toISOString()).toBe("2026-04-05T00:30:00.000Z");
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
