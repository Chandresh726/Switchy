import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  companies,
  scrapeQueueItems,
  scrapeSessions,
  scrapingLogs,
  settings,
} from "@/lib/db/schema";
import { DrizzleScraperRepository } from "@/lib/scraper/infrastructure/repository";
import type { IScrapeOrchestrator, IScraperRegistry } from "@/lib/scraper/services";

import { DrizzleLocalScrapeQueueRepository } from "@/lib/scraper/queue/repository";
import { LocalScrapeQueueService } from "@/lib/scraper/queue/service";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ai/matcher", () => ({ matchWithTracking: vi.fn() }));

const sqlite = createSqliteTestHarness("switchy-queue-service-");
const createTestDatabase = () => sqlite.createDatabase().database;

function createOrchestrator() {
  const scrapeCompany = vi.fn<IScrapeOrchestrator["scrapeCompany"]>(
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
  const orchestrator: IScrapeOrchestrator = {
    scrapeCompany,
    scrapeCompanies: vi.fn(),
    scrapeAllCompanies: vi.fn(),
  };
  return { orchestrator, scrapeCompany };
}

function createService(database: ReturnType<typeof createTestDatabase>) {
  const scraperRepository = new DrizzleScraperRepository(database);
  const queueRepository = new DrizzleLocalScrapeQueueRepository(database);
  const { orchestrator, scrapeCompany } = createOrchestrator();
  const service = new LocalScrapeQueueService({
    database,
    orchestrator,
    scraperRepository,
    queueRepository,
    runnerConfig: { concurrency: 2, baseRetryDelayMs: 0, maxRetryDelayMs: 0 },
  });
  return { queueRepository, scrapeCompany, service };
}

describe("LocalScrapeQueueService", () => {
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
    for (const [index, item] of items.entries()) {
      database
        .update(scrapeQueueItems)
        .set({
          status: "completed",
          resultJson: JSON.stringify(serializedResults[index]),
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
    const scraperRepository = new DrizzleScraperRepository(database);
    const queueRepository = new DrizzleLocalScrapeQueueRepository(database);
    const scrapeCompany = vi.fn<IScrapeOrchestrator["scrapeCompany"]>()
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
        retryAfterMs: 0,
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
    const service = new LocalScrapeQueueService({
      database,
      orchestrator: {
        scrapeCompany,
        scrapeCompanies: vi.fn(),
        scrapeAllCompanies: vi.fn(),
      },
      scraperRepository,
      queueRepository,
      runnerConfig: { concurrency: 1, baseRetryDelayMs: 0, maxRetryDelayMs: 0 },
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
    const scrapeCompany = vi.fn<IScrapeOrchestrator["scrapeCompany"]>(
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
    const service = new LocalScrapeQueueService({
      database,
      orchestrator: {
        scrapeCompany,
        scrapeCompanies: vi.fn(),
        scrapeAllCompanies: vi.fn(),
      },
      scraperRepository: new DrizzleScraperRepository(database),
      queueRepository: new DrizzleLocalScrapeQueueRepository(database),
      runnerConfig: { concurrency: 3 },
    });

    await service.scrapeCompanies(
      storedCompanies.map((company) => company.id),
      "manual"
    );

    expect(maxActive).toBe(1);
  });

  it("runs serial scraper capabilities exclusively without sacrificing shared concurrency", async () => {
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
    let activeShared = 0;
    let serialActive = false;
    let overlapDetected = false;
    const serialCompanyId = storedCompanies[1]?.id;
    const scrapeCompany = vi.fn<IScrapeOrchestrator["scrapeCompany"]>(
      async (companyId) => {
        if (companyId === serialCompanyId) {
          if (activeShared > 0) overlapDetected = true;
          serialActive = true;
        } else {
          if (serialActive) overlapDetected = true;
          activeShared += 1;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (companyId === serialCompanyId) serialActive = false;
        else activeShared -= 1;
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
          concurrency: platform === "workday" ? "serial" : "parallel",
        },
      })),
    } as unknown as IScraperRegistry;
    const service = new LocalScrapeQueueService({
      database,
      orchestrator: {
        scrapeCompany,
        scrapeCompanies: vi.fn(),
        scrapeAllCompanies: vi.fn(),
      },
      scraperRepository: new DrizzleScraperRepository(database),
      queueRepository: new DrizzleLocalScrapeQueueRepository(database),
      registry,
      runnerConfig: { concurrency: 3 },
    });

    await service.scrapeCompanies(
      storedCompanies.map((company) => company.id),
      "manual"
    );

    expect(overlapDetected).toBe(false);
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
    const scrapeCompany = vi.fn<IScrapeOrchestrator["scrapeCompany"]>(
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
    const service = new LocalScrapeQueueService({
      database,
      orchestrator: {
        scrapeCompany,
        scrapeCompanies: vi.fn(),
        scrapeAllCompanies: vi.fn(),
      },
      scraperRepository: new DrizzleScraperRepository(database),
      queueRepository,
      runnerConfig: { concurrency: 2 },
    });

    await service.recoverPending();

    expect(scrapeCompany).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });
});
