import { describe, expect, it, vi } from "vitest";

import { DescriptionRefreshBudget } from "@/lib/scraper/services/description-refresh-budget";

const now = new Date("2026-11-26T10:00:00Z");
const HOUR_MS = 60 * 60_000;
function store() {
  const values = new Map<string, unknown>();
  return { get: (key: string) => values.get(key), set: (key: string, value: unknown) => { values.set(key, value); }, delete: (key: string) => { values.delete(key); } };
}

describe("description refresh budget", () => {
  it("shares a durable session limit across companies and restarted pipelines", () => {
    const state = store();
    const first = new DescriptionRefreshBudget(state);
    expect(first.reserve("run", 1, 20, now)).toBe(20);
    const restarted = new DescriptionRefreshBudget(state);
    expect(restarted.reserve("run", 2, 20, now)).toBe(5);
    expect(restarted.reserve("run", 3, 5, now)).toBe(0);
    expect(restarted.reserve("next", 3, 5, now)).toBe(5);
  });

  it("leaves capacity for other companies during the six-hour maintenance cooldown", () => {
    const budget = new DescriptionRefreshBudget(store());
    expect(budget.reserve("one", 1, 5, now)).toBe(5);
    expect(budget.reserve("two", 1, 5, new Date(now.getTime() + 3 * HOUR_MS))).toBe(0);
    expect(budget.reserve("two", 2, 5, new Date(now.getTime() + 3 * HOUR_MS))).toBe(5);
    expect(budget.reserve("three", 1, 5, new Date(now.getTime() + 6 * HOUR_MS))).toBe(5);
  });

  it("serves later companies across repeated sessions instead of cycling only the first ten", () => {
    const state = store();
    const served = new Set<number>();
    for (let run = 0; run < 8; run++) {
      const budget = new DescriptionRefreshBudget(state);
      let total = 0;
      for (let company = 1; company <= 16; company++) {
        const count = budget.reserve(`run-${run}`, company, 5, new Date(now.getTime() + run * 3 * HOUR_MS));
        if (count) served.add(company);
        total += count;
      }
      expect(total).toBeLessThanOrEqual(25);
    }
    expect(served.size).toBe(16);
  });

  it("supports disabling maintenance and skips it if its budget cannot be saved", () => {
    const state = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
    expect(new DescriptionRefreshBudget(state).reserve("run", 1, 5, now, 0)).toBe(0);
    expect(state.set).not.toHaveBeenCalled();
    state.set.mockImplementation(() => { throw new Error("disk unavailable"); });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try { expect(new DescriptionRefreshBudget(state).reserve("run", 1, 5, now)).toBe(0); }
    finally { warning.mockRestore(); }
  });
});
