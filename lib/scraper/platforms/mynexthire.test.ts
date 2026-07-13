import { describe, expect, it, vi } from "vitest";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { MynextHireScraper } from "@/lib/scraper/platforms/mynexthire";

type PostMock = ReturnType<typeof vi.fn<(url: string, body: unknown) => Promise<unknown>>>;

function createHttpClient(postMock: PostMock): IHttpClient {
  return {
    fetch: vi.fn() as IHttpClient["fetch"],
    get: vi.fn() as IHttpClient["get"],
    post: postMock as IHttpClient["post"],
  };
}

describe("MynextHireScraper", () => {
  it("parses tenant-hosted APIs and normalizes descriptions", async () => {
    const postMock = vi.fn(async () => ({
      requesterTitle: "Swiggy",
      reqDetailsBOList: [
        {
          reqId: 1001,
          reqTitle: "Software Development Engineer II",
          buName: "Marketplace",
          location: "Bangalore",
          jdDisplay: "<p>Build logistics products.</p>",
          approvedOn: 1710000000000,
          employmentType: "Full Time",
        },
        {
          reqId: 1002,
          reqTitle: "Data Analyst",
          locationAddress: "Remote - India",
          employmentType: "Contract",
        },
      ],
    }));

    const scraper = new MynextHireScraper(createHttpClient(postMock));
    const result = await scraper.scrape("https://careers.swiggy.com/#/careers");

    expect(result.outcome).not.toBe("error");
    expect(result.jobs).toHaveLength(2);
    const payloadOne = {
      pageType: "jd",
      cvSource: "careers",
      reqId: 1001,
      requester: { id: "", code: "", name: "" },
      page: "careers",
      bufilter: -1,
      customFields: {},
    };
    const expectedUrlOne = `https://careers.swiggy.com/#/careers?${encodeURIComponent(
      `src=careers&p=${Buffer.from(JSON.stringify(payloadOne)).toString("base64")}`
    )}`;

    const payloadTwo = {
      pageType: "jd",
      cvSource: "careers",
      reqId: 1002,
      requester: { id: "", code: "", name: "" },
      page: "careers",
      bufilter: -1,
      customFields: {},
    };
    const expectedUrlTwo = `https://careers.swiggy.com/#/careers?${encodeURIComponent(
      `src=careers&p=${Buffer.from(JSON.stringify(payloadTwo)).toString("base64")}`
    )}`;

    expect(result.jobs[0]).toMatchObject({
      externalId: "mynexthire-swiggy-1001",
      department: "Marketplace",
      descriptionFormat: "markdown",
      employmentType: "full-time",
      url: expectedUrlOne,
    });
    expect(result.jobs[1]).toMatchObject({
      externalId: "mynexthire-swiggy-1002",
      locationType: "remote",
      employmentType: "contract",
      url: expectedUrlTwo,
    });
    expect(result.listingCompleteness).toBe("complete");
    expect(postMock).toHaveBeenCalledWith(
      "https://swiggy.mynexthire.com/employer/careers/reqlist/get",
      {
        source: "careers",
        code: "",
        filterByBuId: -1,
      },
      expect.any(Object)
    );
  });

  it("accepts a minimal usable response without requester metadata", async () => {
    const postMock = vi.fn(async () => ({
      reqDetailsBOList: [{ reqId: 1, reqTitle: "Engineer" }],
    }));
    const scraper = new MynextHireScraper(createHttpClient(postMock));

    const result = await scraper.scrape("https://acme.mynexthire.com/careers");

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 1,
      listingCompleteness: "complete",
    });
  });
});
