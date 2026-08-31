import { describe, expect, it, vi } from "vitest";

import { OracleScraper } from "@/lib/scraper/platforms/oracle";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

const SOURCE_URL =
  "https://hdpc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LateralHiring/jobs";
const BOARD_TOKEN = "hdpc.fa.us2.oraclecloud.com/CX_3002";

function listingPayload(ids: string[], total: number, offset: number, limit: number) {
  return {
    items: [
      {
        Limit: limit,
        Offset: offset,
        TotalJobsCount: total,
        requisitionList: ids.map((id) => ({
          Id: id,
          Title: `Role ${id}`,
          PrimaryLocation: "Bengaluru, Karnataka, India",
          PrimaryLocationCountry: "IN",
          PostedDate: "2026-08-30",
          WorkplaceType: "Hybrid",
          JobType: "Full Time",
          JobFunction: "Engineering",
          otherWorkLocations: [] as Array<{ LocationName: string }>,
          secondaryLocations: [] as Array<{ LocationName: string }>,
        })),
      },
    ],
  };
}

function detailPayload(id: string) {
  return {
    items: [
      {
        Id: id,
        Title: `Role ${id}`,
        PrimaryLocation: "Bengaluru, Karnataka, India",
        WorkplaceType: "Hybrid",
        JobType: "Full Time",
        JobFunction: "Engineering",
        ExternalDescriptionStr: `<h2>About</h2><p>Build systems ${id}.</p>`,
        ExternalResponsibilitiesStr: null,
        ExternalQualificationsStr: null,
        ShortDescriptionStr: null,
      },
    ],
  };
}

function finder(url: string): string {
  return new URL(url).searchParams.get("finder") ?? "";
}

describe("OracleScraper", () => {
  it("detects Oracle Candidate Experience and Goldman aliases safely", () => {
    const scraper = new OracleScraper(createHttpClientStub());
    expect(scraper.validate(SOURCE_URL)).toBe(true);
    expect(scraper.validate("https://higher.gs.com/results")).toBe(true);
    expect(scraper.validate("https://careers.ti.com/en/sites/CX/jobs")).toBe(true);
    expect(
      scraper.validate("https://careers.oracle.com/en/sites/jobsearch/jobs")
    ).toBe(true);
    expect(
      scraper.validate(
        "https://hdpc.fa.us2.oraclecloud.com.example.com/hcmUI/CandidateExperience/en/sites/acme/jobs"
      )
    ).toBe(false);
    expect(
      scraper.validate("https://careers.ti.com.example.com/en/sites/CX/jobs")
    ).toBe(false);
    expect(scraper.extractIdentifier(SOURCE_URL)).toBe(
      "hdpc.fa.us2.oraclecloud.com/LateralHiring"
    );
    expect(
      scraper.extractIdentifier("https://careers.ti.com/en/sites/CX/jobs")
    ).toBe("careers.ti.com/CX");
    expect(
      scraper.extractIdentifier("https://careers.oracle.com/en/sites/jobsearch/jobs")
    ).toBe("careers.oracle.com/CX_45001");
  });

  it("rejects board tokens that do not identify an Oracle careers host", async () => {
    const fetchMock = vi.fn();
    const scraper = new OracleScraper(createHttpClientStub({ fetch: fetchMock }));

    await expect(
      scraper.scrape(SOURCE_URL, { boardToken: "internal.example/CX_1" })
    ).resolves.toMatchObject({
      outcome: "error",
      error: { code: "invalid_url" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("supports Oracle boards whose site number is the bare CX alias", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          '<script src="https://edbz.fa.us2.oraclecloud.com:443/hcmUI/CandExpStatic/app.js"></script><div data-sitenumber="CX"></div>'
        )
      )
      .mockImplementationOnce(async (url: string) => {
        expect(new URL(url).hostname).toBe("edbz.fa.us2.oraclecloud.com");
        expect(finder(url)).toContain("siteNumber=CX");
        return Response.json(listingPayload([], 0, 0, 200));
      });
    const scraper = new OracleScraper(createHttpClientStub({ fetch: fetchMock }));

    await expect(
      scraper.scrape("https://careers.ti.com/en/sites/CX/jobs")
    ).resolves.toMatchObject({
      outcome: "success",
      detectedBoardToken: "careers.ti.com/CX",
      totalListings: 0,
      listingCompleteness: "complete",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("discovers a numeric site number on a branded Oracle host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          '<script src="https://eeho.fa.us2.oraclecloud.com/hcmUI/CandExpStatic/app.js"></script><div data-sitenumber="CX_45001"></div>'
        )
      )
      .mockResolvedValueOnce(Response.json(listingPayload([], 0, 0, 200)));
    const scraper = new OracleScraper(createHttpClientStub({ fetch: fetchMock }));

    await expect(
      scraper.scrape("https://careers.oracle.com/en/sites/jobsearch/jobs")
    ).resolves.toMatchObject({
      outcome: "success",
      detectedBoardToken: "careers.oracle.com/CX_45001",
      totalListings: 0,
      listingCompleteness: "complete",
    });
  });

  it("paginates the public API and hydrates complete job details", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsedFinder = finder(url);
      if (new URL(url).pathname.endsWith("recruitingCEJobRequisitionDetails")) {
        return Response.json(detailPayload(parsedFinder.match(/Id="([^"]+)"/u)?.[1] ?? ""));
      }
      const offset = Number(parsedFinder.match(/offset=(\d+)/u)?.[1] ?? 0);
      return Response.json(
        offset === 0
          ? listingPayload(["174133", "174134"], 3, 0, 2)
          : listingPayload(["174135"], 3, 2, 2)
      );
    });
    const scraper = new OracleScraper(createHttpClientStub({ fetch: fetchMock }), {
      listingPageSize: 2,
      detailDelayMs: 0,
    });
    const result = await scraper.scrape(SOURCE_URL, {
      boardToken: BOARD_TOKEN,
      existingExternalIds: new Set([
        "oracle-hdpc.fa.us2.oraclecloud.com-CX_3002-174133",
      ]),
    });

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 3,
      listingCompleteness: "complete",
      openExternalIds: [
        "oracle-hdpc.fa.us2.oraclecloud.com-CX_3002-174133",
        "oracle-hdpc.fa.us2.oraclecloud.com-CX_3002-174134",
        "oracle-hdpc.fa.us2.oraclecloud.com-CX_3002-174135",
      ],
    });
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toMatchObject({
      department: "Engineering",
      employmentType: "full-time",
      locationType: "hybrid",
      descriptionFormat: "markdown",
    });
    expect(result.jobs[0]?.url).toContain("/sites/LateralHiring/job/174134");
  });

  it("resolves a site alias from the public Candidate Experience page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<div data-sitenumber="CX_3002"></div>')
      )
      .mockResolvedValueOnce(Response.json(listingPayload([], 0, 0, 200)));
    const scraper = new OracleScraper(createHttpClientStub({ fetch: fetchMock }));

    await expect(scraper.scrape(SOURCE_URL)).resolves.toMatchObject({
      outcome: "success",
      detectedBoardToken: BOARD_TOKEN,
      totalListings: 0,
      listingCompleteness: "complete",
    });
  });

  it("resolves the Goldman branded alias without a configured board token", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(new URL(url).hostname).toBe("hdpc.fa.us2.oraclecloud.com");
      expect(finder(url)).toContain("siteNumber=CX_3002");
      return Response.json(listingPayload([], 0, 0, 200));
    });
    const scraper = new OracleScraper(createHttpClientStub({ fetch: fetchMock }));

    await expect(scraper.scrape("https://higher.gs.com/results")).resolves.toMatchObject({
      outcome: "success",
      detectedBoardToken: BOARD_TOKEN,
      totalListings: 0,
      listingCompleteness: "complete",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("advances pagination using the limit returned by Oracle", async () => {
    const requestedOffsets: number[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      const offset = Number(finder(url).match(/offset=(\d+)/u)?.[1] ?? 0);
      requestedOffsets.push(offset);
      return Response.json(
        offset === 0
          ? listingPayload(["1", "2"], 3, 0, 2)
          : listingPayload(["3"], 3, 2, 2)
      );
    });
    const scraper = new OracleScraper(createHttpClientStub({ fetch: fetchMock }), {
      listingPageSize: 200,
    });

    const result = await scraper.scrape(SOURCE_URL, {
      boardToken: BOARD_TOKEN,
      existingExternalIds: new Set([
        "oracle-hdpc.fa.us2.oraclecloud.com-CX_3002-1",
        "oracle-hdpc.fa.us2.oraclecloud.com-CX_3002-2",
        "oracle-hdpc.fa.us2.oraclecloud.com-CX_3002-3",
      ]),
    });

    expect(requestedOffsets).toEqual([0, 2]);
    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 3,
      listingCompleteness: "complete",
    });
  });

  it("overlaps large Oracle pages so listing movement cannot create gaps", async () => {
    const requestedOffsets: number[] = [];
    const firstIds = Array.from({ length: 200 }, (_value, index) => String(index + 1));
    const overlappingIds = Array.from(
      { length: 11 },
      (_value, index) => String(index + 191)
    );
    const fetchMock = vi.fn(async (url: string) => {
      const offset = Number(finder(url).match(/offset=(\d+)/u)?.[1] ?? 0);
      requestedOffsets.push(offset);
      return Response.json(
        offset === 0
          ? listingPayload(firstIds, 201, 0, 200)
          : listingPayload(overlappingIds, 201, 190, 200)
      );
    });
    const scraper = new OracleScraper(createHttpClientStub({ fetch: fetchMock }));
    const existingExternalIds = new Set(
      Array.from(
        { length: 201 },
        (_value, index) =>
          `oracle-hdpc.fa.us2.oraclecloud.com-CX_3002-${index + 1}`
      )
    );

    const result = await scraper.scrape(SOURCE_URL, {
      boardToken: BOARD_TOKEN,
      existingExternalIds,
    });

    expect(requestedOffsets).toEqual([0, 190]);
    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 201,
      listingCompleteness: "complete",
    });
  });

  it("retains secondary locations for early filtering and hydration", async () => {
    const payload = listingPayload(["1"], 1, 0, 200);
    const listing = payload.items[0]?.requisitionList[0];
    if (!listing) throw new Error("Expected Oracle listing fixture");
    listing.PrimaryLocation = "New York, United States";
    listing.secondaryLocations.push({ LocationName: "Bengaluru, Karnataka, India" });
    const fetchMock = vi.fn(async (url: string) =>
      new URL(url).pathname.endsWith("recruitingCEJobRequisitionDetails")
        ? Response.json({
            ...detailPayload("1"),
            items: [
              {
                ...detailPayload("1").items[0],
                PrimaryLocation: "New York, United States",
              },
            ],
          })
        : Response.json(payload)
    );
    const scraper = new OracleScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
    });

    const result = await scraper.scrape(SOURCE_URL, {
      boardToken: BOARD_TOKEN,
      filters: { city: "Bengaluru" },
    });

    expect(result).toMatchObject({
      outcome: "success",
      jobs: [
        {
          externalId: "oracle-hdpc.fa.us2.oraclecloud.com-CX_3002-1",
          location: "New York, United States | Bengaluru, Karnataka, India",
        },
      ],
    });
  });

  it("returns partial when a later advertised page fails", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const offset = Number(finder(url).match(/offset=(\d+)/u)?.[1] ?? 0);
      return offset === 0
        ? Response.json(listingPayload(["1", "2"], 3, 0, 2))
        : new Response("busy", { status: 503 });
    });
    const scraper = new OracleScraper(createHttpClientStub({ fetch: fetchMock }), {
      listingPageSize: 2,
    });
    const result = await scraper.scrape(SOURCE_URL, {
      boardToken: BOARD_TOKEN,
      existingExternalIds: new Set([
        "oracle-hdpc.fa.us2.oraclecloud.com-CX_3002-1",
        "oracle-hdpc.fa.us2.oraclecloud.com-CX_3002-2",
      ]),
    });
    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 2,
      listingCompleteness: "partial",
    });
  });
});
