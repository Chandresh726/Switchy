import { describe, expect, it, vi } from "vitest";

import { ServiceNowScraper } from "@/lib/scraper/platforms/servicenow";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

const validJob = `
  <job>
    <title>Senior Software Engineer</title>
    <date>2026-08-20</date>
    <apijobid>JB0071234</apijobid>
    <url>https://careers.servicenow.com/jobs/JB0071234</url>
    <city>Hyderabad</city><state>Telangana</state><country>India</country>
    <description><![CDATA[<p>Build reliable workflows.</p>]]></description>
    <category>Engineering</category><jobtype>Full time</jobtype><remotetype>Hybrid</remotetype>
  </job>`;

function response(xml: string, status = 200): Response {
  return new Response(xml, {
    status,
    headers: { "Content-Type": "application/xml" },
  });
}

describe("ServiceNowScraper", () => {
  it("maps the authoritative XML feed without browser infrastructure", async () => {
    const fetchMock = vi.fn(async () => response(`<jobs>${validJob}</jobs>`));
    const scraper = new ServiceNowScraper(
      createHttpClientStub({ fetch: fetchMock })
    );

    const result = await scraper.scrape("https://careers.servicenow.com/jobs/");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://careers.servicenow.com/jobs/xml/?rss=true",
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: expect.stringContaining("xml") }),
      })
    );
    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 1,
      openExternalIds: ["servicenow-JB0071234"],
      listingCompleteness: "complete",
    });
    expect(result.jobs[0]).toMatchObject({
      externalId: "servicenow-JB0071234",
      title: "Senior Software Engineer",
      location: "Hyderabad, Telangana, India",
      locationType: "hybrid",
      department: "Engineering",
      employmentType: "full-time",
      descriptionFormat: "markdown",
    });
  });

  it("retains valid entries and marks malformed entries partial", async () => {
    const malformed = `<job><title>Missing identifiers</title></job>`;
    const scraper = new ServiceNowScraper(
      createHttpClientStub({
        fetch: vi.fn(async () => response(`<jobs>${validJob}${malformed}</jobs>`)),
      })
    );

    const result = await scraper.scrape("https://careers.servicenow.com/jobs/");

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 1,
      listingCompleteness: "partial",
    });
    expect(result.jobs).toHaveLength(1);
  });

  it("treats an empty readable feed as unknown instead of authoritative", async () => {
    const scraper = new ServiceNowScraper(
      createHttpClientStub({ fetch: vi.fn(async () => response("<jobs />")) })
    );

    const result = await scraper.scrape("https://careers.servicenow.com/jobs/");

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 0,
      listingCompleteness: "unknown",
    });
  });

  it("rejects an unrecognized successful response", async () => {
    const scraper = new ServiceNowScraper(
      createHttpClientStub({
        fetch: vi.fn(async () => response("<html>challenge</html>")),
      })
    );

    const result = await scraper.scrape("https://careers.servicenow.com/jobs/");

    expect(result).toMatchObject({
      outcome: "error",
      error: { code: "parse_error" },
      listingCompleteness: "unknown",
    });
  });
});
