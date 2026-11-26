import { describe, expect, it } from "vitest";

import type { ExistingJob } from "@/lib/scraper/infrastructure/types";
import { selectListingsForHydration } from "@/lib/scraper/platforms/shared/listing-selection";
import { selectFreshJobIdentities } from "@/lib/scraper/services/job-refresh-policy";

const now = new Date("2026-11-26T10:00:00Z");
const job = (id: number, overrides: Partial<ExistingJob> = {}): ExistingJob => ({
  id, externalId: `job-${id}`, title: "Engineer", url: `https://example.com/${id}`,
  status: "new", description: "Full description", descriptionQuality: "full",
  detailsFetchedAt: now, ...overrides,
});

describe("job refresh policy", () => {
  it("refreshes expired, legacy, missing and teaser descriptions while skipping fresh details", () => {
    const fresh = selectFreshJobIdentities([job(1), job(2, { detailsFetchedAt: new Date("2026-11-24") }),
      job(3, { detailsFetchedAt: null }), job(4, { descriptionQuality: "teaser" }), job(5, { description: null })], now);
    expect([...fresh.existingExternalIds]).toEqual(["job-1"]);
    expect([...fresh.existingJobUrls]).toEqual(["https://example.com/1"]);
  });

  it("spends refresh capacity on current matching listings, not closed or filtered history", () => {
    const closed = Array.from({ length: 100 }, (_, id) => job(id, { status: "archived", detailsFetchedAt: null }));
    const filtered = Array.from({ length: 60 }, (_, id) => job(100 + id, { location: "London", detailsFetchedAt: null }));
    const open = Array.from({ length: 60 }, (_, id) => job(200 + id, { location: "Bengaluru", detailsFetchedAt: null }));
    const jobs = [...closed, ...filtered, ...open];
    const select = (saved: ExistingJob[]) => selectListingsForHydration({
      listings: [...filtered, ...open], ...selectFreshJobIdentities(saved, now),
      filters: { city: "Bengaluru" },
      toFilterable: (item) => ({ title: item.title, location: item.location ?? undefined }),
      getExternalId: (item) => item.externalId,
    });
    const first = select(jobs);
    expect(first.listings).toHaveLength(50);
    expect(first.listings[0].id).toBe(200);
    const refreshedIds = new Set(first.listings.map((item) => item.id));
    const afterRefresh = jobs.map((item) => refreshedIds.has(item.id) ? { ...item, detailsFetchedAt: now } : item);
    const second = select(afterRefresh);
    expect(second.listings.map((item) => item.id)).toEqual(open.slice(50).map((item) => item.id));
  });
});
