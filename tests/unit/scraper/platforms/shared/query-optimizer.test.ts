import { describe, expect, it, vi } from "vitest";

import { HttpError } from "@/lib/scraper/infrastructure/http-client";
import { countryCode, ListingQueryOptimizer, type QuerySnapshot } from "@/lib/scraper/platforms/shared/query-optimizer";

type Item = { id: number; location: string };

function fixture() {
  const values = new Map<string, unknown>();
  const ttls: number[] = [];
  const state = {
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown, expiresAt: Date) => { values.set(key, value); ttls.push(expiresAt.getTime() - Date.now()); },
    delete: (key: string) => { values.delete(key); },
  };
  const items: Item[] = [{ id: 1, location: "India" }, { id: 2, location: "USA" }, { id: 3, location: "Remote" }];
  const baseline = vi.fn(async (): Promise<QuerySnapshot<Item, Item[]>> => ({ items, complete: true, advertisedTotal: 3, value: items }));
  const candidate = vi.fn(async () => ({ items: [items[0], items[2]], complete: true, advertisedTotal: 2, value: [items[0], items[2]] }));
  const input = { platform: "oracle" as const, source: "https://example.com/Board?category=engineering", board: "Board", country: "India",
    candidateKey: { location: "India", version: 1 }, baseline, candidate, getId: (item: typeof items[number]) => item.id, toFilterable: (item: typeof items[number]) => item };
  return { input, state, items, ttls };
}

describe("validated listing queries", () => {
  it("resolves ISO country codes beyond the configured shorthand aliases", () => {
    expect(countryCode("India")).toBe("in");
    expect(countryCode("Netherlands")).toBe("nl");
    expect(countryCode("Japan")).toBe("jp");
    expect(countryCode("Unknown office")).toBeUndefined();
  });
  it("validates full ID coverage including global remote jobs, persists proof and isolates query scopes", async () => {
    const { input, state } = fixture();
    const first = await new ListingQueryOptimizer(state).fetch(input);
    expect(first.listingScopeKey).toBeTruthy();
    expect(first.value.map((item) => item.id)).toEqual([1, 3]);
    await new ListingQueryOptimizer(state).fetch(input);
    expect(input.baseline).toHaveBeenCalledTimes(1);
    await new ListingQueryOptimizer(state).fetch({ ...input, source: "https://example.com/Board?category=sales" });
    expect(input.baseline).toHaveBeenCalledTimes(2);
  });

  it("rejects incomplete country coverage and reuses the original query after restart", async () => {
    const { input, state, items } = fixture();
    input.candidate.mockResolvedValue({ items: [items[0]], complete: true, advertisedTotal: 1, value: [items[0]] });
    expect(await new ListingQueryOptimizer(state).fetch(input)).toEqual({ value: items });
    await new ListingQueryOptimizer(state).fetch(input);
    expect(input.baseline).toHaveBeenCalledTimes(2);
    expect(input.candidate).toHaveBeenCalledTimes(1);
  });

  it("does not validate a baseline with unread pages or a large listing gap", async () => {
    const { input, state, items } = fixture();
    input.baseline.mockResolvedValue({ items, complete: true, advertisedTotal: 4, value: items });
    expect(await new ListingQueryOptimizer(state).fetch(input)).toEqual({ value: items });
    input.baseline.mockResolvedValue({ items, complete: false, pagesComplete: false, advertisedTotal: 3, value: items });
    expect(await new ListingQueryOptimizer(state).fetch(input)).toEqual({ value: items });
    expect(input.candidate).not.toHaveBeenCalled();
  });

  it("validates a country query against a resumed baseline that read every page", async () => {
    const { input, state } = fixture();
    const many = Array.from({ length: 40 }, (_, index) => ({ id: index + 1, location: index < 5 ? "India" : "USA" }));
    input.baseline.mockResolvedValue({ items: many, complete: false, pagesComplete: true, advertisedTotal: 41, value: many });
    input.candidate.mockResolvedValue({ items: many.slice(0, 5), complete: true, advertisedTotal: 5, value: many.slice(0, 5) });
    const result = await new ListingQueryOptimizer(state).fetch(input);
    expect(result.listingScopeKey).toBeTruthy();
    expect(result.value).toHaveLength(5);
  });

  it("accepts country jobs missing from the query only when they have since closed", async () => {
    const { input, state, items } = fixture();
    const extra = { id: 4, location: "India" };
    const baselineItems = [...items, extra];
    input.baseline.mockResolvedValue({ items: baselineItems, complete: true, advertisedTotal: 4, value: baselineItems });
    const isStillOpen = vi.fn(async () => false as boolean | undefined);
    const closed = await new ListingQueryOptimizer(state).fetch({ ...input, isStillOpen });
    expect(isStillOpen).toHaveBeenCalledWith(extra);
    expect(closed.listingScopeKey).toBeTruthy();

    const unknownState = fixture().state;
    isStillOpen.mockResolvedValue(undefined);
    expect(await new ListingQueryOptimizer(unknownState).fetch({ ...input, isStillOpen })).toEqual({ value: baselineItems });
    await new ListingQueryOptimizer(unknownState).fetch({ ...input, isStillOpen });
    expect(input.candidate).toHaveBeenCalledTimes(3);

    const openState = fixture().state;
    isStillOpen.mockResolvedValue(true);
    expect(await new ListingQueryOptimizer(openState).fetch({ ...input, isStillOpen })).toEqual({ value: baselineItems });
    await new ListingQueryOptimizer(openState).fetch({ ...input, isStillOpen });
    expect(input.candidate).toHaveBeenCalledTimes(4);
  });

  it("keeps a proof for a week, a rejection for a day, and revalidates a collapsed query", async () => {
    const { input, state, ttls } = fixture();
    const many = Array.from({ length: 40 }, (_, index) => ({ id: index + 1, location: index < 12 ? "India" : "USA" }));
    input.baseline.mockResolvedValue({ items: many, complete: true, advertisedTotal: 40, value: many });
    input.candidate.mockResolvedValue({ items: many.slice(0, 12), complete: true, advertisedTotal: 12, value: many.slice(0, 12) });
    const optimizer = new ListingQueryOptimizer(state);
    await optimizer.fetch(input);
    expect(ttls[0]).toBeGreaterThan(6 * 24 * 60 * 60_000);

    input.candidate.mockResolvedValue({ items: [], complete: true, advertisedTotal: 0, value: [] });
    expect(await optimizer.fetch(input)).toEqual({ value: many });
    expect(input.baseline).toHaveBeenCalledTimes(2);
    await optimizer.fetch(input);
    expect(input.baseline).toHaveBeenCalledTimes(3);
    expect(ttls.at(-1)).toBeLessThanOrEqual(24 * 60 * 60_000);
  });

  it("preserves real throttling without issuing an unfiltered fallback after a cached proof", async () => {
    const { input, state } = fixture();
    const optimizer = new ListingQueryOptimizer(state);
    await optimizer.fetch(input);
    input.candidate.mockRejectedValue(new HttpError(429, "throttle", input.source, new Headers({ "retry-after": "60" })));
    await expect(optimizer.fetch(input)).rejects.toMatchObject({ status: 429, retryAfterMs: 60_000 });
    expect(input.baseline).toHaveBeenCalledTimes(1);
  });

  it("returns a partial cached query without granting it a new proof or disguising it as a full crawl", async () => {
    const { input, state } = fixture();
    const optimizer = new ListingQueryOptimizer(state);
    await optimizer.fetch(input);
    input.candidate.mockResolvedValue({ items: [], value: [], advertisedTotal: 2, complete: false });
    const result = await optimizer.fetch(input);
    expect(result.listingScopeKey).toBeTruthy();
    expect(result.value).toEqual([]);
    expect(input.baseline).toHaveBeenCalledTimes(1);
  });

  it("requires complete ID equality when validating a larger unfiltered page size", async () => {
    const { input, state, items } = fixture();
    expect(await new ListingQueryOptimizer(state).fetch({ ...input, country: undefined })).toEqual({ value: items });
  });

  it("keeps one-page boards on the original path and applies host then board policy overrides", async () => {
    const { input, state, items } = fixture();
    const optimizer = new ListingQueryOptimizer(state, {
      platforms: { oracle: { minimumCountryListings: 100 } },
      boards: [
        { platform: "oracle", hostname: "example.com", policy: { validationTtlMs: 1000 } },
        { platform: "oracle", hostname: "example.com", board: "Board", policy: { countryFilter: false } },
      ],
    });
    expect(optimizer.policy("oracle", input.source, "Board")).toMatchObject({ countryFilter: false, validationTtlMs: 1000 });
    expect(await optimizer.fetch(input)).toEqual({ value: items });
    expect(input.candidate).not.toHaveBeenCalled();
  });
});
