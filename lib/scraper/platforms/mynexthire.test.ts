import { describe, expect, it, vi } from "vitest";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { MynextHireScraper } from "@/lib/scraper/platforms/mynexthire";

function createHttpClient(postMock: ReturnType<typeof vi.fn>): IHttpClient {
  return {
    fetch: vi.fn(),
    get: vi.fn(),
    post: postMock,
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

    expect(result.success).toBe(true);
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
    expect(result.openExternalIdsComplete).toBe(true);
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
});
