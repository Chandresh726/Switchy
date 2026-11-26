import { describe, expect, it, vi } from "vitest";

import { companies, jobs, settings } from "@/lib/db/schema";
import { createLocalScrapeQueueService } from "@/lib/scraper";
import { createHttpClientStub } from "@test/helpers/scraper-clients";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

vi.mock("@/lib/db", () => ({ db: {} }));

const sqlite = createSqliteTestHarness("switchy-composition-");

describe("scraper composition", () => {
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
