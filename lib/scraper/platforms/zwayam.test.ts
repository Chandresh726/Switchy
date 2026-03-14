import { describe, expect, it, vi } from "vitest";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { ZwayamScraper } from "@/lib/scraper/platforms/zwayam";

function createHttpClient(fetchMock: ReturnType<typeof vi.fn>): IHttpClient {
  return {
    fetch: fetchMock,
    get: vi.fn(),
    post: vi.fn(),
  };
}

describe("ZwayamScraper", () => {
  it("paginates through search results and derives stable tenant ids", async () => {
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      const body = options?.body;
      if (!(body instanceof FormData)) {
        return new Response("bad request", { status: 400 });
      }

      const filterCri = JSON.parse(String(body.get("filterCri"))) as { paginationStartNo: number };
      const page = filterCri.paginationStartNo;

      if (page === 0) {
        return new Response(
          JSON.stringify({
            code: 200,
            data: {
              data: [
                {
                  _source: {
                    id: 1,
                    newJobCode: "REQ-1",
                    ["Requisition Title"]: "Backend Engineer",
                    location: "Bengaluru",
                    departmentName: "Engineering",
                    jobDescription: "<p>Build services.</p>",
                    modifiedDate: 1710000000000,
                  },
                },
              ],
              totalCount: 2,
              hasMoreData: true,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          code: 200,
          data: {
            data: [
              {
                _source: {
                  id: 2,
                  jobCode: 22,
                  designation: "Frontend Engineer",
                  Location: "Remote",
                  text5: "Web Platform",
                  shortDescriptionDb: "Own UI foundations.",
                  createdDate: 1711000000000,
                },
              },
            ],
            totalCount: 2,
            hasMoreData: false,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const scraper = new ZwayamScraper(createHttpClient(fetchMock));
    const result = await scraper.scrape("https://www.flipkartcareers.com/flipkart/jobslist");

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("success");
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]?.externalId).toBe("zwayam-flipkart-REQ-1");
    expect(result.jobs[0]?.descriptionFormat).toBe("markdown");
    expect(result.jobs[1]?.externalId).toBe("zwayam-flipkart-22");
    expect(result.openExternalIds).toEqual(["zwayam-flipkart-REQ-1", "zwayam-flipkart-22"]);
    expect(result.openExternalIdsComplete).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("hydrates low-quality descriptions from the detail API", async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes("/jobs/search")) {
        const body = options?.body;
        if (!(body instanceof FormData)) {
          return new Response("bad request", { status: 400 });
        }
        return new Response(
          JSON.stringify({
            code: 200,
            data: {
              data: [
                {
                  _source: {
                    id: 99,
                    newJobCode: "REQ-99",
                    ["Requisition Title"]: "Security Engineer",
                    location: "Bengaluru",
                    jobDescription: "ok",
                    modifiedDate: 1710000000000,
                  },
                },
              ],
              totalCount: 1,
              hasMoreData: false,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("/requisition_service/getReqFieldsForCareersSite/99/15110")) {
        return new Response(
          JSON.stringify({
            responseStatus: "SUCCESS",
            responseCode: 200,
            reponseObject: {
              customDetails: {
                "About the Role": "<p>Build secure systems.</p>",
                "About the team": "<p>Security team.</p>",
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("not found", { status: 404 });
    });

    const scraper = new ZwayamScraper(createHttpClient(fetchMock));
    const result = await scraper.scrape("https://www.flipkartcareers.com/flipkart/jobslist");

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.description).toContain("Build secure systems.");
    expect(result.jobs[0]?.descriptionFormat).toBe("markdown");
  });

  it("uses jobUrl slug to construct job URLs for Flipkart", async () => {
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      const body = options?.body;
      if (!(body instanceof FormData)) {
        return new Response("bad request", { status: 400 });
      }

      return new Response(
        JSON.stringify({
          code: 200,
          data: {
            data: [
              {
                _source: {
                  id: 720776,
                  newJobCode: "111769",
                  ["Requisition Title"]: "Manager - Business Development",
                  location: "Bangalore,Karnataka",
                  jobDescription: "A proper job description with enough content to not be considered low quality.",
                  jobUrl: "manager-business-development-bangalore-karnataka-2025112714501561",
                  modifiedDate: 1710000000000,
                },
              },
            ],
            totalCount: 1,
            hasMoreData: false,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const scraper = new ZwayamScraper(createHttpClient(fetchMock));
    const result = await scraper.scrape("https://www.flipkartcareers.com/flipkart/jobslist");

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.url).toBe(
      "https://www.flipkartcareers.com/flipkart/jobview/manager-business-development-bangalore-karnataka-2025112714501561?id=720776"
    );
  });

  it("falls back to URL without slug when jobUrl is missing", async () => {
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      const body = options?.body;
      if (!(body instanceof FormData)) {
        return new Response("bad request", { status: 400 });
      }

      return new Response(
        JSON.stringify({
          code: 200,
          data: {
            data: [
              {
                _source: {
                  id: 42,
                  newJobCode: "JOB-42",
                  ["Requisition Title"]: "Test Role",
                  location: "Remote",
                  jobDescription: "A proper description that is long enough.",
                  modifiedDate: 1710000000000,
                },
              },
            ],
            totalCount: 1,
            hasMoreData: false,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const scraper = new ZwayamScraper(createHttpClient(fetchMock));
    const result = await scraper.scrape("https://www.flipkartcareers.com/flipkart/jobslist");

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.url).toBe(
      "https://www.flipkartcareers.com/flipkart/jobview?id=42"
    );
  });
});
