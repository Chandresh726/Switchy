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
  it("bounds legacy maintenance without limiting new, empty, or teaser descriptions", () => {
    const legacy = Array.from({ length: 60 }, (_, id) => job(id, { detailsFetchedAt: null, descriptionQuality: null }));
    const priority = [job(60, { description: null }), job(61, { descriptionQuality: "teaser" }), job(62)];
    const saved = [...legacy, ...priority.slice(0, 2)];
    const select = (budget?: number) => selectListingsForHydration({
      listings: [...legacy, ...priority], ...selectFreshJobIdentities(saved, now, undefined, budget),
      toFilterable: () => ({}), getExternalId: (item) => item.externalId,
    });
    expect(select().listings).toHaveLength(8); // Five existing details plus three priority details.
    expect(select(0).listings).toEqual(priority);
    expect(legacy.every((item) => item.detailsFetchedAt === null && item.descriptionQuality === null)).toBe(true);
  });

  it("spreads refresh eligibility over the 24-to-30-hour window deterministically", () => {
    const jobs = Array.from({ length: 100 }, (_, id) => job(id, { detailsFetchedAt: new Date(now.getTime() - 25 * 60 * 60_000) }));
    const first = selectFreshJobIdentities(jobs, now);
    expect(first.existingExternalIds.size).toBeGreaterThan(0);
    expect(first.existingExternalIds.size).toBeLessThan(100);
    expect(selectFreshJobIdentities(jobs, now).existingExternalIds).toEqual(first.existingExternalIds);
    expect(selectFreshJobIdentities(jobs, new Date(now.getTime() + 5 * 60 * 60_000)).existingExternalIds.size).toBe(0);
  });

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
      listings: [...filtered, ...open], ...selectFreshJobIdentities(saved, now, undefined, 50),
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
