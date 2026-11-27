import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListingCheckpoint } from "@/lib/scraper/platforms/shared/listing-checkpoint";

describe("listing checkpoint safety", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each(["total", "first-page", "expiry", "query"])("rejects stale pages after %s changes", (change) => {
    const values = new Map<string, unknown>();
    const state = { get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => { values.set(key, value); }, delete: (key: string) => { values.delete(key); } };
    const page = [{ id: 1 }, { id: 2 }];
    const schema = z.object({ id: z.number() });
    const checkpoint = new ListingCheckpoint(state, "source-a", 4, page, schema, (row) => String(row.id), 2);
    checkpoint.save(2, [{ id: 3 }, { id: 4 }]);
    expect(new ListingCheckpoint(state, "source-a", 4, page, schema, (row) => String(row.id), 2).resumed).toBe(true);
    if (change === "expiry") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60_000);
    const changed = new ListingCheckpoint(state, change === "query" ? "source-b" : "source-a",
      change === "total" ? 5 : 4, change === "first-page" ? [{ id: 9 }, { id: 10 }] : page,
      schema, (row) => String(row.id), 2);
    expect(changed.resumed).toBe(false);
    expect(changed.pages.has(2)).toBe(false);
  });
});
