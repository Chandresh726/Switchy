import { describe, expect, it } from "vitest";

import { companyPlatformSchema } from "@/lib/api/contracts/companies";
import { PLATFORM_COLORS, PLATFORM_OPTIONS } from "@/lib/constants";
import { PLATFORMS } from "@/lib/scraper/types/platform";

describe("scraper platform contracts", () => {
  it("publishes TurboHire through API, runtime, and UI platform lists", () => {
    expect(companyPlatformSchema.parse("turbohire")).toBe("turbohire");
    expect(PLATFORMS).toContain("turbohire");
    expect(PLATFORM_OPTIONS).toContainEqual({
      value: "turbohire",
      label: "TurboHire",
    });
    expect(PLATFORM_COLORS.turbohire).toBeTruthy();
  });
});
