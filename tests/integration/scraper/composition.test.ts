import { describe, expect, it, vi } from "vitest";

import { companies, jobs, scrapeQueueItems, settings } from "@/lib/db/schema";
import { createLocalScrapeQueueService } from "@/lib/scraper";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { createHttpClientStub } from "@test/helpers/scraper-clients";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

vi.mock("@/lib/db", () => ({ db: {} }));

const sqlite = createSqliteTestHarness("switchy-composition-");

describe("scraper composition", () => {
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
