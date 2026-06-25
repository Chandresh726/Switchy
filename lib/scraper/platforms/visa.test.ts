import { describe, expect, it, vi } from "vitest";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { VisaScraper } from "@/lib/scraper/platforms/visa";

type PostMock = ReturnType<typeof vi.fn<(url: string, body: unknown) => Promise<unknown>>>;

function createHttpClient(postMock: PostMock): IHttpClient {
  return {
    fetch: vi.fn() as IHttpClient["fetch"],
    get: vi.fn() as IHttpClient["get"],
    post: postMock as IHttpClient["post"],
  };
}

describe("VisaScraper", () => {
  it("builds paginated search requests and parses job details", async () => {
    const postMock = vi.fn(async (_url: string, body: unknown) => {
      const payload = body as { from: number; size: number };
      if (payload.from === 0) {
        return {
          successful: true,
          totalRecords: 2,
          recordsMatched: 2,
          pageSize: payload.size,
          from: payload.from,
          jobDetails: [
            {
              refNumber: "REF-1",
              postingId: "1001",
              jobTitle: "Senior Software Engineer",
              jobDescription: "<p>Build payment systems.</p>",
              qualifications: "<ul><li>TypeScript</li></ul>",
              city: "Bangalore",
              country: "India",
              businessUnit: "Technology",
              employmentType: "Full Time",
              postedDate: "2025-03-01T00:00:00.000Z",
            },
          ],
        };
      }

      return {
        successful: true,
        totalRecords: 2,
        recordsMatched: 2,
        pageSize: payload.size,
        from: payload.from,
        jobDetails: [
          {
            refNumber: "REF-2",
            postingId: "1002",
            jobTitle: "Engineering Manager",
            primaryLocation: "Mumbai, India",
            category: "Engineering",
            workerType: "Regular",
            updatedDate: "2025-03-02T00:00:00.000Z",
          },
        ],
      };
    });

    const scraper = new VisaScraper(createHttpClient(postMock), { pageSize: 1 });
    const result = await scraper.scrape(
      "https://www.visa.co.uk/en_gb/jobs/?functions=Technology&cities=Bangalore&cities=Mumbai"
    );

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toMatchObject({
      externalId: "visa-REF-1",
      department: "Technology",
      descriptionFormat: "markdown",
      employmentType: "full-time",
    });
    expect(result.jobs[1]).toMatchObject({
      externalId: "visa-REF-2",
      location: "Mumbai, India",
      department: "Engineering",
    });
    expect(postMock).toHaveBeenNthCalledWith(
      1,
      "https://search.visa.com/CAREERS/careers/jobs?q=",
      {
        filters: [{ superDepartment: ["Technology"] }],
        city: ["Bangalore", "Mumbai"],
        from: 0,
        size: 1,
      },
      expect.any(Object)
    );
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(result.openExternalIds).toEqual(["visa-REF-1", "visa-REF-2"]);
  });
});
