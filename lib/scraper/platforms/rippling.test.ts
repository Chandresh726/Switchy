import { describe, expect, it, vi } from "vitest";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { RipplingScraper } from "@/lib/scraper/platforms/rippling";

vi.mock("@/lib/scraper/services", () => ({
  hasEarlyFilters: vi.fn(() => false),
  applyEarlyFilters: vi.fn((items: unknown[]) => ({
    filtered: items,
    filteredOut: 0,
    breakdown: { country: 0, city: 0, title: 0 },
  })),
  toEarlyFilterStats: vi.fn(() => undefined),
}));

function createRipplingEntry(
  id: string,
  name: string,
  locations: Array<{
    name: string;
    country: string;
    countryCode: string;
    state: string;
    stateCode: string | null;
    city: string;
    workplaceType: "ON_SITE" | "REMOTE" | "HYBRID";
  }>
) {
  return {
    id,
    name,
    url: `https://ats.rippling.com/rippling/jobs/${id}`,
    department: { name: "Engineering" },
    locations,
    language: "en-US",
  };
}

function createListingsResponse(
  entries: ReturnType<typeof createRipplingEntry>[]
): Response {
  return new Response(
    JSON.stringify({
      pageProps: {
        jobs: {
          items: entries,
          page: 0,
          pageSize: 1000,
          totalItems: entries.length,
          totalPages: 1,
        },
      },
      __N_SSG: true,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

function createBuildIdPage(buildId: string): Response {
  return new Response(
    `<html><body><script src="/_next/static/${buildId}/_buildManifest.js" defer=""></script></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}

function createDetailPage(title: string, description: string): Response {
  return new Response(
    `<html><body><h1>${title}</h1><main><p>${description}</p><p>pay range $120,000 - $180,000 USD per year</p></main></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}

function createHttpMock(
  responses: Response[]
): { httpClient: IHttpClient; fetchMock: ReturnType<typeof vi.fn> } {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }

  const httpClient: IHttpClient = {
    fetch: fetchMock,
    get: vi.fn(),
    post: vi.fn(),
  };

  return { httpClient, fetchMock };
}

describe("RipplingScraper", () => {
  describe("validate", () => {
    it("accepts Rippling career URLs", () => {
      const { httpClient } = createHttpMock([]);
      const scraper = new RipplingScraper(httpClient);

      expect(scraper.validate("https://www.rippling.com/en-IN/careers/open-roles")).toBe(true);
      expect(scraper.validate("https://www.rippling.com/careers/open-roles")).toBe(true);
      expect(scraper.validate("https://www.rippling.com/careers")).toBe(true);
      expect(scraper.validate("https://rippling.com/careers")).toBe(true);
    });

    it("rejects non-Rippling URLs", () => {
      const { httpClient } = createHttpMock([]);
      const scraper = new RipplingScraper(httpClient);

      expect(scraper.validate("https://boards.greenhouse.io/example")).toBe(false);
      expect(scraper.validate("https://www.google.com/about/careers")).toBe(false);
      expect(scraper.validate("https://rippling.com/pricing")).toBe(false);
    });
  });

  describe("extractIdentifier", () => {
    it("extracts locale from URL path", () => {
      const { httpClient } = createHttpMock([]);
      const scraper = new RipplingScraper(httpClient);

      expect(scraper.extractIdentifier("https://www.rippling.com/en-IN/careers/open-roles")).toBe("en-IN");
      expect(scraper.extractIdentifier("https://www.rippling.com/en-US/careers/open-roles")).toBe("en-US");
      expect(scraper.extractIdentifier("https://www.rippling.com/de-DE/careers/open-roles")).toBe("de-DE");
    });

    it("returns 'main' for root path URLs", () => {
      const { httpClient } = createHttpMock([]);
      const scraper = new RipplingScraper(httpClient);

      expect(scraper.extractIdentifier("https://www.rippling.com/careers/open-roles")).toBe("main");
    });
  });

  describe("scrape", () => {
    it("scrapes jobs, groups by ID, and hydrates details", async () => {
      const jobId1 = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      const jobId2 = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

      const entries = [
        createRipplingEntry(jobId1, "Software Engineer", [
          {
            name: "San Francisco, CA",
            country: "United States",
            countryCode: "US",
            state: "California",
            stateCode: "CA",
            city: "San Francisco",
            workplaceType: "ON_SITE",
          },
        ]),
        createRipplingEntry(jobId1, "Software Engineer", [
          {
            name: "Austin, TX",
            country: "United States",
            countryCode: "US",
            state: "Texas",
            stateCode: "TX",
            city: "Austin",
            workplaceType: "ON_SITE",
          },
        ]),
        createRipplingEntry(jobId2, "Product Manager", [
          {
            name: "Remote (Arizona, US)",
            country: "United States",
            countryCode: "US",
            state: "Arizona",
            stateCode: "AZ",
            city: "",
            workplaceType: "REMOTE",
          },
        ]),
      ];

      const { httpClient, fetchMock } = createHttpMock([
        createBuildIdPage("testBuildId123"),
        createListingsResponse(entries),
        createDetailPage("Software Engineer", "We are hiring engineers."),
        createDetailPage("Product Manager", "We are hiring PMs."),
      ]);

      const scraper = new RipplingScraper(httpClient);
      const result = await scraper.scrape(
        "https://www.rippling.com/en-IN/careers/open-roles"
      );

      expect(result.success).toBe(true);
      expect(result.outcome).toBe("success");
      expect(result.jobs).toHaveLength(2);
      expect(result.openExternalIds).toHaveLength(2);
      expect(result.openExternalIds).toContain(`rippling-${jobId1}`);
      expect(result.openExternalIds).toContain(`rippling-${jobId2}`);
      expect(result.openExternalIdsComplete).toBe(true);

      const engineerJob = result.jobs.find((j) => j.title === "Software Engineer");
      expect(engineerJob).toBeDefined();
      expect(engineerJob!.location).toContain("San Francisco");
      expect(engineerJob!.location).toContain("Austin");
      expect(engineerJob!.locationType).toBe("onsite");
      expect(engineerJob!.description).toBeDefined();

      const pmJob = result.jobs.find((j) => j.title === "Product Manager");
      expect(pmJob).toBeDefined();
      expect(pmJob!.location).toBe("Remote (Arizona, US)");
      expect(pmJob!.locationType).toBe("remote");

      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it("skips detail fetch for jobs with existing descriptions", async () => {
      const jobId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

      const entries = [
        createRipplingEntry(jobId, "Software Engineer", [
          {
            name: "San Francisco, CA",
            country: "United States",
            countryCode: "US",
            state: "California",
            stateCode: "CA",
            city: "San Francisco",
            workplaceType: "ON_SITE",
          },
        ]),
      ];

      const { httpClient, fetchMock } = createHttpMock([
        createBuildIdPage("testBuildId123"),
        createListingsResponse(entries),
      ]);

      const scraper = new RipplingScraper(httpClient);
      const result = await scraper.scrape(
        "https://www.rippling.com/en-IN/careers/open-roles",
        {
          existingExternalIds: new Set([`rippling-${jobId}`]),
        }
      );

      expect(result.success).toBe(true);
      expect(result.jobs).toHaveLength(0);
      expect(result.openExternalIds).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("returns error when build ID extraction fails", async () => {
      const { httpClient } = createHttpMock([
        new Response("<html><body>No build manifest</body></html>", { status: 200 }),
      ]);

      const scraper = new RipplingScraper(httpClient);
      const result = await scraper.scrape(
        "https://www.rippling.com/en-IN/careers/open-roles"
      );

      expect(result.success).toBe(false);
      expect(result.outcome).toBe("error");
      expect(result.error).toContain("build ID");
    });

    it("returns partial outcome when detail fetch fails", async () => {
      const jobId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

      const entries = [
        createRipplingEntry(jobId, "Software Engineer", [
          {
            name: "San Francisco, CA",
            country: "United States",
            countryCode: "US",
            state: "California",
            stateCode: "CA",
            city: "San Francisco",
            workplaceType: "ON_SITE",
          },
        ]),
      ];

      const { httpClient } = createHttpMock([
        createBuildIdPage("testBuildId123"),
        createListingsResponse(entries),
        new Response("Not Found", { status: 404 }),
      ]);

      const scraper = new RipplingScraper(httpClient);
      const result = await scraper.scrape(
        "https://www.rippling.com/en-IN/careers/open-roles"
      );

      expect(result.success).toBe(true);
      expect(result.outcome).toBe("partial");
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].description).toBeUndefined();
    });

    it("handles empty listings", async () => {
      const { httpClient } = createHttpMock([
        createBuildIdPage("testBuildId123"),
        createListingsResponse([]),
      ]);

      const scraper = new RipplingScraper(httpClient);
      const result = await scraper.scrape(
        "https://www.rippling.com/en-IN/careers/open-roles"
      );

      expect(result.success).toBe(true);
      expect(result.outcome).toBe("success");
      expect(result.jobs).toHaveLength(0);
      expect(result.openExternalIds).toHaveLength(0);
    });
  });

  describe("groupAndMergeLocations (via scrape)", () => {
    it("groups denormalized entries by job ID and merges locations", async () => {
      const jobId = "shared-job-id";

      const entries = [
        createRipplingEntry(jobId, "Data Scientist", [
          {
            name: "Bangalore, India",
            country: "India",
            countryCode: "IN",
            state: "Karnataka",
            stateCode: "KA",
            city: "Bangalore",
            workplaceType: "HYBRID",
          },
        ]),
        createRipplingEntry(jobId, "Data Scientist", [
          {
            name: "London, UK",
            country: "United Kingdom",
            countryCode: "GB",
            state: "",
            stateCode: null,
            city: "London",
            workplaceType: "ON_SITE",
          },
        ]),
      ];

      const { httpClient, fetchMock } = createHttpMock([
        createBuildIdPage("testBuildId123"),
        createListingsResponse(entries),
        createDetailPage("Data Scientist", "Great role"),
      ]);

      const scraper = new RipplingScraper(httpClient);
      const result = await scraper.scrape(
        "https://www.rippling.com/en-IN/careers/open-roles"
      );

      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].title).toBe("Data Scientist");
      expect(result.jobs[0].location).toContain("Bangalore");
      expect(result.jobs[0].location).toContain("London");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("maps workplace types correctly", async () => {
      const entries = [
        createRipplingEntry("id-remote", "Remote Role", [
          {
            name: "Remote",
            country: "United States",
            countryCode: "US",
            state: "",
            stateCode: null,
            city: "",
            workplaceType: "REMOTE",
          },
        ]),
        createRipplingEntry("id-hybrid", "Hybrid Role", [
          {
            name: "New York, NY",
            country: "United States",
            countryCode: "US",
            state: "New York",
            stateCode: "NY",
            city: "New York",
            workplaceType: "HYBRID",
          },
        ]),
        createRipplingEntry("id-onsite", "Onsite Role", [
          {
            name: "San Francisco, CA",
            country: "United States",
            countryCode: "US",
            state: "California",
            stateCode: "CA",
            city: "San Francisco",
            workplaceType: "ON_SITE",
          },
        ]),
      ];

      const { httpClient } = createHttpMock([
        createBuildIdPage("testBuildId123"),
        createListingsResponse(entries),
        createDetailPage("Remote Role", "desc"),
        createDetailPage("Hybrid Role", "desc"),
        createDetailPage("Onsite Role", "desc"),
      ]);

      const scraper = new RipplingScraper(httpClient);
      const result = await scraper.scrape(
        "https://www.rippling.com/en-IN/careers/open-roles"
      );

      expect(result.jobs).toHaveLength(3);

      const remote = result.jobs.find((j) => j.title === "Remote Role");
      expect(remote!.locationType).toBe("remote");

      const hybrid = result.jobs.find((j) => j.title === "Hybrid Role");
      expect(hybrid!.locationType).toBe("hybrid");

      const onsite = result.jobs.find((j) => j.title === "Onsite Role");
      expect(onsite!.locationType).toBe("onsite");
    });
  });
});
