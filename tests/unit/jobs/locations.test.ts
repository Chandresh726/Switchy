import { describe, expect, it } from "vitest";

import { formatJobLocation, isLocationCountLabel, normalizeJobLocations } from "@/lib/jobs/locations";

describe("job locations", () => {
  it("prefers real names, removes count labels, and deduplicates without reordering", () => {
    expect(normalizeJobLocations("2 Locations", [" New Delhi ", "Mumbai", "new delhi", "2 Locations", ""]))
      .toEqual(["New Delhi", "Mumbai"]);
    expect(formatJobLocation("2 Locations", ["New Delhi", "Mumbai"])).toBe("New Delhi; Mumbai");
    expect(formatJobLocation("Primary office", ["Remote India", "London, UK"])).toBe("Remote India; London, UK");
  });

  it("preserves useful source labels when details are unavailable", () => {
    expect(formatJobLocation("Remote")).toBe("Remote");
    expect(formatJobLocation("2 Locations", [])).toBe("2 Locations");
    expect(formatJobLocation("New Delhi", ["2 Locations"])).toBe("New Delhi");
    expect(formatJobLocation(null)).toBeNull();
    expect(isLocationCountLabel(" 2 locations ")).toBe(true);
    expect(isLocationCountLabel("Multiple Locations")).toBe(true);
    expect(isLocationCountLabel("2 Locations Road, London")).toBe(false);
  });
});
