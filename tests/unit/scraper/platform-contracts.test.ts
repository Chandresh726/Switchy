import { describe, expect, it } from "vitest";

import { companyPlatformSchema } from "@/lib/api/contracts/companies";
import { PLATFORM_COLORS, PLATFORM_OPTIONS } from "@/lib/constants";
import { PLATFORMS } from "@/lib/scraper/types/platform";

describe("scraper platform contracts", () => {
  it("exposes every runtime platform through the API and company picker", () => {
    expect(companyPlatformSchema.options.filter((platform) => platform !== "custom").sort())
      .toEqual([...PLATFORMS].sort());
    expect(PLATFORM_OPTIONS.filter(({ value }) => value !== "custom").map(({ value }) => value).sort())
      .toEqual([...PLATFORMS].sort());
    for (const platform of PLATFORMS) {
      expect(PLATFORM_COLORS[platform], platform).toBeTruthy();
    }
  });

  it("removes the dedicated Nutanix platform contract", () => {
    expect(companyPlatformSchema.safeParse("nutanix").success).toBe(false);
    expect(PLATFORMS).not.toContain("nutanix");
  });
});
