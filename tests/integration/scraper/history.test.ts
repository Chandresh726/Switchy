import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  aiWorkItems,
  companies,
  matchSessions,
  scrapeMatchOutbox,
  scrapeQueueItems,
  scrapeSessions,
  scrapingLogs,
} from "@/lib/db/schema";

import {
  deleteScrapeHistory,
  DrizzleScrapeHistoryStore,
  pruneScrapeHistory,
} from "@/lib/scraper/history";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

vi.mock("@/lib/db", () => ({ db: {} }));

const sqlite = createSqliteTestHarness("switchy-scrape-history-");
const createTestDatabase = () => sqlite.createDatabase().database;

describe("deleteScrapeHistory", () => {
  it("rejects deletion of a specific active scrape session", () => {
    const database = createTestDatabase();
    database.insert(scrapeSessions).values({
      id: "active-session",
      triggerSource: "manual",
      status: "in_progress",
      companiesTotal: 1,
    }).run();

    const result = deleteScrapeHistory("active-session", database);

    expect(result).toEqual({ active: true, deleted: 0 });
    expect(database.select().from(scrapeSessions).all()).toHaveLength(1);
  });

  it("clears terminal history without deleting active leased work", () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "One", careersUrl: "https://example.com/one" })
      .returning({ id: companies.id })
      .get();
    database.insert(scrapeSessions).values([
      {
        id: "active-session",
        triggerSource: "manual",
        status: "in_progress",
        companiesTotal: 1,
      },
      {
        id: "completed-session",
        triggerSource: "manual",
        status: "completed",
        companiesTotal: 0,
        completedAt: new Date(),
      },
    ]).run();
    database.insert(scrapeQueueItems).values({
      id: "running-item",
      sessionId: "active-session",
      companyId: company.id,
      status: "running",
      workerId: "worker-1",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }).run();

    const result = deleteScrapeHistory(undefined, database);

    expect(result).toEqual({ active: false, deleted: 1 });
    expect(
      database
        .select()
        .from(scrapeSessions)
        .where(eq(scrapeSessions.id, "active-session"))
        .get()
    ).toBeDefined();
    expect(database.select().from(scrapeQueueItems).get()).toMatchObject({
      id: "running-item",
      status: "running",
    });
  });

  it("preserves a stopped session until its running item acknowledges cancellation", () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "One", careersUrl: "https://example.com/one" })
      .returning({ id: companies.id })
      .get();
    database.insert(scrapeSessions).values({
      id: "stopping-session",
      triggerSource: "manual",
      status: "failed",
      companiesTotal: 1,
      completedAt: new Date(),
    }).run();
    database.insert(scrapeQueueItems).values({
      id: "cancelling-item",
      sessionId: "stopping-session",
      companyId: company.id,
      status: "running",
      workerId: "worker-1",
      cancelRequested: true,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }).run();

    expect(deleteScrapeHistory("stopping-session", database)).toEqual({
      active: true,
      deleted: 0,
    });
    expect(deleteScrapeHistory(undefined, database)).toEqual({
      active: false,
      deleted: 0,
    });
    expect(database.select().from(scrapeSessions).get()).toBeDefined();
    expect(database.select().from(scrapeQueueItems).get()).toMatchObject({
      status: "running",
      cancelRequested: true,
    });
  });
});

describe("DrizzleScrapeHistoryStore", () => {
  it("owns detail, list, and status projections for the history API", () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({
        name: "History Co",
        careersUrl: "https://example.com/history",
        logoUrl: "https://example.com/logo.png",
        platform: "greenhouse",
      })
      .returning({ id: companies.id })
      .get();
    database.insert(scrapeSessions).values({
      id: "history-session",
      triggerSource: "company_refresh",
      status: "completed",
      companiesTotal: 1,
      companiesCompleted: 1,
      completedAt: new Date("2026-07-13T12:00:00.000Z"),
    }).run();
    database.insert(scrapeQueueItems).values({
      id: "history-item",
      sessionId: "history-session",
      companyId: company.id,
      status: "completed",
      attemptCount: 1,
      completedAt: new Date("2026-07-13T12:00:00.000Z"),
    }).run();
    database.insert(scrapingLogs).values({
      companyId: company.id,
      sessionId: "history-session",
      triggerSource: "company_refresh",
      status: "success",
      jobsFound: 3,
      jobsAdded: 2,
    }).run();
    const store = new DrizzleScrapeHistoryStore(database);

    expect(store.getDetail("history-session")).toMatchObject({
      session: { id: "history-session", triggerSource: "company_refresh" },
      logs: [{ companyName: "History Co", status: "success", jobsFound: 3 }],
      queueItems: [
        {
          id: "history-item",
          companyName: "History Co",
          companyLogoUrl: "https://example.com/logo.png",
          platform: "greenhouse",
        },
      ],
    });
    expect(store.getSessionStatus("history-session")).toEqual({
      id: "history-session",
      status: "completed",
    });
    expect(store.getSessionStatus("missing")).toBeNull();
    expect(store.list({ limit: 20, offset: 0 })).toMatchObject({
      sessions: [{ id: "history-session" }],
      pagination: { total: 1, limit: 20, offset: 0, hasMore: false },
      stats: { totalSessions: 1, successRate: 100 },
    });
  });

  it("paginates queue state and scrape logs as one company progress record", () => {
    const database = createTestDatabase();
    const companyRows = database
      .insert(companies)
      .values([
        { name: "Airbnb", careersUrl: "https://example.com/airbnb" },
        { name: "Bloomreach", careersUrl: "https://example.com/bloomreach" },
        { name: "Adyen", careersUrl: "https://example.com/adyen" },
      ])
      .returning({ id: companies.id, name: companies.name })
      .all();
    const companyIdByName = new Map(companyRows.map((company) => [company.name, company.id]));
    database.insert(scrapeSessions).values({
      id: "company-progress-session",
      triggerSource: "manual",
      status: "completed",
      companiesTotal: 3,
      companiesCompleted: 3,
      completedAt: new Date("2026-08-30T09:00:00.000Z"),
    }).run();
    database.insert(scrapeQueueItems).values([
      {
        id: "queue-airbnb",
        sessionId: "company-progress-session",
        companyId: companyIdByName.get("Airbnb")!,
        status: "completed",
      },
      {
        id: "queue-bloomreach",
        sessionId: "company-progress-session",
        companyId: companyIdByName.get("Bloomreach")!,
        status: "completed",
      },
      {
        id: "queue-adyen",
        sessionId: "company-progress-session",
        companyId: companyIdByName.get("Adyen")!,
        status: "completed",
      },
    ]).run();
    database.insert(scrapingLogs).values([
      {
        companyId: companyIdByName.get("Airbnb")!,
        sessionId: "company-progress-session",
        status: "success",
        jobsFound: 171,
        startedAt: new Date("2026-08-30T08:00:00.000Z"),
      },
      {
        companyId: companyIdByName.get("Bloomreach")!,
        sessionId: "company-progress-session",
        status: "success",
        jobsFound: 65,
        startedAt: new Date("2026-08-30T08:01:00.000Z"),
      },
      {
        companyId: companyIdByName.get("Adyen")!,
        sessionId: "company-progress-session",
        status: "success",
        jobsFound: 224,
        startedAt: new Date("2026-08-30T08:02:00.000Z"),
      },
    ]).run();
    const store = new DrizzleScrapeHistoryStore(database);

    expect(store.getDetail("company-progress-session", { limit: 1, offset: 0 }))
      .toMatchObject({
        queueItems: [{ companyName: "Adyen" }],
        logs: [{ companyName: "Adyen", jobsFound: 224 }],
        pagination: { total: 3, limit: 1, offset: 0, hasMore: true },
      });
    expect(store.getDetail("company-progress-session", { limit: 1, offset: 1 }))
      .toMatchObject({
        queueItems: [{ companyName: "Airbnb" }],
        logs: [{ companyName: "Airbnb", jobsFound: 171 }],
        pagination: { total: 3, limit: 1, offset: 1, hasMore: true },
      });
    expect(store.getDetail("company-progress-session", { limit: 1, offset: 2 }))
      .toMatchObject({
        queueItems: [{ companyName: "Bloomreach" }],
        logs: [{ companyName: "Bloomreach", jobsFound: 65 }],
        pagination: { total: 3, limit: 1, offset: 2, hasMore: false },
      });
  });

  it("aggregates portfolio-wide stats for the history list", () => {
    const database = createTestDatabase();
    const firstStart = new Date("2026-07-13T10:00:00.000Z");
    const lastStart = new Date("2026-07-13T11:00:00.000Z");
    database.insert(scrapeSessions).values([
      {
        id: "stats-completed",
        triggerSource: "manual",
        status: "completed",
        companiesTotal: 2,
        companiesCompleted: 2,
        totalJobsFound: 10,
        totalJobsAdded: 4,
        startedAt: firstStart,
        completedAt: new Date(firstStart.getTime() + 2_000),
      },
      {
        id: "stats-failed",
        triggerSource: "scheduler",
        status: "failed",
        companiesTotal: 1,
        companiesCompleted: 0,
        totalJobsFound: 0,
        totalJobsAdded: 0,
        startedAt: lastStart,
        completedAt: new Date(lastStart.getTime() + 4_000),
      },
    ]).run();

    expect(new DrizzleScrapeHistoryStore(database).list({ limit: 20, offset: 0 }).stats)
      .toEqual({
        totalSessions: 2,
        completedSessions: 1,
        failedSessions: 1,
        successRate: 50,
        avgDuration: 3_000,
        companiesScraped: 2,
        totalJobsFound: 10,
        totalJobsAdded: 4,
        lastRunAt: lastStart,
      });
  });

  it("resolves the match session each company log handed its jobs to", () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "Matched Co", careersUrl: "https://example.com/matched" })
      .returning({ id: companies.id })
      .get();
    database.insert(scrapeSessions).values({
      id: "match-link-session",
      triggerSource: "manual",
      status: "completed",
      companiesTotal: 2,
      companiesCompleted: 2,
      completedAt: new Date(),
    }).run();
    const durableLog = database.insert(scrapingLogs).values({
      companyId: company.id,
      sessionId: "match-link-session",
      triggerSource: "manual",
      status: "success",
      jobsAdded: 2,
    }).returning({ id: scrapingLogs.id }).get();
    const legacyLog = database.insert(scrapingLogs).values({
      companyId: company.id,
      sessionId: "match-link-session",
      triggerSource: "manual",
      status: "success",
      jobsAdded: 1,
    }).returning({ id: scrapingLogs.id }).get();
    database.insert(matchSessions).values([
      { id: "durable-match-session", triggerSource: "company_refresh", status: "completed" },
      { id: "legacy-match-session", triggerSource: "company_refresh", status: "completed" },
    ]).run();
    database.insert(aiWorkItems).values({
      id: "durable-match-session",
      workType: "match_jobs",
      matchSessionId: "durable-match-session",
      scrapingLogId: durableLog.id,
      companyId: company.id,
      payloadJson: "{}",
      status: "completed",
    }).run();
    database.insert(scrapeMatchOutbox).values({
      id: "legacy-match-session",
      scrapingLogId: legacyLog.id,
      companyId: company.id,
      jobIdsJson: "[]",
      status: "completed",
    }).run();

    expect(new DrizzleScrapeHistoryStore(database).getDetail("match-link-session")?.logs)
      .toMatchObject([
        { id: durableLog.id, matchSessionId: "durable-match-session" },
        { id: legacyLog.id, matchSessionId: "legacy-match-session" },
      ]);
  });

  it("labels superseded retry logs and the final company attempt", () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "Retry Co", careersUrl: "https://example.com/retry" })
      .returning({ id: companies.id })
      .get();
    database.insert(scrapeSessions).values({
      id: "retry-session",
      triggerSource: "manual",
      status: "partial",
      companiesTotal: 1,
      companiesCompleted: 1,
      completedAt: new Date(),
    }).run();
    database.insert(scrapeQueueItems).values({
      id: "retry-item",
      sessionId: "retry-session",
      companyId: company.id,
      status: "completed",
      attemptCount: 2,
      completedAt: new Date(),
    }).run();
    database.insert(scrapingLogs).values([
      {
        companyId: company.id,
        sessionId: "retry-session",
        status: "error",
        errorMessage: "browser session failed",
      },
      {
        companyId: company.id,
        sessionId: "retry-session",
        status: "partial",
        errorMessage: "one detail request failed",
      },
    ]).run();

    expect(new DrizzleScrapeHistoryStore(database).getDetail("retry-session")?.logs)
      .toMatchObject([
        {
          attemptNumber: 1,
          attemptsTotal: 2,
          isFinalAttempt: false,
        },
        {
          attemptNumber: 2,
          attemptsTotal: 2,
          isFinalAttempt: true,
        },
      ]);

    expect(new DrizzleScrapeHistoryStore(database).getDetail(
      "retry-session",
      { limit: 1, offset: 1 }
    )).toMatchObject({
      logs: [],
      pagination: { total: 1, limit: 1, offset: 1, hasMore: false },
    });
  });

  it("does not invent a second log attempt after committed-result recovery", () => {
    const database = createTestDatabase();
    const company = database
      .insert(companies)
      .values({ name: "Recovered Co", careersUrl: "https://example.com/recovered" })
      .returning({ id: companies.id })
      .get();
    database.insert(scrapeSessions).values({
      id: "recovered-result-session",
      triggerSource: "scheduler_recovery",
      status: "completed",
      companiesTotal: 1,
      companiesCompleted: 1,
      completedAt: new Date(),
    }).run();
    database.insert(scrapeQueueItems).values({
      id: "recovered-result-item",
      sessionId: "recovered-result-session",
      companyId: company.id,
      status: "completed",
      attemptCount: 2,
      completedAt: new Date(),
    }).run();
    database.insert(scrapingLogs).values({
      companyId: company.id,
      sessionId: "recovered-result-session",
      status: "success",
      jobsFound: 1,
    }).run();

    expect(
      new DrizzleScrapeHistoryStore(database).getDetail(
        "recovered-result-session"
      )?.logs
    ).toMatchObject([
      {
        attemptNumber: 1,
        attemptsTotal: 1,
        isFinalAttempt: true,
      },
    ]);
  });
});

describe("pruneScrapeHistory", () => {
  it("deletes only history older than the bounded local retention window", () => {
    const database = createTestDatabase();
    const now = new Date("2026-07-13T00:00:00.000Z");
    const company = database
      .insert(companies)
      .values({ name: "One", careersUrl: "https://example.com/one" })
      .returning({ id: companies.id })
      .get();
    database.insert(scrapeSessions).values([
      {
        id: "old-session",
        triggerSource: "manual",
        status: "completed",
        companiesTotal: 0,
        completedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
      {
        id: "legacy-terminal-session",
        triggerSource: "manual",
        status: "failed",
        companiesTotal: 0,
        startedAt: new Date("2020-01-01T00:00:00.000Z"),
        completedAt: null,
      },
      {
        id: "recent-session",
        triggerSource: "manual",
        status: "completed",
        companiesTotal: 0,
        completedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
      {
        id: "active-session",
        triggerSource: "manual",
        status: "in_progress",
        companiesTotal: 0,
        completedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "stopping-session",
        triggerSource: "manual",
        status: "failed",
        companiesTotal: 1,
        completedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "matching-session",
        triggerSource: "manual",
        status: "completed",
        companiesTotal: 1,
        completedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]).run();
    database.insert(scrapeQueueItems).values({
      id: "stopping-item",
      sessionId: "stopping-session",
      companyId: company.id,
      status: "running",
      cancelRequested: true,
      workerId: "worker-1",
      leaseExpiresAt: new Date("2026-07-14T00:00:00.000Z"),
    }).run();
    const log = database
      .insert(scrapingLogs)
      .values({
        companyId: company.id,
        sessionId: "matching-session",
        status: "success",
      })
      .returning({ id: scrapingLogs.id })
      .get();
    database.insert(matchSessions).values({
      id: "pending-match",
      triggerSource: "auto_match",
      companyId: company.id,
      status: "queued",
      jobsTotal: 0,
    }).run();
    database.insert(scrapeMatchOutbox).values({
      id: "pending-match",
      scrapingLogId: log.id,
      companyId: company.id,
      jobIdsJson: "[]",
      status: "pending",
    }).run();

    const result = pruneScrapeHistory(90, database, now);

    expect(result).toEqual({
      deleted: 2,
      cutoff: new Date("2026-04-14T00:00:00.000Z"),
    });
    expect(database.select().from(scrapeSessions).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "recent-session" }),
        expect.objectContaining({ id: "active-session" }),
        expect.objectContaining({ id: "stopping-session" }),
        expect.objectContaining({ id: "matching-session" }),
      ])
    );
  });

  it("prunes large local histories in bounded SQLite parameter batches", () => {
    const database = createTestDatabase();
    database.insert(scrapeSessions).values(
      Array.from({ length: 250 }, (_, index) => ({
        id: `old-session-${index}`,
        triggerSource: "scheduler",
        status: "completed",
        companiesTotal: 0,
        completedAt: new Date("2020-01-01T00:00:00.000Z"),
      }))
    ).run();

    const result = pruneScrapeHistory(
      90,
      database,
      new Date("2026-07-13T00:00:00.000Z")
    );

    expect(result.deleted).toBe(250);
    expect(database.select().from(scrapeSessions).all()).toHaveLength(0);
  });
});
