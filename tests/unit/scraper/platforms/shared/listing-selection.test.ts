import { describe, expect, it } from "vitest";

import { selectListingsForHydration } from "@/lib/scraper/platforms/shared/listing-selection";

describe("selectListingsForHydration", () => {
  it("preserves listing identity while applying early and existing-ID filters", () => {
    const remote = { id: "1", title: "Engineer", location: "Remote, India" };
    const local = { id: "2", title: "Engineer", location: "Pune, India" };
    const manager = { id: "3", title: "Manager", location: "Remote, India" };

    const result = selectListingsForHydration({
      listings: [remote, local, manager],
      filters: { country: "India", city: "Remote", titleKeywords: ["Engineer"] },
      existingExternalIds: new Set(["job-2"]),
      toFilterable: (listing) => listing,
      getExternalId: (listing) => `job-${listing.id}`,
    });

    expect(result.listings).toEqual([remote]);
    expect(result.listings[0]).toBe(remote);
    expect(result.earlyFiltered).toEqual({ total: 2, city: 1, title: 1 });
  });

  it("excludes listings without a stable external ID", () => {
    const stable = { id: "1" };
    const missing = { id: "" };

    const result = selectListingsForHydration({
      listings: [stable, missing],
      existingExternalIds: new Set(["other-id"]),
      toFilterable: () => ({}),
      getExternalId: (listing) => listing.id || null,
    });

    expect(result.listings).toEqual([stable]);
  });
});
