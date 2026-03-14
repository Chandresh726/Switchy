import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";

import type { IBrowserClient } from "@/lib/scraper/infrastructure/browser-client";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { ServiceNowScraper } from "@/lib/scraper/platforms/servicenow";

function createHttpClient(): IHttpClient {
  return {
    fetch: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
  };
}

function createBrowserClient(page: Page): IBrowserClient {
  return {
    bootstrap: vi.fn(async () => null),
    withBrowser: vi.fn(async (callback: (p: Page) => Promise<unknown>) => callback(page)) as IBrowserClient["withBrowser"],
    close: vi.fn(async () => undefined),
  };
}

function listingHtml(jobs: Array<{ id: string; slug: string; title: string; city: string }>): string {
  const cards = jobs
    .map(
      (j) => `
        <div>
          <h2><a href="/jobs/${j.id}/${j.slug}/">${j.title}</a></h2>
          <ul><li>${j.city}</li></ul>
        </div>`
    )
    .join("");
  return `<main>${cards}</main>`;
}

function detailHtml(opts: {
  title: string;
  locationText: string;
  locationHref: string;
  remote?: boolean;
  hybrid?: boolean;
  requiredInOffice?: boolean;
  flexible?: boolean;
  description: string;
  additionalInfo?: string;
}): string {
  const locationLi = `<li><a href="${opts.locationHref}">${opts.locationText}</a></li>`;
  const remoteLi = opts.remote ? "<li>Remote</li>" : "";
  const hybridLi = opts.hybrid ? "<li>Hybrid</li>" : "";
  const officeLi = opts.requiredInOffice ? "<li>Required in Office</li>" : "";
  const flexibleLi = opts.flexible ? "<li>Flexible</li>" : "";
  const teamLi = '<li><a href="/teams/engineering/">Engineering</a></li>';

  return `<main>
    <h1>${opts.title}</h1>
    <ul>${teamLi}${locationLi}${remoteLi}${hybridLi}${officeLi}${flexibleLi}</ul>
    <article>
      <section><h3>Company Description</h3><p>Some company info.</p></section>
      <section><h3>Job Description</h3><p>${opts.description}</p></section>
      ${opts.additionalInfo ? `<section><h3>Additional Information</h3><p>${opts.additionalInfo}</p></section>` : ""}
    </article>
  </main>`;
}

describe("ServiceNowScraper", () => {
  it("extracts listings with h2 selector and enriches location from detail page", async () => {
    const scraper = new ServiceNowScraper(createHttpClient(), createBrowserClient({} as Page));

    const listings = (scraper as unknown as {
      extractListingItems: (baseUrl: string, html: string) => Array<{ id: string; title: string; url: string; location?: string }>;
    }).extractListingItems(
      "https://careers.servicenow.com/jobs",
      listingHtml([
        { id: "744000113467268", slug: "staff-software-engineer", title: "Staff Software Engineer", city: "Hyderabad" },
      ])
    );

    expect(listings).toEqual([
      {
        id: "744000113467268",
        title: "Staff Software Engineer",
        url: "https://careers.servicenow.com/jobs/744000113467268/staff-software-engineer/",
        location: "Hyderabad",
      },
    ]);

    const detailHtmlStr = detailHtml({
      title: "Staff Software Engineer",
      locationText: "Hyderabad, India",
      locationHref: "/locations/apj/hyderabad-india/",
      hybrid: true,
      description: "Design backend systems.",
      additionalInfo: "Equal opportunity employer.",
    });

    const job = (scraper as unknown as {
      parseDetailHtml: (
        item: { id: string; title: string; url: string; location?: string },
        html: string
      ) => { description?: string; descriptionFormat?: string; locationType?: string; location?: string };
    }).parseDetailHtml(listings[0], detailHtmlStr);

    expect(job.location).toBe("Hyderabad, India");
    expect(job.locationType).toBe("hybrid");
    expect(job.descriptionFormat).toBe("markdown");
    expect(job.description).toContain("Design backend systems.");
    expect(job.description).toContain("Additional Information");
    expect(job.description).not.toContain("Company Description");
  });

  it("detects remote location type from detail page", async () => {
    const scraper = new ServiceNowScraper(createHttpClient(), createBrowserClient({} as Page));

    const listings = (scraper as unknown as {
      extractListingItems: (baseUrl: string, html: string) => Array<{ id: string; title: string; url: string; location?: string }>;
    }).extractListingItems(
      "https://careers.servicenow.com/jobs",
      listingHtml([
        { id: "1", slug: "remote-engineer", title: "Remote Engineer", city: "Bengaluru" },
      ])
    );

    const job = (scraper as unknown as {
      parseDetailHtml: (item: { id: string; title: string; url: string; location?: string }, html: string) => { locationType?: string; location?: string };
    }).parseDetailHtml(listings[0], detailHtml({
      title: "Remote Engineer",
      locationText: "Bengaluru, India",
      locationHref: "/locations/apj/bengaluru-india/",
      remote: true,
      description: "Work from anywhere.",
    }));

    expect(job.location).toBe("Bengaluru, India");
    expect(job.locationType).toBe("remote");
  });

  it("detects onsite location type when no remote/hybrid text", async () => {
    const scraper = new ServiceNowScraper(createHttpClient(), createBrowserClient({} as Page));

    const listings = (scraper as unknown as {
      extractListingItems: (baseUrl: string, html: string) => Array<{ id: string; title: string; url: string; location?: string }>;
    }).extractListingItems(
      "https://careers.servicenow.com/jobs",
      listingHtml([
        { id: "3", slug: "onsite-role", title: "Onsite Role", city: "Chicago" },
      ])
    );

    const job = (scraper as unknown as {
      parseDetailHtml: (item: { id: string; title: string; url: string; location?: string }, html: string) => { locationType?: string; location?: string };
    }).parseDetailHtml(listings[0], detailHtml({
      title: "Onsite Role",
      locationText: "Chicago, IL",
      locationHref: "/locations/ams/chicago-il/",
      description: "Come to the office.",
    }));

    expect(job.location).toBe("Chicago, IL");
    expect(job.locationType).toBe("onsite");
  });

  it("paginates through multiple pages and deduplicates", async () => {
    const page1Html = listingHtml([
      { id: "1", slug: "engineer-1", title: "Engineer 1", city: "Chicago" },
      { id: "2", slug: "engineer-2", title: "Engineer 2", city: "Hyderabad" },
    ]) + '<nav aria-label="Pagination"><a href="/jobs?page=2">2</a><a href="/jobs?page=3">3</a></nav>';

    const page2Html = listingHtml([
      { id: "2", slug: "engineer-2", title: "Engineer 2", city: "Hyderabad" },
      { id: "3", slug: "engineer-3", title: "Engineer 3", city: "Dublin" },
    ]) + '<nav aria-label="Pagination"><a href="/jobs?page=1">1</a><a href="/jobs?page=3">3</a></nav>';

    const page3Html = listingHtml([]) + '<nav aria-label="Pagination"><a href="/jobs?page=1">1</a><a href="/jobs?page=2">2</a></nav>';

    const detail1Html = detailHtml({ title: "Engineer 1", locationText: "Chicago, IL", locationHref: "/locations/ams/chicago-il/", description: "Build stuff." });
    const detail2Html = detailHtml({ title: "Engineer 2", locationText: "Hyderabad, India", locationHref: "/locations/apj/hyderabad-india/", description: "Build more stuff." });
    const detail3Html = detailHtml({ title: "Engineer 3", locationText: "Dublin, Ireland", locationHref: "/locations/emea/dublin-ireland/", description: "Build things." });

    let contentCallCount = 0;

    const page = {
      goto: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      content: vi
        .fn()
        .mockImplementation(async () => {
          const callIndex = contentCallCount++;
          return [page1Html, page2Html, page3Html, detail1Html, detail2Html, detail3Html][callIndex] ?? "";
        }),
      url: vi.fn(() => "https://careers.servicenow.com/jobs"),
    } as unknown as Page;

    const scraper = new ServiceNowScraper(createHttpClient(), createBrowserClient(page), {
      timeout: 1000,
      requestDelayMs: 0,
      maxPages: 5,
    });

    const result = await scraper.scrape("https://careers.servicenow.com/jobs");

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("success");
    expect(result.jobs).toHaveLength(3);
    expect(result.jobs[0]?.externalId).toBe("servicenow-1");
    expect(result.jobs[0]?.location).toBe("Chicago, IL");
    expect(result.jobs[1]?.externalId).toBe("servicenow-2");
    expect(result.jobs[1]?.location).toBe("Hyderabad, India");
    expect(result.jobs[2]?.externalId).toBe("servicenow-3");
    expect(result.jobs[2]?.location).toBe("Dublin, Ireland");
    expect(result.openExternalIdsComplete).toBe(true);
  });

  it("returns partial when detail pages fail after listings are collected", async () => {
    const listingHtmlStr = listingHtml([
      { id: "1", slug: "software-engineer", title: "Software Engineer", city: "Bengaluru" },
      { id: "2", slug: "site-reliability-engineer", title: "Site Reliability Engineer", city: "Remote" },
    ]) + '<nav aria-label="Pagination"><a href="/jobs?page=1">1</a></nav>';

    const detail1Html = detailHtml({
      title: "Software Engineer",
      locationText: "Bengaluru, India",
      locationHref: "/locations/apj/bengaluru-india/",
      description: "Build internal platforms.",
    });

    const page = {
      goto: vi.fn(async (url: string) => {
        if (url.includes("/jobs/2/")) {
          throw new Error("blocked");
        }
      }),
      waitForTimeout: vi.fn(async () => undefined),
      content: vi
        .fn()
        .mockResolvedValueOnce(listingHtmlStr)
        .mockResolvedValueOnce(detail1Html),
      url: vi.fn(() => "https://careers.servicenow.com/jobs"),
    } as unknown as Page;

    const scraper = new ServiceNowScraper(createHttpClient(), createBrowserClient(page), {
      timeout: 1000,
      requestDelayMs: 0,
    });

    const result = await scraper.scrape("https://careers.servicenow.com/jobs");

    expect(result.success).toBe(false);
    expect(result.outcome).toBe("partial");
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]?.externalId).toBe("servicenow-1");
    expect(result.jobs[0]?.location).toBe("Bengaluru, India");
    expect(result.jobs[0]?.description).toContain("Build internal platforms.");
    expect(result.jobs[1]).toMatchObject({
      externalId: "servicenow-2",
      title: "Site Reliability Engineer",
      location: "Remote",
    });
    expect(result.openExternalIdsComplete).toBe(true);
  });

  it("respects maxPages config", async () => {
    const page1Html = listingHtml([
      { id: "1", slug: "role-1", title: "Role 1", city: "SF" },
    ]) + '<nav><a href="/jobs?page=2">2</a><a href="/jobs?page=5">5</a></nav>';

    const page2Html = listingHtml([
      { id: "2", slug: "role-2", title: "Role 2", city: "NYC" },
    ]) + '<nav><a href="/jobs?page=1">1</a><a href="/jobs?page=5">5</a></nav>';

    const detail1Html = detailHtml({ title: "Role 1", locationText: "San Francisco, CA", locationHref: "/locations/ams/san-francisco-ca/", description: "Work in SF." });
    const detail2Html = detailHtml({ title: "Role 2", locationText: "New York, NY", locationHref: "/locations/ams/new-york-ny/", description: "Work in NYC." });

    const page = {
      goto: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      content: vi
        .fn()
        .mockResolvedValueOnce(page1Html)
        .mockResolvedValueOnce(page2Html)
        .mockResolvedValueOnce(detail1Html)
        .mockResolvedValueOnce(detail2Html),
      url: vi.fn(() => "https://careers.servicenow.com/jobs"),
    } as unknown as Page;

    const scraper = new ServiceNowScraper(createHttpClient(), createBrowserClient(page), {
      timeout: 1000,
      requestDelayMs: 0,
      maxPages: 2,
    });

    const result = await scraper.scrape("https://careers.servicenow.com/jobs");

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(result.openExternalIdsComplete).toBe(false);
    expect(page.goto).toHaveBeenCalledWith("https://careers.servicenow.com/jobs?page=2", expect.any(Object));
  });

  it("extracts location from /jobs/?location= href pattern", async () => {
    const scraper = new ServiceNowScraper(createHttpClient(), createBrowserClient({} as Page));

    const job = (scraper as unknown as {
      parseDetailHtml: (item: { id: string; title: string; url: string; location?: string }, html: string) => { location?: string; locationType?: string };
    }).parseDetailHtml(
      { id: "1", title: "Senior Engineer", url: "https://careers.servicenow.com/jobs/1/senior-engineer/", location: "Hyderabad" },
      detailHtml({
        title: "Senior Engineer",
        locationText: "Hyderabad",
        locationHref: "/jobs/?location=Hyderabad",
        description: "Build things.",
      })
    );

    expect(job.location).toBe("Hyderabad");
    expect(job.locationType).toBe("onsite");
  });

  it("maps 'Required in Office' to onsite location type", async () => {
    const scraper = new ServiceNowScraper(createHttpClient(), createBrowserClient({} as Page));

    const job = (scraper as unknown as {
      parseDetailHtml: (item: { id: string; title: string; url: string; location?: string }, html: string) => { location?: string; locationType?: string };
    }).parseDetailHtml(
      { id: "2", title: "Office Role", url: "https://careers.servicenow.com/jobs/2/office-role/", location: "Chicago" },
      detailHtml({
        title: "Office Role",
        locationText: "Chicago",
        locationHref: "/jobs/?location=Chicago",
        requiredInOffice: true,
        description: "Come to office.",
      })
    );

    expect(job.location).toBe("Chicago");
    expect(job.locationType).toBe("onsite");
  });

  it("maps 'Flexible' to hybrid location type", async () => {
    const scraper = new ServiceNowScraper(createHttpClient(), createBrowserClient({} as Page));

    const job = (scraper as unknown as {
      parseDetailHtml: (item: { id: string; title: string; url: string; location?: string }, html: string) => { location?: string; locationType?: string };
    }).parseDetailHtml(
      { id: "3", title: "Flexible Role", url: "https://careers.servicenow.com/jobs/3/flexible-role/", location: "Dublin" },
      detailHtml({
        title: "Flexible Role",
        locationText: "Dublin",
        locationHref: "/jobs/?location=Dublin",
        flexible: true,
        description: "Work flexibly.",
      })
    );

    expect(job.location).toBe("Dublin");
    expect(job.locationType).toBe("hybrid");
  });
});
