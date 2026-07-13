import { describe, expect, it, vi } from "vitest";

import { DrizzleSchedulerLeaseStore } from "@/lib/jobs/scheduler-lease-store";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const sqlite = createSqliteTestHarness("switchy-scheduler-lease-");

describe("DrizzleSchedulerLeaseStore", () => {
  it("exclusively acquires, refreshes, expires, and releases a scheduler lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
    const { database } = sqlite.createDatabase();
    const store = new DrizzleSchedulerLeaseStore(database, 1_000);

    const firstToken = await store.acquire("scheduler-one");
    expect(firstToken).toEqual(expect.any(String));
    await expect(store.acquire("scheduler-two")).resolves.toBeNull();
    await expect(store.refresh("wrong-token")).resolves.toBeNull();

    vi.advanceTimersByTime(900);
    await expect(store.refresh(firstToken!)).resolves.toBe(firstToken);
    vi.advanceTimersByTime(900);
    await expect(store.acquire("scheduler-two")).resolves.toBeNull();

    vi.advanceTimersByTime(101);
    const secondToken = await store.acquire("scheduler-two");
    expect(secondToken).toEqual(expect.any(String));
    expect(secondToken).not.toBe(firstToken);

    await store.release(firstToken!);
    await expect(store.acquire("scheduler-three")).resolves.toBeNull();
    await store.release(secondToken!);
    await expect(store.acquire("scheduler-three")).resolves.toEqual(
      expect.any(String)
    );
  });
});
