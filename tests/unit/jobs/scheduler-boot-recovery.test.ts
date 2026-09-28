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
        return operation({ select, insert, delete: remove });
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

describe("scheduler backend-owned recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete (globalThis as typeof globalThis & {
      __switchySchedulerRuntime?: unknown;
    }).__switchySchedulerRuntime;
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
        totalJobsAdded: 0,
      },
    });
  });

  it("enumerates cron occurrences strictly after the baseline", async () => {
    const scheduler = await import("@/lib/jobs/scheduler");

    const missed = scheduler.listMissedOccurrences(
      "0 * * * *",
      new Date(2026, 3, 5, 10, 15),
      new Date(2026, 3, 5, 12, 5)
    );

    expect(missed.map((date) => date.toISOString())).toEqual([
      new Date(2026, 3, 5, 11).toISOString(),
      new Date(2026, 3, 5, 12).toISOString(),
    ]);
  });

  it("reconciles ticks missed while the process was down, without UI involvement", async () => {
    store.settings.set("scheduler.lastRun", {
      key: "scheduler.lastRun",
      value: new Date(2026, 3, 5, 0).toISOString(),
    });
    const scheduler = await import("@/lib/jobs/scheduler");

    const result = await scheduler.reconcileMissedRunsOnBoot(
      new Date(2026, 3, 5, 13)
    );

    expect(result.reconciled).toBe(2);
    expect(result.pendingMissedCount).toBe(2);
    expect(store.sessions).toHaveLength(2);
    expect(store.sessions[0]?.status).toBe("skipped");
    expect(store.sessions[0]?.triggerSource).toBe("scheduler");
  });

  it("appends ticks missed after an already-pending miss instead of hiding them", async () => {
    store.settings.set("scheduler.lastRun", {
      key: "scheduler.lastRun",
      value: new Date(2026, 3, 5, 0).toISOString(),
    });
    store.settings.set("scheduler.recovery.v1", {
      key: "scheduler.recovery.v1",
      value: JSON.stringify({
        version: 1,
        pendingMissedCount: 1,
        oldestMissedRun: new Date(2026, 3, 5, 6).toISOString(),
        latestMissedRun: new Date(2026, 3, 5, 6).toISOString(),
      }),
    });
    const scheduler = await import("@/lib/jobs/scheduler");

    const result = await scheduler.reconcileMissedRunsOnBoot(
      new Date(2026, 3, 5, 13)
    );

    expect(result.reconciled).toBe(1);
    expect(result.pendingMissedCount).toBe(2);
    const status = await scheduler.getSchedulerStatus();
    expect(status.latestMissedRun?.toISOString()).toBe(
      new Date(2026, 3, 5, 12).toISOString()
    );
  });

  it("resets the baseline on enable so disabled windows never backfill", async () => {
    store.settings.set("scheduler.lastRun", {
      key: "scheduler.lastRun",
      value: new Date(2026, 3, 2, 0).toISOString(),
    });
    const scheduler = await import("@/lib/jobs/scheduler");
    const now = new Date(2026, 3, 5, 13);

    await scheduler.handleSchedulerEnabled(now);

    const result = await scheduler.reconcileMissedRunsOnBoot(now);
    expect(result).toEqual({ reconciled: 0, pendingMissedCount: 0 });
    expect(store.sessions).toEqual([]);
  });

  it("drops pending recovery on disable", async () => {
    store.settings.set("scheduler.recovery.v1", {
      key: "scheduler.recovery.v1",
      value: JSON.stringify({
        version: 1,
        pendingMissedCount: 2,
        oldestMissedRun: new Date(2026, 3, 5, 0).toISOString(),
        latestMissedRun: new Date(2026, 3, 5, 6).toISOString(),
      }),
    });
    const scheduler = await import("@/lib/jobs/scheduler");

    await scheduler.handleSchedulerDisabled();

    const status = await scheduler.getSchedulerStatus();
    expect(status.pendingMissedCount).toBe(0);
  });

  it("does not reconcile when the scheduler is disabled", async () => {
    store.settings.set("scheduler_enabled", { key: "scheduler_enabled", value: "false" });
    store.settings.set("scheduler.lastRun", {
      key: "scheduler.lastRun",
      value: new Date(2026, 3, 5, 0).toISOString(),
    });
    const scheduler = await import("@/lib/jobs/scheduler");

    const result = await scheduler.reconcileMissedRunsOnBoot(
      new Date(2026, 3, 5, 13)
    );

    expect(result).toEqual({ reconciled: 0, pendingMissedCount: 0 });
    expect(store.sessions).toEqual([]);
  });

  it("does not reconcile on first boot when no run history exists", async () => {
    const scheduler = await import("@/lib/jobs/scheduler");

    const result = await scheduler.reconcileMissedRunsOnBoot(
      new Date(2026, 3, 5, 13)
    );

    expect(result).toEqual({ reconciled: 0, pendingMissedCount: 0 });
    expect(store.sessions).toEqual([]);
  });

  it("runs one coalesced boot recovery batch and skips reconciliation on repeat calls", async () => {
    store.settings.set("scheduler.lastRun", {
      key: "scheduler.lastRun",
      value: new Date(2026, 3, 5, 0).toISOString(),
    });
    const scheduler = await import("@/lib/jobs/scheduler");

    const first = await scheduler.recoverSchedulerOnBoot(
      new Date(2026, 3, 5, 13),
      "boot"
    );
    const status = await scheduler.getSchedulerStatus();
    const second = await scheduler.recoverSchedulerOnBoot(
      new Date(2026, 3, 5, 13),
      "boot"
    );

    expect(first.status).toBe("started");
    expect(store.scrapeAllCompanies).toHaveBeenCalledTimes(1);
    expect(store.scrapeAllCompanies).toHaveBeenCalledWith("scheduler_recovery");
    expect(status.pendingMissedCount).toBe(0);
    expect(second.status).toBe("not_needed");
    expect(store.sessions).toHaveLength(2);
  });

  it("never rewinds the recovery baseline when a stale batch finishes", async () => {
    const seededLastRun = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    store.settings.set("scheduler.lastRun", {
      key: "scheduler.lastRun",
      value: seededLastRun,
    });
    const scheduler = await import("@/lib/jobs/scheduler");

    await scheduler.startScheduler();
    await store.task?.execute();

    expect(store.scrapeAllCompanies).toHaveBeenCalledWith("scheduler");
    expect(store.settings.get("scheduler.lastRun")?.value).toBe(seededLastRun);
  });

  it("leaves the persistent sleep assertion untouched under test workers", async () => {
    const scheduler = await import("@/lib/jobs/scheduler");

    await expect(scheduler.refreshSchedulerPersistentState()).resolves.toBeUndefined();
  });

  it("drains pending recovery from the server-side watchdog tick", async () => {    const scheduler = await import("@/lib/jobs/scheduler");

    await scheduler.startScheduler();
    await store.task?.listeners.get("execution:missed")?.({
      date: new Date("2026-04-05T06:30:00.000Z"),
    });

    await scheduler.runSchedulerWatchdogTick();

    expect(store.scrapeAllCompanies).toHaveBeenCalledWith("scheduler_recovery");
    const status = await scheduler.getSchedulerStatus();
    expect(status.pendingMissedCount).toBe(0);
    expect(status.backendOwned).toBe(true);
  });
});
