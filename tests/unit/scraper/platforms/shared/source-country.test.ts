import { describe, expect, it } from "vitest";

import { AshbyScraper } from "@/lib/scraper/platforms/ashby";
import { GreenhouseScraper } from "@/lib/scraper/platforms/greenhouse";
import { readAddressCountry, sourceCountryHint } from "@/lib/scraper/platforms/shared/source-fields";
import { DefaultFilterService } from "@/lib/scraper/services/filter-service";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

const filters = new DefaultFilterService();
describe("country metadata from bulk responses", () => {
  it("uses Ashby structured primary and secondary countries without requiring city-name guesses", async () => {
    const scraper = new AshbyScraper(createHttpClientStub({ fetch: async () => Response.json({ jobs: [{
      id: "one", title: "Engineer", jobUrl: "https://jobs.ashbyhq.com/acme/one", location: "Head office",
      address: { postalAddress: { addressCountry: "USA" } },
      secondaryLocations: [{ location: "New office", address: { addressCountry: "IND" } }],
    }] }) }));
    const result = await scraper.scrape("https://jobs.ashbyhq.com/acme");
    expect(result.outcome).toBe("success");
    expect(filters.matchesFilters(result.jobs[0], { country: "India" })).toBe(true);
    expect(filters.matchesFilters(result.jobs[0], { country: "United States" })).toBe(true);
  });

  it("retains advertised Greenhouse office locations while preserving the original display location", async () => {
    const scraper = new GreenhouseScraper(createHttpClientStub({ fetch: async () => Response.json({ jobs: [{
      id: 1, title: "Engineer", absolute_url: "https://example.com/job", location: { name: "Multiple Locations" },
      offices: [{ name: "Headquarters", location: "United States" }, { name: "New office", location: "India" }],
    }] }) }));
    const result = await scraper.scrape("https://boards.greenhouse.io/acme");
    expect(result.jobs[0].location).toBe("Multiple Locations");
    expect(result.jobs[0].locations).toContain("India");
    expect(filters.matchesFilters(result.jobs[0], { country: "India" })).toBe(true);
  });

  it("keeps globally eligible remote descriptions eligible when a primary country is also provided", () => {
    const country = sourceCountryHint(["USA"], ["Remote"]);
    expect(filters.matchesFilters({ externalId: "one", title: "Engineer", url: "https://example.com/one", location: "Remote", country }, { country: "India" })).toBe(true);
    expect(readAddressCountry(null)).toBeUndefined();
    expect(readAddressCountry({ postalAddress: { addressCountry: 123 } })).toBeUndefined();
  });
});
