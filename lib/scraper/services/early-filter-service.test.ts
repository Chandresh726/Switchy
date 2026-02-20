import { describe, expect, it } from "vitest";

import { applyEarlyFilters, toEarlyFilterStats } from "@/lib/scraper/services/early-filter-service";

describe("early filter service", () => {
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
