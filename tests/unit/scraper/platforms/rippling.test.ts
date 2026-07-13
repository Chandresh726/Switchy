import { describe, expect, it, vi } from "vitest";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { RipplingScraper } from "@/lib/scraper/platforms/rippling";
import {
  createRipplingAlgoliaPayload,
  createRipplingDetailPage,
  createRipplingEntry,
} from "@test/fixtures/platforms/rippling";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

function createHttpMock(
  listingPayload: unknown = createRipplingAlgoliaPayload([]),
  detailResponses: Response[] = []
): {
  httpClient: IHttpClient;
  fetchMock: ReturnType<typeof vi.fn>;
  postMock: ReturnType<typeof vi.fn>;
} {
  const fetchMock = vi.fn();
  for (const response of detailResponses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  const postMock = vi.fn().mockResolvedValue(listingPayload);

  const httpClient = createHttpClientStub({
    fetch: fetchMock,
    post: postMock as IHttpClient["post"],
  });

  return { httpClient, fetchMock, postMock };
}

describe("RipplingScraper", () => {
  describe("validate", () => {
    it("accepts Rippling career URLs", () => {
      const { httpClient } = createHttpMock();
      const scraper = new RipplingScraper(httpClient);

      expect(scraper.validate("https://www.rippling.com/en-IN/careers/open-roles")).toBe(true);
      expect(scraper.validate("https://www.rippling.com/careers/open-roles")).toBe(true);
      expect(scraper.validate("https://www.rippling.com/careers")).toBe(true);
      expect(scraper.validate("https://rippling.com/careers")).toBe(true);
    });

    it("rejects non-Rippling URLs", () => {
      const { httpClient } = createHttpMock();
      const scraper = new RipplingScraper(httpClient);

      expect(scraper.validate("https://boards.greenhouse.io/example")).toBe(false);
      expect(scraper.validate("https://www.google.com/about/careers")).toBe(false);
      expect(scraper.validate("https://rippling.com/pricing")).toBe(false);
    });
  });

  describe("extractIdentifier", () => {
    it("extracts locale from URL path", () => {
      const { httpClient } = createHttpMock();
      const scraper = new RipplingScraper(httpClient);

      expect(scraper.extractIdentifier("https://www.rippling.com/en-IN/careers/open-roles")).toBe("en-IN");
      expect(scraper.extractIdentifier("https://www.rippling.com/en-US/careers/open-roles")).toBe("en-US");
      expect(scraper.extractIdentifier("https://www.rippling.com/de-DE/careers/open-roles")).toBe("de-DE");
    });

    it("returns 'main' for root path URLs", () => {
      const { httpClient } = createHttpMock();
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

      const { httpClient, fetchMock, postMock } = createHttpMock(
        createRipplingAlgoliaPayload(entries),
        [
        createRipplingDetailPage("Software Engineer", "We are hiring engineers."),
        createRipplingDetailPage("Product Manager", "We are hiring PMs."),
        ]
      );

      const scraper = new RipplingScraper(httpClient);
      const result = await scraper.scrape(
        "https://www.rippling.com/en-IN/careers/open-roles"
      );

      expect(result.outcome).not.toBe("error");
      expect(result.outcome).toBe("success");
      expect(result.jobs).toHaveLength(2);
      expect(result.openExternalIds).toHaveLength(2);
      expect(result.openExternalIds).toContain(`rippling-${jobId1}`);
      expect(result.openExternalIds).toContain(`rippling-${jobId2}`);
      expect(result.listingCompleteness).toBe("complete");

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

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
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

      const { httpClient, fetchMock } = createHttpMock(
        createRipplingAlgoliaPayload(entries)
      );

      const scraper = new RipplingScraper(httpClient);
      const result = await scraper.scrape(
        "https://www.rippling.com/en-IN/careers/open-roles",
        {
          existingExternalIds: new Set([`rippling-${jobId}`]),
        }
      );

      expect(result.outcome).not.toBe("error");
      expect(result.jobs).toHaveLength(0);
      expect(result.openExternalIds).toHaveLength(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("preserves plain-text detail descriptions as plain text", async () => {
      const jobId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      const entries = [
        createRipplingEntry(jobId, "Software Engineer", [
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
      ];
      const { httpClient } = createHttpMock(
        createRipplingAlgoliaPayload(entries),
        [
        new Response(
          "<html><body><main>Build reliable products with the platform team.</main></body></html>",
          { status: 200, headers: { "Content-Type": "text/html" } }
        ),
        ]
      );

      const result = await new RipplingScraper(httpClient).scrape(
        "https://www.rippling.com/en-IN/careers/open-roles"
      );

      expect(result.outcome).toBe("success");
      expect(result.jobs[0]).toMatchObject({
        description: "Build reliable products with the platform team.",
        descriptionFormat: "plain",
      });
    });

    it("returns an error when the listings envelope is invalid", async () => {
      const { httpClient } = createHttpMock({ pageProps: {} });

      const scraper = new RipplingScraper(httpClient);
      const result = await scraper.scrape(
        "https://www.rippling.com/en-IN/careers/open-roles"
      );

      expect(result.outcome).toBe("error");
      expect(result.error).toMatchObject({
        code: "parse_error",
        message: expect.stringContaining("Rippling Algolia"),
      });
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

      const { httpClient } = createHttpMock(
        createRipplingAlgoliaPayload(entries),
        [
        new Response("Not Found", { status: 404 }),
        ]
      );

      const scraper = new RipplingScraper(httpClient);
      const result = await scraper.scrape(
        "https://www.rippling.com/en-IN/careers/open-roles"
      );

      expect(result.outcome).not.toBe("error");
      expect(result.outcome).toBe("partial");
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].description).toBeUndefined();
      if (result.outcome !== "partial") throw new Error("Expected a partial result");
      expect(result.issues?.[0]?.message).toContain("detail request");
    });

    it("handles empty listings", async () => {
      const { httpClient } = createHttpMock(createRipplingAlgoliaPayload([]));

      const scraper = new RipplingScraper(httpClient);
      const result = await scraper.scrape(
        "https://www.rippling.com/en-IN/careers/open-roles"
      );

      expect(result.outcome).not.toBe("error");
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

      const { httpClient, fetchMock } = createHttpMock(
        createRipplingAlgoliaPayload(entries),
        [
        createRipplingDetailPage("Data Scientist", "Great role"),
        ]
      );

      const scraper = new RipplingScraper(httpClient);
      const result = await scraper.scrape(
        "https://www.rippling.com/en-IN/careers/open-roles"
      );

      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].title).toBe("Data Scientist");
      expect(result.jobs[0].location).toContain("Bangalore");
      expect(result.jobs[0].location).toContain("London");
      expect(fetchMock).toHaveBeenCalledTimes(1);
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

      const { httpClient } = createHttpMock(
        createRipplingAlgoliaPayload(entries),
        [
        createRipplingDetailPage("Remote Role", "desc"),
        createRipplingDetailPage("Hybrid Role", "desc"),
        createRipplingDetailPage("Onsite Role", "desc"),
        ]
      );

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

    it("paginates the public careers index and preserves all listing IDs", async () => {
      const first = createRipplingEntry("page-1", "First Role", []);
      const second = createRipplingEntry("page-2", "Second Role", []);
      const postMock = vi
        .fn()
        .mockResolvedValueOnce(
          createRipplingAlgoliaPayload([first], { page: 0, nbPages: 2 })
        )
        .mockResolvedValueOnce(
          createRipplingAlgoliaPayload([second], { page: 1, nbPages: 2 })
        );
      const scraper = new RipplingScraper(
        createHttpClientStub({ post: postMock as IHttpClient["post"] })
      );

      const result = await scraper.scrape(
        "https://www.rippling.com/en-IN/careers/open-roles",
        {
          existingExternalIds: new Set(["rippling-page-1", "rippling-page-2"]),
        }
      );

      expect(result).toMatchObject({
        outcome: "success",
        totalListings: 2,
        listingCompleteness: "complete",
      });
      expect(result.openExternalIds).toEqual([
        "rippling-page-1",
        "rippling-page-2",
      ]);
      expect(postMock).toHaveBeenCalledTimes(2);
    });

    it("retains fetched pages and marks listings partial when a later page fails", async () => {
      const first = createRipplingEntry("page-1", "First Role", []);
      const postMock = vi
        .fn()
        .mockResolvedValueOnce(
          createRipplingAlgoliaPayload([first], { page: 0, nbPages: 2 })
        )
        .mockRejectedValueOnce(new TypeError("network down"));
      const scraper = new RipplingScraper(
        createHttpClientStub({ post: postMock as IHttpClient["post"] })
      );

      const result = await scraper.scrape(
        "https://www.rippling.com/en-IN/careers/open-roles",
        { existingExternalIds: new Set(["rippling-page-1"]) }
      );

      expect(result).toMatchObject({
        outcome: "partial",
        totalListings: 1,
        listingCompleteness: "partial",
      });
      if (result.outcome !== "partial") throw new Error("Expected a partial result");
      expect(result.issues?.[0]?.message).toContain("partially fetched");
    });

    it("accepts minimal listings without unused pagination or location metadata", async () => {
      const listings = {
        results: [
          {
            page: 0,
            nbPages: 1,
            hits: [
              {
                jobId: "minimal-1",
                name: "Minimal Engineer",
                url: "https://ats.rippling.com/rippling/jobs/minimal-1",
              },
            ],
          },
        ],
      };
      const { httpClient } = createHttpMock(listings, [
        createRipplingDetailPage("Minimal Engineer", "Build systems."),
      ]);
      const scraper = new RipplingScraper(httpClient);

      const result = await scraper.scrape(
        "https://www.rippling.com/en-IN/careers/open-roles"
      );

      expect(result).toMatchObject({
        outcome: "success",
        totalListings: 1,
        listingCompleteness: "complete",
      });
    });

    it("preserves transport errors while fetching listings", async () => {
      const postMock = vi.fn().mockRejectedValueOnce(new TypeError("network down"));
      const httpClient = createHttpClientStub({
        post: postMock as IHttpClient["post"],
      });

      const result = await new RipplingScraper(httpClient).scrape(
        "https://www.rippling.com/en-IN/careers/open-roles"
      );

      expect(result).toMatchObject({
        outcome: "error",
        error: { code: "network_error", retryable: true },
      });
    });

    it("returns invalid_url without fetching for malformed source input", async () => {
      const { httpClient, postMock } = createHttpMock();

      const result = await new RipplingScraper(httpClient).scrape("not a URL");

      expect(result).toMatchObject({ outcome: "error", error: { code: "invalid_url" } });
      expect(postMock).not.toHaveBeenCalled();
    });
  });
});
