import { describe, expect, it, vi } from "vitest";

import { companies, jobs, scrapeQueueItems, settings } from "@/lib/db/schema";
import { migrateOutdatedScraperSources } from "@/lib/db/scraper-source-migrations";
import { createLocalScrapeQueueService } from "@/lib/scraper";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { createHttpClientStub } from "@test/helpers/scraper-clients";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

vi.mock("@/lib/db", () => ({ db: {} }));

const sqlite = createSqliteTestHarness("switchy-composition-");

describe("scraper composition", () => {
  it("starts Visa as a new Workday company and deduplicates repeat ingestion", async () => {
    const { database } = sqlite.createDatabase();
    const old = database.insert(companies).values({ name: "Visa", platform: "visa",
      careersUrl: "https://www.visa.co.uk/en_gb/jobs/" }).returning().get();
    database.insert(jobs).values({ companyId: old.id, title: "Legacy Visa role",
      externalId: "visa-REF97308A", url: "https://www.visa.co.uk/en_gb/jobs/REF97308A" }).run();
    migrateOutdatedScraperSources(database);
    const company = database.select().from(companies).get()!;
    expect(company.id).not.toBe(old.id);
    expect(database.select().from(jobs).all()).toEqual([]);
    database.insert(settings).values({ key: "scraper_keep_device_awake", value: "false" }).run();
    const post = vi.fn(async () => ({ total: 1, jobPostings: [
      { title: "Engineer", externalPath: "/job/IN/Engineer_REF97308A", locationsText: "India" },
    ] }));
    const get = vi.fn(async () => ({ jobPostingInfo: { jobDescription: "Full job description", timeType: "Full time",
      externalUrl: "https://visa.wd5.myworkdayjobs.com/Visa/job/IN/Engineer_REF97308A" } }));
    const service = createLocalScrapeQueueService({ database,
      clients: { http: createHttpClientStub({ post: post as IHttpClient["post"], get: get as IHttpClient["get"] }) },
      dependencies: { matchingEnabled: async () => false, dispatchMatching: async () => undefined },
      runtime: { isDeviceAwake: async () => true, deviceSleepInhibitor: { acquire: async () => ({ release: async () => undefined }) } },
    });
    expect((await service.scrapeCompanies([company.id], "manual")).results[0]).toMatchObject({ outcome: "success", jobsAdded: 1 });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await service.scrapeCompanies([company.id], "manual")).results[0]).toMatchObject({ outcome: "success", jobsAdded: 0 });
    expect(database.select().from(jobs).all()).toMatchObject([
      { companyId: company.id, externalId: "workday-Visa-Engineer_REF97308A", description: "Full job description" },
    ]);
  });

  it("reconciles repeated country-scoped crawls without archiving or refreshing unrelated countries", async () => {
    const { database } = sqlite.createDatabase();
    const company = database.insert(companies).values({
      name: "Scoped Workday", platform: "workday", careersUrl: "https://scoped.wd5.myworkdayjobs.com/Board",
    }).returning().get();
    const oldSeen = new Date("2026-01-01T00:00:00Z");
    database.insert(jobs).values([
      { companyId: company.id, externalId: "workday-Board-IN", title: "Engineer", url: `${company.careersUrl}/job/IN`, location: "India", description: "Saved", descriptionQuality: "full", detailsFetchedAt: new Date() },
      { companyId: company.id, externalId: "workday-Board-US", title: "Engineer", url: `${company.careersUrl}/job/US`, location: "USA", description: "Saved", lastSeenAt: oldSeen },
    ]).run();
    database.insert(settings).values([
      { key: "scraper_filter_country", value: "India" }, { key: "scraper_keep_device_awake", value: "false" },
    ]).run();
    let closed = false;
    const post = vi.fn(async (_url: string, body: unknown) => {
      const scoped = Boolean((body as { appliedFacets: Record<string, unknown> }).appliedFacets.Country);
      const india = { title: "Engineer", externalPath: "/job/IN", locationsText: "2 Locations" };
      return {
        total: scoped ? closed ? 0 : 1 : closed ? 1 : 2,
        jobPostings: scoped ? closed ? [] : [india] : [
          ...closed ? [] : [india], { title: "Engineer", externalPath: "/job/US", locationsText: "USA" },
        ],
        facets: [{ facetParameter: "Country", descriptor: "Country", values: [
          { id: "in", descriptor: "India", count: closed ? 0 : 1 }, { id: "us", descriptor: "USA", count: 1 },
        ] }],
      };
    });
    const service = createLocalScrapeQueueService({ database,
      clients: { http: createHttpClientStub({ post: post as IHttpClient["post"] }) },
      dependencies: { matchingEnabled: async () => false, dispatchMatching: async () => undefined },
      runtime: { isDeviceAwake: async () => true, deviceSleepInhibitor: { acquire: async () => ({ release: async () => undefined }) } },
    });
    const first = await service.scrapeCompanies([company.id], "manual");
    expect(first.results[0]).toMatchObject({ outcome: "success", jobsArchived: 0 });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    closed = true;
    const second = await service.scrapeCompanies([company.id], "manual");
    expect(second.results[0]).toMatchObject({ outcome: "success", jobsArchived: 1 });
    const stored = new Map(database.select().from(jobs).all().map((job) => [job.externalId, job]));
    expect(stored.get("workday-Board-IN")?.status).toBe("archived");
    expect(stored.get("workday-Board-US")).toMatchObject({ status: "new", lastSeenAt: oldSeen });
  });

  it("persists a validated Oracle country scope and archives only its prior members", async () => {
    const { database } = sqlite.createDatabase();
    const url = "https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs";
    const company = database.insert(companies).values({ name: "Scoped Oracle", platform: "oracle", careersUrl: url }).returning().get();
    const oldSeen = new Date("2026-01-01T00:00:00Z");
    database.insert(jobs).values([
      { companyId: company.id, externalId: "oracle-acme.fa.us2.oraclecloud.com-CX_1-IN", title: "Engineer", url: url.replace("/jobs", "/job/IN"), location: "India", description: "Saved", descriptionQuality: "full", detailsFetchedAt: new Date() },
      { companyId: company.id, externalId: "oracle-acme.fa.us2.oraclecloud.com-CX_1-US", title: "Engineer", url: url.replace("/jobs", "/job/US"), location: "USA", description: "Saved", lastSeenAt: oldSeen },
    ]).run();
    database.insert(settings).values([
      { key: "scraper_filter_country", value: "India" }, { key: "scraper_keep_device_awake", value: "false" },
    ]).run();
    let closed = false;
    const fetch = vi.fn(async (request: string) => {
      const query = new URL(request).searchParams.get("finder") ?? "";
      const ids = query.includes("selectedWorkplaceTypesFacet") ? [] : query.includes("location=India") ? closed ? [] : ["IN"] : closed ? ["US"] : ["IN", "US"];
      return Response.json({ items: [{ Limit: 200, Offset: 0, TotalJobsCount: ids.length, requisitionList: ids.map((id) => ({
        Id: id, Title: "Engineer", PrimaryLocation: id === "IN" ? "India" : "USA", PrimaryLocationCountry: id,
      })) }] });
    });
    const service = createLocalScrapeQueueService({ database, clients: { http: createHttpClientStub({ fetch }) },
      queryPolicies: { platforms: { oracle: { minimumCountryListings: 0 } } },
      dependencies: { matchingEnabled: async () => false, dispatchMatching: async () => undefined },
      runtime: { isDeviceAwake: async () => true, deviceSleepInhibitor: { acquire: async () => ({ release: async () => undefined }) } },
    });
    expect((await service.scrapeCompanies([company.id], "manual")).results[0]).toMatchObject({ outcome: "success", jobsArchived: 0 });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    closed = true;
    fetch.mockClear();
    expect((await service.scrapeCompanies([company.id], "manual")).results[0]).toMatchObject({ outcome: "success", jobsArchived: 1 });
    expect(fetch).toHaveBeenCalledTimes(2); // Persistent proof skips the full original query.
    const stored = new Map(database.select().from(jobs).all().map((job) => [job.externalId, job]));
    expect(stored.get("oracle-acme.fa.us2.oraclecloud.com-CX_1-IN")?.status).toBe("archived");
    expect(stored.get("oracle-acme.fa.us2.oraclecloud.com-CX_1-US")).toMatchObject({ status: "new", lastSeenAt: oldSeen });
  });

  it("caps cold legacy Workday maintenance across companies while discovering every new job", async () => {
    const { database } = sqlite.createDatabase();
    const stored = database.insert(companies).values(Array.from({ length: 6 }, (_, index) => ({
      name: `Workday ${index}`, platform: "workday", careersUrl: `https://c${index}.wd5.myworkdayjobs.com/Board`,
    }))).returning().all();
    for (const company of stored) {
      database.insert(jobs).values(Array.from({ length: 10 }, (_, index) => ({
        companyId: company.id, title: `Engineer ${index}`, externalId: `workday-Board-REQ-${index}`,
        url: `${company.careersUrl}/job/REQ-${index}`, description: "Saved description", location: "India",
      }))).run();
    }
    database.insert(settings).values({ key: "scraper_keep_device_awake", value: "false" }).run();
    const get = vi.fn(async (url: string) => {
      const source = new URL(url);
      return { jobPostingInfo: { jobDescription: "Updated description", timeType: "Full time",
        externalUrl: `${source.origin}/Board/job/${source.pathname.split("/").pop()}` } };
    });
    const post = vi.fn(async () => ({ total: 11, jobPostings: Array.from({ length: 11 }, (_, index) => ({
      title: `Engineer ${index}`, externalPath: `/job/REQ-${index}`, locationsText: "India",
    })) }));
    const service = createLocalScrapeQueueService({ database,
      clients: { http: createHttpClientStub({ get: get as IHttpClient["get"], post: post as IHttpClient["post"] }) },
      dependencies: { matchingEnabled: async () => false, dispatchMatching: async () => undefined },
      runtime: { isDeviceAwake: async () => true, deviceSleepInhibitor: {
        acquire: async () => ({ release: async () => undefined }),
      } },
    });
    const result = await service.scrapeCompanies(stored.map((company) => company.id), "manual");
    expect(result.summary.successfulCompanies).toBe(6);
    expect(result.summary.totalJobsAdded).toBe(6);
    expect(post).toHaveBeenCalledTimes(6);
    expect(get).toHaveBeenCalledTimes(31); // Shared 25-record maintenance quota plus all six new jobs.
    const saved = database.select().from(jobs).all();
    expect(saved).toHaveLength(66);
    expect(saved.filter((job) => job.detailsFetchedAt)).toHaveLength(31);
    expect(saved.filter((job) => !job.detailsFetchedAt).every((job) => job.description === "Saved description")).toBe(true);
    const metrics = database.select().from(scrapeQueueItems).all().map((item) => JSON.parse(item.resultJson!).metrics);
    expect(metrics.reduce((total, value) => total + value.maintenanceDetailsSelected, 0)).toBe(25);
    expect(metrics.reduce((total, value) => total + value.priorityDetailsSelected, 0)).toBe(6);
  });

  it("runs repeated ingestion entirely through injected clients and a temporary database", async () => {
    const { database } = sqlite.createDatabase();
    const company = database.insert(companies).values({ name: "Acme", platform: "greenhouse",
      careersUrl: "https://boards.greenhouse.io/acme" }).returning().get();
    database.insert(settings).values({ key: "scraper_keep_device_awake", value: "false" }).run();
    const fetch = vi.fn(async () => Response.json({ jobs: [{ id: 1, title: "Engineer",
      absolute_url: "https://example.com/one", content: "Build useful software" }] }));
    const dispatch = vi.fn(async () => undefined);
    const service = createLocalScrapeQueueService({ database,
      clients: { http: createHttpClientStub({ fetch }) },
      dependencies: { matchingEnabled: async () => false, dispatchMatching: dispatch },
      runtime: { isDeviceAwake: async () => true, deviceSleepInhibitor: {
        acquire: async () => ({ release: async () => undefined }),
      } },
    });
    const first = await service.scrapeCompanies([company.id], "manual");
    // Queue timestamps have one-second precision; leave the overlap-reuse window.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const second = await service.scrapeCompanies([company.id], "manual");
    expect(first.results[0]).toMatchObject({ outcome: "success", jobsAdded: 1 });
    expect(second.results[0]).toMatchObject({ outcome: "success", jobsAdded: 0, jobsUpdated: 0 });
    expect(database.select().from(jobs).all()).toHaveLength(1);
    expect(dispatch).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
