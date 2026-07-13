import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import {
  companies,
  jobs,
  matchLogs,
  matchSessions,
  scrapeMatchOutbox,
  scrapeSessions,
  scrapingLogs,
} from "@/lib/db/schema";
import { DrizzleScraperRepository } from "@/lib/scraper/infrastructure/repository";

import {
  deleteAllJobsAndTerminateMatches,
  stopMatchSession,
} from "./lifecycle";
import { ScrapeMatchOutboxDispatcher } from "./outbox";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ai/matcher", () => ({ matchWithTracking: vi.fn() }));

const openConnections: Database.Database[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const connection of openConnections.splice(0)) connection.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createTestDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "switchy-match-outbox-"));
  temporaryDirectories.push(directory);
  const connection = new Database(join(directory, "switchy.db"));
  openConnections.push(connection);
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  connection.pragma("busy_timeout = 1000");
  const database = drizzle(connection, { schema });
  migrate(database, { migrationsFolder: join(process.cwd(), "drizzle") });
  return database;
}

function seedCompanyAndSession(database: ReturnType<typeof createTestDatabase>) {
  const company = database
    .insert(companies)
    .values({ name: "Acme", careersUrl: "https://example.com/jobs" })
    .returning({ id: companies.id })
    .get();
  database.insert(scrapeSessions).values({
    id: "session-1",
    triggerSource: "manual",
    companiesTotal: 1,
  }).run();
  return company;
}

async function persistMatchableJob(
  database: ReturnType<typeof createTestDatabase>,
  companyId: number
) {
  const repository = new DrizzleScraperRepository(database);
  return repository.persistScrapeResult({
    companyId,
    openExternalIds: ["role-1"],
    archiveMissing: true,
    statusesToArchive: ["new"],
    jobsToInsert: [
      {
        externalId: "role-1",
        title: "Role 1",
        url: "https://example.com/jobs/1",
        description: "Detailed role description",
        status: "new",
      },
    ],
    existingJobUpdates: [],
    startedAtMs: Date.now(),
    enableMatching: true,
    log: {
      sessionId: "session-1",
      triggerSource: "manual",
      platform: "greenhouse",
      status: "success",
      jobsFound: 1,
      jobsFiltered: 0,
    },
  });
}

describe("ScrapeMatchOutboxDispatcher", () => {
  it("resumes a durable matching handoff after a crash following scrape commit", async () => {
    const database = createTestDatabase();
    const company = seedCompanyAndSession(database);
    const repository = new DrizzleScraperRepository(database);
    const persisted = await repository.persistScrapeResult({
      companyId: company.id,
      openExternalIds: ["role-1"],
      archiveMissing: true,
      statusesToArchive: ["new"],
      jobsToInsert: [
        {
          externalId: "role-1",
          title: "Role 1",
          url: "https://example.com/jobs/1",
          description: "Detailed role description",
          status: "new",
        },
      ],
      existingJobUpdates: [],
      startedAtMs: Date.now(),
      enableMatching: true,
      log: {
        sessionId: "session-1",
        triggerSource: "manual",
        platform: "greenhouse",
        status: "success",
        jobsFound: 1,
        jobsFiltered: 0,
      },
    });
    const executeMatch = vi.fn(async (jobIds: number[]) => ({
      sessionId: persisted.matchOutboxId ?? "",
      total: jobIds.length,
      succeeded: jobIds.length,
      failed: 0,
    }));
    expect(database.select().from(matchSessions).get()).toMatchObject({
      id: persisted.matchOutboxId,
      status: "queued",
      jobsTotal: 1,
    });

    // A newly constructed dispatcher represents the process restarting after commit.
    const dispatcher = new ScrapeMatchOutboxDispatcher(database, executeMatch);
    const summary = await dispatcher.runAvailable();

    expect(executeMatch).toHaveBeenCalledWith(
      persisted.matchableJobIds,
      expect.objectContaining({
        triggerSource: "auto_match",
        companyId: company.id,
        sessionId: persisted.matchOutboxId,
      })
    );
    expect(summary).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(database.select().from(scrapeMatchOutbox).get()).toMatchObject({
      id: persisted.matchOutboxId,
      status: "completed",
      workerId: null,
      leaseExpiresAt: null,
    });
    expect(database.select().from(scrapingLogs).get()).toMatchObject({
      matcherStatus: "completed",
      matcherJobsCompleted: 1,
      matcherErrorCount: 0,
    });
  });

  it("does not repeat paid matching after a crash between match completion and outbox completion", async () => {
    const database = createTestDatabase();
    const company = seedCompanyAndSession(database);
    const repository = new DrizzleScraperRepository(database);
    const persisted = await repository.persistScrapeResult({
      companyId: company.id,
      openExternalIds: ["role-1"],
      archiveMissing: true,
      statusesToArchive: ["new"],
      jobsToInsert: [
        {
          externalId: "role-1",
          title: "Role 1",
          url: "https://example.com/jobs/1",
          description: "Detailed role description",
          status: "new",
        },
      ],
      existingJobUpdates: [],
      startedAtMs: Date.now(),
      enableMatching: true,
      log: {
        sessionId: "session-1",
        triggerSource: "manual",
        platform: "greenhouse",
        status: "success",
        jobsFound: 1,
        jobsFiltered: 0,
      },
    });
    if (!persisted.matchOutboxId) throw new Error("Expected a durable match handoff.");
    database
      .update(matchSessions)
      .set({
        status: "completed",
        jobsCompleted: 1,
        jobsSucceeded: 1,
        jobsFailed: 0,
        completedAt: new Date(),
      })
      .where(eq(matchSessions.id, persisted.matchOutboxId))
      .run();
    const executeMatch = vi.fn();
    const dispatcher = new ScrapeMatchOutboxDispatcher(database, executeMatch);

    const summary = await dispatcher.runAvailable();

    expect(executeMatch).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(
      database
        .select()
        .from(scrapeMatchOutbox)
        .where(eq(scrapeMatchOutbox.id, persisted.matchOutboxId))
        .get()
    ).toMatchObject({ status: "completed" });
  });

  it("retries transient SQLite contention while renewing a lease", async () => {
    let attempts = 0;
    const returning = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
      }
      return [{ id: "outbox-1" }];
    });
    const fakeDatabase = {
      update: vi.fn(() => ({
        set: () => ({
          where: () => ({ returning }),
        }),
      })),
    } as unknown as typeof db;
    const dispatcher = new ScrapeMatchOutboxDispatcher(fakeDatabase, vi.fn(), {
      busyRetries: 1,
      busyRetryDelayMs: 0,
    });

    const renewed = await dispatcher.renewLease(
      "outbox-1",
      "worker-1",
      new Date(Date.now() + 60_000)
    );

    expect(renewed).toBe(true);
    expect(returning).toHaveBeenCalledTimes(2);
  });

  it("enforces the match-session lifecycle before parent scrape data can be deleted", async () => {
    const database = createTestDatabase();
    const company = seedCompanyAndSession(database);
    const repository = new DrizzleScraperRepository(database);
    const persisted = await repository.persistScrapeResult({
      companyId: company.id,
      openExternalIds: ["role-1"],
      archiveMissing: true,
      statusesToArchive: ["new"],
      jobsToInsert: [
        {
          externalId: "role-1",
          title: "Role 1",
          url: "https://example.com/jobs/1",
          description: "Detailed role description",
          status: "new",
        },
      ],
      existingJobUpdates: [],
      startedAtMs: Date.now(),
      enableMatching: true,
      log: {
        sessionId: "session-1",
        triggerSource: "manual",
        platform: "greenhouse",
        status: "success",
        jobsFound: 1,
        jobsFiltered: 0,
      },
    });
    if (!persisted.matchOutboxId) throw new Error("Expected a durable match handoff.");

    expect(() =>
      database.delete(scrapeSessions).where(eq(scrapeSessions.id, "session-1")).run()
    ).toThrow();

    database
      .delete(matchSessions)
      .where(eq(matchSessions.id, persisted.matchOutboxId))
      .run();

    expect(
      database
        .select()
        .from(scrapeMatchOutbox)
        .where(eq(scrapeMatchOutbox.id, persisted.matchOutboxId))
        .get()
    ).toBeUndefined();
    expect(() =>
      database.delete(scrapeSessions).where(eq(scrapeSessions.id, "session-1")).run()
    ).not.toThrow();
  });

  it.each(["pending", "running"] as const)(
    "atomically stops a %s durable auto-match without dispatching it again",
    async (outboxStatus) => {
      const database = createTestDatabase();
      const company = seedCompanyAndSession(database);
      const persisted = await persistMatchableJob(database, company.id);
      if (!persisted.matchOutboxId) throw new Error("Expected a durable match handoff.");
      if (outboxStatus === "running") {
        database
          .update(matchSessions)
          .set({ status: "in_progress" })
          .where(eq(matchSessions.id, persisted.matchOutboxId))
          .run();
        database
          .update(scrapeMatchOutbox)
          .set({
            status: "running",
            workerId: "worker-1",
            leaseExpiresAt: new Date(Date.now() + 60_000),
          })
          .where(eq(scrapeMatchOutbox.id, persisted.matchOutboxId))
          .run();
      }

      const result = stopMatchSession(persisted.matchOutboxId, database);
      const executeMatch = vi.fn();
      const dispatcher = new ScrapeMatchOutboxDispatcher(database, executeMatch);
      await dispatcher.runAvailable();

      expect(result).toEqual({ exists: true, stopped: true, status: "failed" });
      expect(executeMatch).not.toHaveBeenCalled();
      expect(
        database
          .select()
          .from(matchSessions)
          .where(eq(matchSessions.id, persisted.matchOutboxId))
          .get()
      ).toMatchObject({ status: "failed" });
      expect(
        database
          .select()
          .from(scrapeMatchOutbox)
          .where(eq(scrapeMatchOutbox.id, persisted.matchOutboxId))
          .get()
      ).toMatchObject({
        status: "failed",
        workerId: null,
        leaseExpiresAt: null,
      });
      expect(database.select().from(scrapingLogs).get()).toMatchObject({
        matcherStatus: "failed",
        matcherJobsCompleted: 0,
      });
    }
  );

  it("uses committed job checkpoints when stopping a running auto-match", async () => {
    const database = createTestDatabase();
    const company = seedCompanyAndSession(database);
    const persisted = await persistMatchableJob(database, company.id);
    if (!persisted.matchOutboxId) throw new Error("Expected a durable match handoff.");
    database.insert(matchLogs).values({
      sessionId: persisted.matchOutboxId,
      jobId: persisted.matchableJobIds[0],
      status: "success",
      score: 91,
    }).run();
    database
      .update(matchSessions)
      .set({ status: "in_progress", jobsCompleted: 0, jobsSucceeded: 0 })
      .where(eq(matchSessions.id, persisted.matchOutboxId))
      .run();
    database
      .update(scrapeMatchOutbox)
      .set({
        status: "running",
        workerId: "worker-1",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      })
      .where(eq(scrapeMatchOutbox.id, persisted.matchOutboxId))
      .run();

    stopMatchSession(persisted.matchOutboxId, database);

    expect(
      database
        .select()
        .from(matchSessions)
        .where(eq(matchSessions.id, persisted.matchOutboxId))
        .get()
    ).toMatchObject({
      status: "failed",
      jobsCompleted: 1,
      jobsSucceeded: 1,
      jobsFailed: 0,
    });
    expect(database.select().from(scrapingLogs).get()).toMatchObject({
      matcherStatus: "failed",
      matcherJobsCompleted: 1,
      matcherErrorCount: 0,
    });
  });

  it("terminates durable matching before deleting all jobs", async () => {
    const database = createTestDatabase();
    const company = seedCompanyAndSession(database);
    const persisted = await persistMatchableJob(database, company.id);
    if (!persisted.matchOutboxId) throw new Error("Expected a durable match handoff.");

    deleteAllJobsAndTerminateMatches(database);

    expect(database.select().from(jobs).all()).toHaveLength(0);
    expect(
      database
        .select()
        .from(matchSessions)
        .where(eq(matchSessions.id, persisted.matchOutboxId))
        .get()
    ).toBeUndefined();
    expect(
      database
        .select()
        .from(scrapeMatchOutbox)
        .where(eq(scrapeMatchOutbox.id, persisted.matchOutboxId))
        .get()
    ).toBeUndefined();
    expect(database.select().from(scrapingLogs).get()).toMatchObject({
      matcherStatus: null,
      matcherJobsTotal: null,
      matcherJobsCompleted: 0,
      matcherDuration: null,
      matcherErrorCount: 0,
    });
  });

  it("recovers an expired matcher lease and finishes the original outbox item", async () => {
    const database = createTestDatabase();
    const company = seedCompanyAndSession(database);
    const log = database
      .insert(scrapingLogs)
      .values({
        companyId: company.id,
        sessionId: "session-1",
        status: "success",
        jobsFound: 1,
        jobsAdded: 1,
        jobsUpdated: 0,
        jobsFiltered: 0,
        jobsArchived: 0,
        duration: 10,
        matcherStatus: "in_progress",
        matcherJobsTotal: 1,
        matcherJobsCompleted: 0,
      })
      .returning({ id: scrapingLogs.id })
      .get();
    database.insert(matchSessions).values({
      id: "outbox-expired",
      triggerSource: "auto_match",
      companyId: company.id,
      status: "in_progress",
      jobsTotal: 1,
      jobsCompleted: 0,
      jobsSucceeded: 0,
      jobsFailed: 0,
      errorCount: 0,
    }).run();
    database.insert(scrapeMatchOutbox).values({
      id: "outbox-expired",
      scrapingLogId: log.id,
      companyId: company.id,
      jobIdsJson: "[42]",
      status: "running",
      attemptCount: 1,
      maxAttempts: 3,
      availableAt: new Date(0),
      workerId: "dead-worker",
      leaseExpiresAt: new Date(0),
    }).run();
    const executeMatch = vi.fn(async () => ({
      sessionId: "outbox-expired",
      total: 1,
      succeeded: 1,
      failed: 0,
    }));
    const dispatcher = new ScrapeMatchOutboxDispatcher(database, executeMatch);

    const summary = await dispatcher.runAvailable();

    expect(summary).toMatchObject({ recovered: 1, claimed: 1, completed: 1 });
    expect(database.select().from(scrapeMatchOutbox).where(
      eq(scrapeMatchOutbox.id, "outbox-expired")
    ).get()).toMatchObject({
      status: "completed",
      attemptCount: 2,
    });
  });

  it("closes the stable match session when normal retries are exhausted", async () => {
    const database = createTestDatabase();
    const company = seedCompanyAndSession(database);
    const repository = new DrizzleScraperRepository(database);
    const persisted = await repository.persistScrapeResult({
      companyId: company.id,
      openExternalIds: ["role-1"],
      archiveMissing: true,
      statusesToArchive: ["new"],
      jobsToInsert: [
        {
          externalId: "role-1",
          title: "Role 1",
          url: "https://example.com/jobs/1",
          description: "Detailed role description",
          status: "new",
        },
      ],
      existingJobUpdates: [],
      startedAtMs: Date.now(),
      enableMatching: true,
      log: {
        sessionId: "session-1",
        triggerSource: "manual",
        platform: "greenhouse",
        status: "success",
        jobsFound: 1,
        jobsFiltered: 0,
      },
    });
    if (!persisted.matchOutboxId) throw new Error("Expected a durable match handoff.");
    database.insert(matchLogs).values([
      {
        sessionId: persisted.matchOutboxId,
        jobId: persisted.matchableJobIds[0],
        status: "failed",
        errorMessage: "earlier failure",
      },
      {
        sessionId: persisted.matchOutboxId,
        jobId: persisted.matchableJobIds[0],
        status: "success",
        score: 92,
      },
    ]).run();
    database
      .update(scrapeMatchOutbox)
      .set({ maxAttempts: 1 })
      .where(eq(scrapeMatchOutbox.id, persisted.matchOutboxId))
      .run();
    const dispatcher = new ScrapeMatchOutboxDispatcher(database, vi.fn(async () => {
      throw new Error("provider unavailable");
    }));

    const summary = await dispatcher.runAvailable();

    expect(summary).toMatchObject({ claimed: 1, failed: 1, retried: 0 });
    expect(
      database
        .select()
        .from(matchSessions)
        .where(eq(matchSessions.id, persisted.matchOutboxId))
        .get()
    ).toMatchObject({
      status: "failed",
      jobsCompleted: 1,
      jobsSucceeded: 1,
      jobsFailed: 0,
    });
    expect(database.select().from(scrapingLogs).get()).toMatchObject({
      matcherStatus: "failed",
      matcherJobsCompleted: 1,
      matcherErrorCount: 0,
    });
  });

  it("closes an exhausted recovered lease with its durable checkpoint counters", async () => {
    const database = createTestDatabase();
    const company = seedCompanyAndSession(database);
    const repository = new DrizzleScraperRepository(database);
    const persisted = await repository.persistScrapeResult({
      companyId: company.id,
      openExternalIds: ["role-1"],
      archiveMissing: true,
      statusesToArchive: ["new"],
      jobsToInsert: [
        {
          externalId: "role-1",
          title: "Role 1",
          url: "https://example.com/jobs/1",
          description: "Detailed role description",
          status: "new",
        },
      ],
      existingJobUpdates: [],
      startedAtMs: Date.now(),
      enableMatching: true,
      log: {
        sessionId: "session-1",
        triggerSource: "manual",
        platform: "greenhouse",
        status: "success",
        jobsFound: 1,
        jobsFiltered: 0,
      },
    });
    if (!persisted.matchOutboxId) throw new Error("Expected a durable match handoff.");
    database.insert(matchLogs).values([
      {
        sessionId: persisted.matchOutboxId,
        jobId: persisted.matchableJobIds[0],
        status: "failed",
        errorMessage: "earlier failure",
      },
      {
        sessionId: persisted.matchOutboxId,
        jobId: persisted.matchableJobIds[0],
        status: "success",
        score: 90,
      },
    ]).run();
    database
      .update(matchSessions)
      .set({ status: "in_progress" })
      .where(eq(matchSessions.id, persisted.matchOutboxId))
      .run();
    database
      .update(scrapeMatchOutbox)
      .set({
        status: "running",
        attemptCount: 3,
        maxAttempts: 3,
        workerId: "dead-worker",
        leaseExpiresAt: new Date(0),
      })
      .where(eq(scrapeMatchOutbox.id, persisted.matchOutboxId))
      .run();
    const dispatcher = new ScrapeMatchOutboxDispatcher(database, vi.fn());

    const summary = await dispatcher.runAvailable();

    expect(summary).toMatchObject({ recovered: 1, claimed: 0 });
    expect(
      database
        .select()
        .from(matchSessions)
        .where(eq(matchSessions.id, persisted.matchOutboxId))
        .get()
    ).toMatchObject({
      status: "failed",
      jobsCompleted: 1,
      jobsSucceeded: 1,
      jobsFailed: 0,
    });
    expect(database.select().from(scrapingLogs).get()).toMatchObject({
      matcherStatus: "failed",
      matcherJobsCompleted: 1,
      matcherErrorCount: 0,
    });
  });

  it("reports the next lease expiry so a restarted process schedules recovery", async () => {
    const database = createTestDatabase();
    const company = seedCompanyAndSession(database);
    const log = database
      .insert(scrapingLogs)
      .values({
        companyId: company.id,
        sessionId: "session-1",
        status: "success",
        matcherStatus: "in_progress",
        matcherJobsTotal: 1,
      })
      .returning({ id: scrapingLogs.id })
      .get();
    const leaseExpiresAt = new Date(Date.now() + 60_000);
    database.insert(matchSessions).values({
      id: "outbox-waiting-for-lease",
      triggerSource: "auto_match",
      companyId: company.id,
      status: "in_progress",
      jobsTotal: 1,
      jobsCompleted: 0,
      jobsSucceeded: 0,
      jobsFailed: 0,
      errorCount: 0,
    }).run();
    database.insert(scrapeMatchOutbox).values({
      id: "outbox-waiting-for-lease",
      scrapingLogId: log.id,
      companyId: company.id,
      jobIdsJson: "[42]",
      status: "running",
      attemptCount: 1,
      workerId: "crashed-worker",
      leaseExpiresAt,
    }).run();
    const executeMatch = vi.fn();
    const dispatcher = new ScrapeMatchOutboxDispatcher(database, executeMatch);

    const summary = await dispatcher.runAvailable();

    expect(executeMatch).not.toHaveBeenCalled();
    if (!summary.nextAvailableAt) throw new Error("Expected a scheduled lease recovery.");
    expect(Math.floor(summary.nextAvailableAt.getTime() / 1_000)).toBe(
      Math.floor(leaseExpiresAt.getTime() / 1_000)
    );
  });
});
