import { describe, expect, it, vi } from "vitest";

import { AtlassianScraper } from "@/lib/scraper/platforms/atlassian";
import { ServiceNowScraper } from "@/lib/scraper/platforms/servicenow";
import { TurboHireScraper } from "@/lib/scraper/platforms/turbohire";
import { selectListingsForHydration } from "@/lib/scraper/platforms/shared/listing-selection";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

const turboUrl = "https://flipkart.turbohire.co/careerpage/4d757ba0-3d57-448a-b82c-238ed87ac90f";
describe("descriptions supplied in listing responses", () => {
  it.each(["servicenow", "turbohire", "atlassian"] as const)("updates %s full bodies without reserving detail quota", async (platform) => {
    const id = platform === "servicenow" ? "servicenow-1" : platform === "atlassian" ? "atlassian-1" : "turbohire-4d757ba0-3d57-448a-b82c-238ed87ac90f-1";
    const fetch = vi.fn(async (url: string) => {
      if (platform === "servicenow") return new Response('<jobs><job><apijobid>1</apijobid><title>Engineer</title><url>https://careers.servicenow.com/jobs/1</url><country>India</country><description>Full body</description></job></jobs>');
      if (platform === "atlassian") return Response.json([{ id: 1, title: "Engineer", locations: ["India"], overview: "Full body" }]);
      if (url.endsWith("/token/noauth")) return Response.json({ access_token: "guest", token_type: "Bearer", expires_in: 3600 });
      return Response.json({ Total: 1, Result: [{ JobId: 1, JobIdObfuscated: "one", JobTitle: "Engineer", Location: "India", JobDescV2: "Full body" }] });
    });
    const http = createHttpClientStub({ fetch });
    const scraper = platform === "servicenow" ? new ServiceNowScraper(http) : platform === "atlassian" ? new AtlassianScraper(http) : new TurboHireScraper(http);
    const reserve = vi.fn(() => 0);
    const result = await scraper.scrape(platform === "turbohire" ? turboUrl : platform === "servicenow" ? "https://careers.servicenow.com/jobs" : "https://www.atlassian.com/company/careers/all-jobs", {
      existingExternalIds: new Set([id]), detailRefresh: { fetchedAtByIdentity: new Map([[id, 0]]), limit: 5, reserve },
    });
    expect(result).toMatchObject({ outcome: "success", jobs: [{ externalId: id, description: expect.stringContaining("Full body") }] });
    expect(reserve).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(platform === "turbohire" ? 2 : 1);
  });

  it("charges only records requiring HTTP hydration when full bodies and missing details are mixed", () => {
    const items = [{ id: "full", full: true }, { id: "stale", full: false }, { id: "new", full: false }];
    const reserve = vi.fn(() => 1);
    const result = selectListingsForHydration({ listings: items, existingExternalIds: new Set(),
      detailRefresh: { fetchedAtByIdentity: new Map([["full", 0], ["stale", 0]]), limit: 5, reserve },
      hasCompleteDetails: (item) => item.full, getExternalId: (item) => item.id, toFilterable: () => ({}),
    });
    expect(result.listings.map((item) => item.id)).toEqual(["full", "new", "stale"]);
    expect(reserve).toHaveBeenCalledWith(1);
  });
});
