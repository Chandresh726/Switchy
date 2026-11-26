import { describe, expect, it } from "vitest";

import type { ExistingJob } from "@/lib/scraper/infrastructure/types";
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

  it("bounds existing refresh work and advances to the remaining jobs on later runs", () => {
    const jobs = Array.from({ length: 75 }, (_, id) => job(id, { detailsFetchedAt: null }));
    const first = selectFreshJobIdentities(jobs, now);
    expect(first.existingExternalIds.size).toBe(25);
    const afterRefresh = jobs.map((item) => first.existingExternalIds.has(item.externalId!) ? item : { ...item, detailsFetchedAt: now });
    const second = selectFreshJobIdentities(afterRefresh, now);
    expect(second.existingExternalIds.has("job-0")).toBe(true);
    expect(second.existingExternalIds.has("job-74")).toBe(false);
  });
});
