import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";
import {
  companies,
  jobs,
  matchSessions,
  scrapeMatchOutbox,
  scrapeSessions,
  scrapingLogs,
} from "@/lib/db/schema";

import { DrizzleScraperRepository } from "./repository";

vi.mock("@/lib/db", () => ({ db: {} }));

const openConnections: Database.Database[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const connection of openConnections.splice(0)) connection.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createTestDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "switchy-persistence-"));
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

describe("DrizzleScraperRepository atomic persistence", () => {
  it("commits job sync, hydration, company metadata, and audit logging together", async () => {
    const database = createTestDatabase();
    const company = seedCompanyAndSession(database);
    database.insert(jobs).values([
      {
        companyId: company.id,
        externalId: "open-again",
        title: "Reopened role",
        url: "https://example.com/open-again",
        status: "archived",
        archiveSource: "scraper",
        archivedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        companyId: company.id,
        externalId: "now-closed",
        title: "Closed role",
        url: "https://example.com/now-closed",
        status: "new",
      },
      {
        companyId: company.id,
        externalId: "user-applied",
        title: "Applied role",
        url: "https://example.com/user-applied",
        status: "applied",
      },
      {
        companyId: company.id,
        externalId: "hydrate-me",
        title: "Hydration role",
        url: "https://example.com/hydrate-me",
        status: "new",
        description: null,
      },
    ]).run();
    const hydrationJob = database
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.externalId, "hydrate-me"))
      .get();
    if (!hydrationJob) throw new Error("Failed to seed hydration job.");
    const startedAtMs = Date.now() - 250;
    const repository = new DrizzleScraperRepository(database);

    const result = await repository.persistScrapeResult({
      companyId: company.id,
      openExternalIds: ["open-again", "hydrate-me", "new-role", "empty-description"],
      archiveMissing: true,
      statusesToArchive: ["new", "viewed", "interested", "rejected"],
      jobsToInsert: [
        {
          externalId: "new-role",
          title: "New role",
          url: "https://example.com/new-role",
          description: "Detailed role description",
          status: "new",
        },
        {
          externalId: "empty-description",
          title: "Another role",
          url: "https://example.com/another-role",
          description: " ",
          status: "new",
        },
      ],
      existingJobUpdates: [
        {
          existingJobId: hydrationJob.id,
          job: {
            externalId: "hydrate-me",
            title: "Hydrated role",
            url: "https://example.com/hydrate-me",
            description: "Hydrated description",
            descriptionFormat: "plain",
          },
        },
      ],
      companyBoardToken: "detected-board",
      startedAtMs,
      enableMatching: true,
      log: {
        sessionId: "session-1",
        triggerSource: "manual",
        platform: "greenhouse",
        status: "success",
        jobsFound: 6,
        jobsFiltered: 0,
      },
    });

    const storedJobs = database.select().from(jobs).orderBy(asc(jobs.id)).all();
    const storedCompany = database.select().from(companies).get();
    const storedLog = database.select().from(scrapingLogs).get();
    const storedOutbox = database.select().from(scrapeMatchOutbox).get();
    const storedMatchSession = database.select().from(matchSessions).get();
    if (!storedCompany || !storedLog || !storedOutbox || !storedMatchSession) {
      throw new Error("Atomic persistence did not commit.");
    }

    expect(result).toMatchObject({
      jobsAdded: 2,
      jobsUpdated: 1,
      jobsArchived: 1,
      logId: storedLog.id,
      matchOutboxId: storedOutbox.id,
    });
    expect(result.matchableJobIds).toHaveLength(1);
    expect(storedJobs.find((job) => job.externalId === "open-again")).toMatchObject({
      status: "new",
      archiveSource: null,
      archivedAt: null,
    });
    expect(storedJobs.find((job) => job.externalId === "now-closed")).toMatchObject({
      status: "archived",
      archiveSource: "scraper",
    });
    expect(storedJobs.find((job) => job.externalId === "user-applied")?.status).toBe("applied");
    expect(storedJobs.find((job) => job.externalId === "hydrate-me")).toMatchObject({
      title: "Hydrated role",
      description: "Hydrated description",
    });
    expect(storedCompany).toMatchObject({
      boardToken: "detected-board",
    });
    expect(storedCompany.lastScrapedAt).toBeInstanceOf(Date);
    expect(storedLog).toMatchObject({
      jobsAdded: 2,
      jobsUpdated: 1,
      jobsArchived: 1,
      matcherStatus: "pending",
      matcherJobsTotal: 1,
    });
    expect(storedLog.duration).toBeGreaterThanOrEqual(200);
    expect(storedOutbox).toMatchObject({
      scrapingLogId: storedLog.id,
      companyId: company.id,
      status: "pending",
      jobIdsJson: JSON.stringify(result.matchableJobIds),
    });
    expect(storedMatchSession).toMatchObject({
      id: storedOutbox.id,
      triggerSource: "auto_match",
      companyId: company.id,
      status: "queued",
      jobsTotal: 1,
      jobsCompleted: 0,
    });
  });

  it("rolls back every mutation when the audit log cannot be persisted", async () => {
    const database = createTestDatabase();
    const company = seedCompanyAndSession(database);
    database.insert(jobs).values({
      companyId: company.id,
      externalId: "existing-role",
      title: "Existing role",
      url: "https://example.com/existing",
      status: "new",
    }).run();
    const repository = new DrizzleScraperRepository(database);

    await expect(
      repository.persistScrapeResult({
        companyId: company.id,
        openExternalIds: [],
        archiveMissing: true,
        statusesToArchive: ["new"],
        jobsToInsert: [
          {
            externalId: "new-role",
            title: "New role",
            url: "https://example.com/new",
            status: "new",
          },
        ],
        existingJobUpdates: [],
        startedAtMs: Date.now(),
        enableMatching: false,
        log: {
          sessionId: "missing-session",
          triggerSource: "manual",
          platform: "greenhouse",
          status: "success",
          jobsFound: 1,
          jobsFiltered: 0,
        },
      })
    ).rejects.toThrow();

    const storedJobs = database.select().from(jobs).all();
    const storedCompany = database.select().from(companies).get();
    const storedLogs = database.select().from(scrapingLogs).all();
    if (!storedCompany) throw new Error("Failed to seed company.");

    expect(storedJobs).toHaveLength(1);
    expect(storedJobs[0]).toMatchObject({ externalId: "existing-role", status: "new" });
    expect(storedCompany.lastScrapedAt).toBeNull();
    expect(storedLogs).toHaveLength(0);
  });

  it("rejects persistence after its scrape session has been stopped", async () => {
    const database = createTestDatabase();
    const company = seedCompanyAndSession(database);
    database
      .update(scrapeSessions)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(scrapeSessions.id, "session-1"))
      .run();
    const repository = new DrizzleScraperRepository(database);

    await expect(
      repository.persistScrapeResult({
        companyId: company.id,
        openExternalIds: ["late-role"],
        archiveMissing: true,
        statusesToArchive: ["new"],
        jobsToInsert: [
          {
            externalId: "late-role",
            title: "Late role",
            url: "https://example.com/late-role",
            status: "new",
          },
        ],
        existingJobUpdates: [],
        companyBoardToken: "late-token",
        startedAtMs: Date.now(),
        enableMatching: false,
        log: {
          sessionId: "session-1",
          triggerSource: "manual",
          platform: "greenhouse",
          status: "success",
          jobsFound: 1,
          jobsFiltered: 0,
        },
      })
    ).rejects.toThrow("Scrape session session-1 is no longer active.");

    expect(database.select().from(jobs).all()).toHaveLength(0);
    expect(database.select().from(scrapingLogs).all()).toHaveLength(0);
    expect(database.select().from(scrapeMatchOutbox).all()).toHaveLength(0);
    expect(database.select().from(companies).get()).toMatchObject({
      boardToken: null,
      lastScrapedAt: null,
    });
  });

  it("persists board-sized inserts in bounded SQLite parameter batches", async () => {
    const database = createTestDatabase();
    const company = seedCompanyAndSession(database);
    const repository = new DrizzleScraperRepository(database);
    const jobsToInsert = Array.from({ length: 125 }, (_, index) => ({
      externalId: `role-${index}`,
      title: `Role ${index}`,
      url: `https://example.com/jobs/${index}`,
      description: `Description ${index}`,
      status: "new" as const,
    }));

    const result = await repository.persistScrapeResult({
      companyId: company.id,
      openExternalIds: jobsToInsert.map((job) => job.externalId),
      archiveMissing: true,
      statusesToArchive: ["new"],
      jobsToInsert,
      existingJobUpdates: [],
      startedAtMs: Date.now(),
      enableMatching: true,
      log: {
        sessionId: "session-1",
        triggerSource: "manual",
        platform: "greenhouse",
        status: "success",
        jobsFound: jobsToInsert.length,
        jobsFiltered: 0,
      },
    });

    expect(result.jobsAdded).toBe(125);
    expect(result.matchableJobIds).toHaveLength(125);
    expect(database.select().from(jobs).all()).toHaveLength(125);
  });

  it("enforces the top-level company boundary for every nested write", async () => {
    const database = createTestDatabase();
    const company = seedCompanyAndSession(database);
    const otherCompany = database
      .insert(companies)
      .values({ name: "Globex", careersUrl: "https://globex.example/jobs" })
      .returning({ id: companies.id })
      .get();
    const otherJob = database
      .insert(jobs)
      .values({
        companyId: otherCompany.id,
        externalId: "globex-role",
        title: "Globex role",
        url: "https://globex.example/jobs/1",
        status: "new",
      })
      .returning({ id: jobs.id })
      .get();
    const repository = new DrizzleScraperRepository(database);

    const result = await repository.persistScrapeResult({
      companyId: company.id,
      openExternalIds: ["acme-role"],
      archiveMissing: false,
      statusesToArchive: ["new"],
      jobsToInsert: [
        {
          externalId: "acme-role",
          title: "Acme role",
          url: "https://example.com/jobs/acme",
          status: "new",
        },
      ],
      existingJobUpdates: [
        {
          existingJobId: otherJob.id,
          job: {
            externalId: "globex-role",
            title: "Wrongly updated title",
            url: "https://globex.example/jobs/1",
            description: "Should not cross the company boundary",
          },
        },
      ],
      startedAtMs: Date.now(),
      enableMatching: false,
      log: {
        sessionId: "session-1",
        triggerSource: "manual",
        platform: "greenhouse",
        status: "success",
        jobsFound: 1,
        jobsFiltered: 0,
      },
    });

    const insertedJobId = result.insertedJobIds[0];
    if (!insertedJobId) throw new Error("Expected a company-scoped inserted job.");
    const storedOtherJob = database.select().from(jobs).where(eq(jobs.id, otherJob.id)).get();
    const insertedJob = database.select().from(jobs).where(eq(jobs.id, insertedJobId)).get();
    const log = database.select().from(scrapingLogs).where(eq(scrapingLogs.id, result.logId)).get();

    expect(result.jobsUpdated).toBe(0);
    expect(storedOtherJob).toMatchObject({
      companyId: otherCompany.id,
      title: "Globex role",
      description: null,
    });
    expect(insertedJob?.companyId).toBe(company.id);
    expect(log?.companyId).toBe(company.id);
  });
});
