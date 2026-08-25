import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  companies,
  scrapeQueueItems,
  scrapeSessions,
  scrapingLogs,
  settings,
} from "@/lib/db/schema";
import { HistoryRetentionService } from "@/lib/scraper/application/history-retention-service";
import type { ScrapeCompanyPipeline } from "@/lib/scraper/application/scrape-company-pipeline";
import { ScrapeSessionProjector } from "@/lib/scraper/application/scrape-session-projector";
import { ScrapeWorkHandler } from "@/lib/scraper/application/scrape-work-handler";
import { DrizzleScrapeHistoryStore } from "@/lib/scraper/history";
import { DrizzleScraperRepository } from "@/lib/scraper/infrastructure/repository";
import { DrizzleScrapeSessionProjectionStore } from "@/lib/scraper/queue/projection-store";
import type { LocalLeasedWorkRunnerConfig } from "@/lib/scraper/runtime/leased-work-runner";
import type { DeviceSleepInhibitor } from "@/lib/scraper/runtime/device-sleep-inhibitor";
import type { IScraperRegistry } from "@/lib/scraper/services";
import {
  type ScrapeSettingsProvider,
  StoredScrapeSettingsProvider,
} from "@/lib/scraper/settings/provider";

import { DrizzleLocalScrapeQueueRepository } from "@/lib/scraper/queue/repository";
import { LocalScrapeQueueService } from "@/lib/scraper/queue/service";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ai/matcher", () => ({ matchWithTracking: vi.fn() }));

const sqlite = createSqliteTestHarness("switchy-queue-service-");
const createTestDatabase = () => sqlite.createDatabase().database;

function createPipeline() {
  const scrapeCompany = vi.fn<ScrapeCompanyPipeline["scrape"]>(
    async (companyId) => ({
      companyId,
      companyName: `Company ${companyId}`,
      success: true,
      outcome: "success",
      jobsFound: companyId * 2,
      jobsAdded: companyId,
      jobsUpdated: 0,
      jobsFiltered: 0,
      jobsArchived: 0,
      platform: "greenhouse",
      duration: 10,
    })
  );
  const pipeline: Pick<ScrapeCompanyPipeline, "scrape"> = { scrape: scrapeCompany };
  return { pipeline, scrapeCompany };
}

interface TestServiceOptions {
  pipeline?: Pick<ScrapeCompanyPipeline, "scrape">;
  queueRepository?: DrizzleLocalScrapeQueueRepository;
  registry?: IScraperRegistry;
  runnerConfig?: Partial<LocalLeasedWorkRunnerConfig>;
  deviceSleepInhibitor?: DeviceSleepInhibitor;
  settingsProvider?: ScrapeSettingsProvider;
}

function createService(
  database: ReturnType<typeof createTestDatabase>,
  options: TestServiceOptions = {}
) {
  const scraperRepository = new DrizzleScraperRepository(database);
  const queueRepository =
    options.queueRepository ?? new DrizzleLocalScrapeQueueRepository(database);
  const defaults = createPipeline();
  const pipeline = options.pipeline ?? defaults.pipeline;
  const projectionStore = new DrizzleScrapeSessionProjectionStore(database);
  const projector = new ScrapeSessionProjector(
    queueRepository,
    projectionStore,
    scraperRepository,
    scraperRepository
  );
  const settingsProvider =
    options.settingsProvider ??
    new StoredScrapeSettingsProvider(scraperRepository);
  const workHandler = new ScrapeWorkHandler(
    pipeline,
    scraperRepository,
    queueRepository,
    projectionStore,
    projector,
    settingsProvider,
    options.registry
  );
  const deviceSleepInhibitor =
    options.deviceSleepInhibitor ??
    ({
      acquire: vi.fn(async () => ({ release: vi.fn(async () => undefined) })),
    } satisfies DeviceSleepInhibitor);
  const service = new LocalScrapeQueueService({
    companyCatalog: scraperRepository,
    sessionStore: scraperRepository,
    queueStore: queueRepository,
    workHandler,
    projector,
    historyRetention: new HistoryRetentionService(
      new DrizzleScrapeHistoryStore(database),
      settingsProvider
    ),
    settingsProvider,
    deviceSleepInhibitor,
    runnerConfig: {
      concurrency: 2,
      baseRetryDelayMs: 0,
      maxRetryDelayMs: 0,
      ...options.runnerConfig,
    },
  });
  return { queueRepository, scrapeCompany: defaults.scrapeCompany, service };
}

describe("LocalScrapeQueueService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("holds an idle-sleep inhibitor only for an enabled dispatch", async () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "One", careersUrl: "https://example.com/one" })
      .returning({ id: companies.id })
      .get();
    const release = vi.fn(async () => undefined);
    const acquire = vi.fn(async () => ({ release }));
    const { service } = createService(database, {
      deviceSleepInhibitor: { acquire },
    });

    await service.scrapeCompanies([company.id], "manual");

    expect(acquire).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("does not inhibit sleep when the stored setting is disabled", async () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "One", careersUrl: "https://example.com/one" })
      .returning({ id: companies.id })
      .get();
    database
      .insert(settings)
      .values({ key: "scraper_keep_device_awake", value: "false" })
      .run();
    const acquire = vi.fn();
    const { service } = createService(database, {
      deviceSleepInhibitor: { acquire },
    });

    await service.scrapeCompanies([company.id], "manual");

    expect(acquire).not.toHaveBeenCalled();
  });

  it("keeps scrape dispatch non-fatal when sleep inhibition fails", async () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "One", careersUrl: "https://example.com/one" })
      .returning({ id: companies.id })
      .get();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { service } = createService(database, {
      deviceSleepInhibitor: {
        acquire: vi.fn(async () => {
          throw new Error("caffeinate unavailable");
        }),
      },
    });

    const result = await service.scrapeCompanies([company.id], "manual");

    expect(result.summary.successfulCompanies).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(
      "[LocalScrapeQueueService] Failed to inhibit idle sleep:",
      expect.any(Error)
    );
  });

  it("keeps scrape dispatch non-fatal when the keep-awake setting lookup fails", async () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "One", careersUrl: "https://example.com/one" })
      .returning({ id: companies.id })
      .get();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const storedSettingsProvider = new StoredScrapeSettingsProvider(
      new DrizzleScraperRepository(database)
    );
    const settingsProvider: ScrapeSettingsProvider = {
      getFilters: (defaults) => storedSettingsProvider.getFilters(defaults),
      getMaxParallelScrapes: () =>
        storedSettingsProvider.getMaxParallelScrapes(),
      getKeepDeviceAwake: vi.fn(async () => {
        throw new Error("settings unavailable");
      }),
      getHistoryRetentionDays: () =>
        storedSettingsProvider.getHistoryRetentionDays(),
    };
    const acquire = vi.fn();
    const { service } = createService(database, {
      settingsProvider,
      deviceSleepInhibitor: { acquire },
    });

    const result = await service.scrapeCompanies([company.id], "manual");

    expect(result.summary.successfulCompanies).toBe(1);
    expect(acquire).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      "[LocalScrapeQueueService] Failed to inhibit idle sleep:",
      expect.any(Error)
    );
  });

  it("preserves the completed batch contract while executing through durable queue items", async () => {
    const database = createTestDatabase();
    const storedCompanies = database
      .insert(companies)
      .values([
        { name: "One", careersUrl: "https://example.com/one" },
        { name: "Two", careersUrl: "https://example.com/two" },
      ])
      .returning({ id: companies.id })
      .all();
    const { scrapeCompany, service } = createService(database);

    const result = await service.scrapeCompanies(
      storedCompanies.map((company) => company.id),
      "manual"
    );

    expect(result.summary).toMatchObject({
      totalCompanies: 2,
      successfulCompanies: 2,
      failedCompanies: 0,
      totalJobsFound: 6,
      totalJobsAdded: 3,
    });
    expect(scrapeCompany).toHaveBeenCalledTimes(2);
    expect(scrapeCompany).toHaveBeenCalledWith(
      storedCompanies[0]?.id,
      expect.objectContaining({
        sessionId: result.sessionId,
        triggerSource: "manual",
        signal: expect.any(AbortSignal),
      })
    );
    expect(
      database
        .select()
        .from(scrapeQueueItems)
        .where(eq(scrapeQueueItems.sessionId, result.sessionId))
        .all()
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "completed", attemptCount: 1 }),
        expect.objectContaining({ status: "completed", attemptCount: 1 }),
      ])
    );
    expect(
      database
        .select()
        .from(scrapeSessions)
        .where(eq(scrapeSessions.id, result.sessionId))
        .get()
    ).toMatchObject({
      status: "completed",
      companiesTotal: 2,
      companiesCompleted: 2,
      totalJobsFound: 6,
      totalJobsAdded: 3,
    });
  });

  it("coalesces identical in-flight batches across trigger sources", async () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "One", careersUrl: "https://example.com/one" })
      .returning({ id: companies.id })
      .get();
    let releaseScrape!: () => void;
    const waitForRelease = new Promise<void>((resolve) => {
      releaseScrape = resolve;
    });
    const scrapeCompany = vi.fn<ScrapeCompanyPipeline["scrape"]>(
      async (companyId) => {
        await waitForRelease;
        return {
          companyId,
          companyName: "One",
          success: true,
          outcome: "success",
          jobsFound: 1,
          jobsAdded: 0,
          jobsUpdated: 0,
          jobsFiltered: 0,
          jobsArchived: 0,
          platform: "greenhouse",
          duration: 1,
        };
      }
    );
    const { service } = createService(database, {
      pipeline: { scrape: scrapeCompany },
    });

    const first = service.scrapeCompanies([company.id], "manual");
    const second = service.scrapeCompanies([company.id], "scheduler");
    releaseScrape();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.sessionId).toBe(secondResult.sessionId);
    expect(scrapeCompany).toHaveBeenCalledTimes(1);
    expect(database.select().from(scrapeSessions).all()).toHaveLength(1);
    expect(database.select().from(scrapeSessions).get()).toMatchObject({
      triggerSource: "manual",
    });
  });

  it("completes an empty durable session without leaving active history", async () => {
    const database = createTestDatabase();
    const { service } = createService(database);

    const result = await service.scrapeCompanies([999], "manual");

    expect(result.summary).toMatchObject({
      totalCompanies: 0,
      successfulCompanies: 0,
      failedCompanies: 0,
    });
    expect(
      database
        .select()
        .from(scrapeSessions)
        .where(eq(scrapeSessions.id, result.sessionId))
        .get()
    ).toMatchObject({ status: "completed", companiesTotal: 0 });
  });

  it("treats malformed durable result JSON as a failed company without crashing recovery", async () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "One", careersUrl: "https://example.com/one" })
      .returning({ id: companies.id })
      .get();
    const { queueRepository, service } = createService(database);
    await queueRepository.createSessionAndEnqueue({
      sessionId: "malformed-result",
      triggerSource: "scheduler_recovery",
      companyIds: [company.id],
    });
    database
      .update(scrapeQueueItems)
      .set({
        status: "completed",
        resultJson: "{not-json",
        lastError: "result payload was corrupted",
        completedAt: new Date(),
      })
      .run();

    await service.recoverPending();

    expect(database.select().from(scrapeSessions).get()).toMatchObject({
      status: "failed",
      companiesCompleted: 1,
      totalJobsFound: 0,
      totalJobsAdded: 0,
    });
  });

  it("reconstructs mixed durable results into the authoritative session summary", async () => {
    const database = createTestDatabase();
    const storedCompanies = database
      .insert(companies)
      .values([
        { name: "One", careersUrl: "https://example.com/one" },
        { name: "Two", careersUrl: "https://example.com/two" },
      ])
      .returning({ id: companies.id })
      .all();
    const { queueRepository, service } = createService(database);
    await queueRepository.createSessionAndEnqueue({
      sessionId: "mixed-results",
      triggerSource: "scheduler",
      companyIds: storedCompanies.map((company) => company.id),
    });
    const items = await queueRepository.listSessionItems("mixed-results");
    const completedAt = new Date();
    const serializedResults = [
      {
        companyId: storedCompanies[0]!.id,
        companyName: "One",
        success: true,
        outcome: "success",
        jobsFound: 8,
        jobsAdded: 3,
        jobsUpdated: 1,
        jobsFiltered: 2,
        jobsArchived: 4,
        platform: "greenhouse",
        duration: 20,
      },
      {
        companyId: storedCompanies[1]!.id,
        companyName: "Two",
        success: false,
        outcome: "error",
        jobsFound: 0,
        jobsAdded: 0,
        jobsUpdated: 0,
        jobsFiltered: 0,
        jobsArchived: 0,
        platform: "lever",
        error: "blocked",
        duration: 10,
      },
    ];
    const resultsByCompanyId = new Map(
      serializedResults.map((result) => [result.companyId, result])
    );
    for (const item of items) {
      database
        .update(scrapeQueueItems)
        .set({
          status: "completed",
          resultJson: JSON.stringify(resultsByCompanyId.get(item.companyId)),
          completedAt,
        })
        .where(eq(scrapeQueueItems.id, item.id))
        .run();
    }

    await service.recoverPending();

    expect(database.select().from(scrapeSessions).get()).toMatchObject({
      status: "partial",
      companiesCompleted: 2,
      totalJobsFound: 8,
      totalJobsAdded: 3,
      totalJobsFiltered: 2,
      totalJobsArchived: 4,
    });
  });

  it("prunes expired terminal history during normal local queue supervision", async () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "One", careersUrl: "https://example.com/one" })
      .returning({ id: companies.id })
      .get();
    database.insert(scrapeSessions).values({
      id: "expired-history",
      triggerSource: "manual",
      status: "completed",
      companiesTotal: 0,
      completedAt: new Date("2020-01-01T00:00:00.000Z"),
    }).run();
    const { service } = createService(database);

    await service.scrapeCompanies([company.id], "manual");

    expect(
      database
        .select()
        .from(scrapeSessions)
        .where(eq(scrapeSessions.id, "expired-history"))
        .get()
    ).toBeUndefined();
  });

  it("recovers committed queue work after a process restart", async () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "One", careersUrl: "https://example.com/one" })
      .returning({ id: companies.id })
      .get();
    const { queueRepository, scrapeCompany, service } = createService(database);
    await queueRepository.createSessionAndEnqueue({
      sessionId: "recover-session",
      triggerSource: "scheduler_recovery",
      companyIds: [company.id],
    });

    const summary = await service.recoverPending();

    expect(summary).toMatchObject({ claimed: 1, completed: 1 });
    expect(scrapeCompany).toHaveBeenCalledWith(
      company.id,
      expect.objectContaining({
        sessionId: "recover-session",
        triggerSource: "scheduler_recovery",
      })
    );
    expect(
      database
        .select()
        .from(scrapeSessions)
        .where(eq(scrapeSessions.id, "recover-session"))
        .get()
    ).toMatchObject({ status: "completed", companiesCompleted: 1 });
  });

  it("completes recovered work from its committed scrape log without scraping again", async () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "One", careersUrl: "https://example.com/one" })
      .returning({ id: companies.id })
      .get();
    const { queueRepository, scrapeCompany, service } = createService(database);
    await queueRepository.createSessionAndEnqueue({
      sessionId: "committed-session",
      triggerSource: "manual",
      companyIds: [company.id],
    });
    database.insert(scrapingLogs).values({
      companyId: company.id,
      sessionId: "committed-session",
      triggerSource: "manual",
      platform: "greenhouse",
      status: "success",
      jobsFound: 8,
      jobsAdded: 5,
      jobsUpdated: 1,
      jobsFiltered: 2,
      jobsArchived: 3,
      duration: 250,
      completedAt: new Date(),
    }).run();
    database.update(scrapeQueueItems).set({
      status: "running",
      attemptCount: 3,
      maxAttempts: 3,
      workerId: "dead-worker",
      leaseExpiresAt: new Date(0),
    }).run();

    const summary = await service.recoverPending();

    expect(summary).toMatchObject({ claimed: 0, completed: 0 });
    expect(scrapeCompany).not.toHaveBeenCalled();
    expect(database.select().from(scrapeQueueItems).get()).toMatchObject({
      status: "completed",
      resultJson: expect.stringContaining('"jobsAdded":5'),
    });
    expect(database.select().from(scrapeSessions).get()).toMatchObject({
      status: "completed",
      companiesCompleted: 1,
      totalJobsFound: 8,
      totalJobsAdded: 5,
      totalJobsFiltered: 2,
      totalJobsArchived: 3,
    });
  });

  it("retries retryable scraper results and preserves the successful attempt", async () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "One", careersUrl: "https://example.com/one" })
      .returning({ id: companies.id })
      .get();
    const scrapeCompany = vi.fn<ScrapeCompanyPipeline["scrape"]>()
      .mockResolvedValueOnce({
        companyId: company.id,
        companyName: "One",
        success: false,
        outcome: "error",
        jobsFound: 0,
        jobsAdded: 0,
        jobsUpdated: 0,
        jobsFiltered: 0,
        jobsArchived: 0,
        platform: "greenhouse",
        error: "Rate limited",
        retryable: true,
        retryAfterMs: 10,
        duration: 10,
      })
      .mockResolvedValueOnce({
        companyId: company.id,
        companyName: "One",
        success: true,
        outcome: "success",
        jobsFound: 4,
        jobsAdded: 2,
        jobsUpdated: 0,
        jobsFiltered: 0,
        jobsArchived: 0,
        platform: "greenhouse",
        duration: 10,
      });
    const { service } = createService(database, {
      pipeline: { scrape: scrapeCompany },
      runnerConfig: {
        concurrency: 1,
        baseRetryDelayMs: 10,
        maxRetryDelayMs: 10,
      },
    });

    const result = await service.scrapeCompanies([company.id], "manual");

    expect(scrapeCompany).toHaveBeenCalledTimes(2);
    expect(result.summary).toMatchObject({
      successfulCompanies: 1,
      failedCompanies: 0,
      totalJobsFound: 4,
      totalJobsAdded: 2,
    });
    expect(database.select().from(scrapeQueueItems).get()).toMatchObject({
      status: "completed",
      attemptCount: 2,
    });
  });

  it("atomically cancels queued work and stops its scrape session", async () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "One", careersUrl: "https://example.com/one" })
      .returning({ id: companies.id })
      .get();
    const { queueRepository, service } = createService(database);
    await queueRepository.createSessionAndEnqueue({
      sessionId: "cancel-session",
      triggerSource: "manual",
      companyIds: [company.id],
    });

    const cancellation = await service.cancelSession("cancel-session");

    expect(cancellation).toEqual({
      cancelledQueued: 1,
      signalledRunning: 0,
      sessionStopped: true,
    });
    expect(
      database
        .select()
        .from(scrapeSessions)
        .where(eq(scrapeSessions.id, "cancel-session"))
        .get()
    ).toMatchObject({ status: "failed" });
    expect(
      database
        .select()
        .from(scrapeQueueItems)
        .where(eq(scrapeQueueItems.sessionId, "cancel-session"))
        .get()
    ).toMatchObject({ status: "cancelled", cancelRequested: true });
  });

  it("falls back to stopping an in-progress session without queue items", async () => {
    const database = createTestDatabase();
    database.insert(scrapeSessions).values({
      id: "legacy-session",
      triggerSource: "manual",
      status: "in_progress",
      companiesTotal: 1,
    }).run();
    const { service } = createService(database);

    const cancellation = await service.cancelSession("legacy-session");

    expect(cancellation).toMatchObject({
      cancelledQueued: 0,
      signalledRunning: 0,
      sessionStopped: true,
    });
    expect(database.select().from(scrapeSessions).get()).toMatchObject({
      status: "failed",
    });
  });

  it("honors the configured local parallelism limit", async () => {
    const database = createTestDatabase();
    const storedCompanies = database
      .insert(companies)
      .values([
        { name: "One", careersUrl: "https://example.com/one" },
        { name: "Two", careersUrl: "https://example.com/two" },
        { name: "Three", careersUrl: "https://example.com/three" },
      ])
      .returning({ id: companies.id })
      .all();
    database.insert(settings).values({
      key: "scraper_max_parallel_scrapes",
      value: "1",
    }).run();
    let active = 0;
    let maxActive = 0;
    const scrapeCompany = vi.fn<ScrapeCompanyPipeline["scrape"]>(
      async (companyId) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return {
          companyId,
          companyName: `Company ${companyId}`,
          success: true,
          outcome: "success",
          jobsFound: 0,
          jobsAdded: 0,
          jobsUpdated: 0,
          jobsFiltered: 0,
          jobsArchived: 0,
          platform: "greenhouse",
          duration: 5,
        };
      }
    );
    const { service } = createService(database, {
      pipeline: { scrape: scrapeCompany },
      runnerConfig: { concurrency: 3 },
    });

    await service.scrapeCompanies(
      storedCompanies.map((company) => company.id),
      "manual"
    );

    expect(maxActive).toBe(1);
  });

  it("bounds browser-heavy scrapers without blocking API scraper overlap", async () => {
    const database = createTestDatabase();
    const storedCompanies = database
      .insert(companies)
      .values([
        {
          name: "API One",
          careersUrl: "https://boards.greenhouse.io/one",
          platform: "greenhouse",
        },
        {
          name: "Serial",
          careersUrl: "https://example.myworkdayjobs.com/jobs",
          platform: "workday",
        },
        {
          name: "API Two",
          careersUrl: "https://boards.greenhouse.io/two",
          platform: "greenhouse",
        },
      ])
      .returning({ id: companies.id })
      .all();
    let serialActive = false;
    let overlapDetected = false;
    const serialCompanyId = storedCompanies[1]?.id;
    const scrapeCompany = vi.fn<ScrapeCompanyPipeline["scrape"]>(
      async (companyId) => {
        if (companyId === serialCompanyId) {
          serialActive = true;
        } else {
          if (serialActive) overlapDetected = true;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (companyId === serialCompanyId) serialActive = false;
        return {
          companyId,
          companyName: `Company ${companyId}`,
          success: true,
          outcome: "success",
          jobsFound: 0,
          jobsAdded: 0,
          jobsUpdated: 0,
          jobsFiltered: 0,
          jobsArchived: 0,
          platform: companyId === serialCompanyId ? "workday" : "greenhouse",
          duration: 5,
        };
      }
    );
    const registry = {
      getScraperByPlatform: vi.fn((platform: string) => ({
        capabilities: {
          concurrency:
            platform === "workday" ? "browser_limited" : "parallel",
        },
      })),
    } as unknown as IScraperRegistry;
    const { service } = createService(database, {
      pipeline: { scrape: scrapeCompany },
      registry,
      runnerConfig: { concurrency: 3 },
    });

    await service.scrapeCompanies(
      storedCompanies.map((company) => company.id),
      "manual"
    );

    expect(overlapDetected).toBe(true);
  });

  it("uses the static longest-platform-first queue priority", async () => {
    const database = createTestDatabase();
    const storedCompanies = database
      .insert(companies)
      .values([
        {
          name: "Fast API",
          careersUrl: "https://boards.greenhouse.io/fast",
          platform: "greenhouse",
        },
        {
          name: "Workday",
          careersUrl: "https://example.myworkdayjobs.com/jobs",
          platform: "workday",
        },
        {
          name: "Eightfold",
          careersUrl: "https://example.eightfold.ai/careers",
          platform: "eightfold",
        },
      ])
      .returning({ id: companies.id, platform: companies.platform })
      .all();
    const executionOrder: number[] = [];
    const pipeline = {
      scrape: vi.fn<ScrapeCompanyPipeline["scrape"]>(async (companyId) => {
        executionOrder.push(companyId);
        const company = storedCompanies.find((item) => item.id === companyId);
        return {
          companyId,
          companyName: `Company ${companyId}`,
          success: true,
          outcome: "success",
          jobsFound: 0,
          jobsAdded: 0,
          jobsUpdated: 0,
          jobsFiltered: 0,
          jobsArchived: 0,
          platform:
            company?.platform === "eightfold" || company?.platform === "workday"
              ? company.platform
              : "greenhouse",
          duration: 1,
        };
      }),
    };
    const { service } = createService(database, {
      pipeline,
      runnerConfig: { concurrency: 1 },
    });

    await service.scrapeAllCompanies("manual");

    expect(
      executionOrder.map(
        (companyId) =>
          storedCompanies.find((company) => company.id === companyId)?.platform
      )
    ).toEqual(["eightfold", "workday", "greenhouse"]);
  });

  it("never scrapes the same company concurrently across different sessions", async () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "One", careersUrl: "https://example.com/one" })
      .returning({ id: companies.id })
      .get();
    const queueRepository = new DrizzleLocalScrapeQueueRepository(database);
    await queueRepository.createSessionAndEnqueue({
      sessionId: "overlap-one",
      triggerSource: "manual",
      companyIds: [company.id],
    });
    await queueRepository.createSessionAndEnqueue({
      sessionId: "overlap-two",
      triggerSource: "scheduler",
      companyIds: [company.id],
    });
    let active = 0;
    let maxActive = 0;
    const scrapeCompany = vi.fn<ScrapeCompanyPipeline["scrape"]>(
      async (companyId) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return {
          companyId,
          companyName: "One",
          success: true,
          outcome: "success",
          jobsFound: 0,
          jobsAdded: 0,
          jobsUpdated: 0,
          jobsFiltered: 0,
          jobsArchived: 0,
          platform: "greenhouse",
          duration: 10,
        };
      }
    );
    const { service } = createService(database, {
      pipeline: { scrape: scrapeCompany },
      queueRepository,
      runnerConfig: { concurrency: 2 },
    });

    await service.recoverPending();

    expect(scrapeCompany).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });
});
