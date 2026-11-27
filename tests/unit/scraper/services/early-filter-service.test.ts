import { describe, expect, it } from "vitest";

import { applyEarlyFilters, toEarlyFilterStats } from "@/lib/scraper/services/early-filter-service";
import { DefaultFilterService, matchesJobCountry } from "@/lib/scraper/services/filter-service";

describe("early filter service", () => {
  it("filters secondary locations without losing global remote eligibility or ignoring country restrictions", () => {
    const filter = new DefaultFilterService();
    const job = { externalId: "job", title: "Engineer", url: "https://example.com", country: "USA",
      location: "USA", locations: ["USA", "Mumbai, India"] };
    expect(filter.matchesFilters(job, { country: "India", city: "Mumbai" })).toBe(true);
    expect(filter.applyFilters([job], { country: "India", city: "Mumbai" }).filtered).toEqual([job]);
    expect(matchesJobCountry({ location: "Remote", locations: ["Remote", "London"] }, "India")).toBe(true);
    expect(matchesJobCountry({ country: "USA", location: "Remote", locations: ["Remote"] }, "India")).toBe(false);
  });

  it("defers missing Workday location names while still enforcing known country and title constraints", () => {
    const items = [
      { title: "Engineer", location: "2 Locations", locationsPending: true },
      { title: "Engineer", location: "2 Locations", locationsPending: true, country: "USA" },
      { title: "Sales", location: "2 Locations", locationsPending: true },
      { title: "Engineer", location: "2 Locations" },
    ];
    expect(applyEarlyFilters(items, { country: "India", city: "Mumbai", titleKeywords: ["Engineer"] }).filtered)
      .toEqual([items[0]]);
  });

  it("applies filters with consistent breakdown ordering", () => {
    const items = [
      { title: "Software Engineer", location: "San Francisco, United States" },
      { title: "Product Manager", location: "Delhi, India" },
      { title: "Product Manager", location: "Bangalore, India" },
      { title: "Software Engineer", location: "Bangalore, India" },
    ];

    const result = applyEarlyFilters(items, {
      country: "India",
      city: "Bangalore",
      titleKeywords: ["engineer"],
    });

    expect(result.filtered).toHaveLength(1);
    expect(result.filteredOut).toBe(3);
    expect(result.breakdown).toEqual({
      country: 1,
      city: 1,
      title: 1,
    });

    expect(toEarlyFilterStats(result)).toEqual({
      total: 3,
      country: 1,
      city: 1,
      title: 1,
    });
  });
});
