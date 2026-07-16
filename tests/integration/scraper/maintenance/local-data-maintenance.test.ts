import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  aiWorkItems,
  companies,
  jobs,
  matchResults,
  matchSessions,
  scrapeMatchOutbox,
  scrapeQueueItems,
  scrapeSessions,
  scrapingLogs,
} from "@/lib/db/schema";
import { DEFAULT_SQLITE_PARAMETER_CHUNK_SIZE } from "@/lib/db/sqlite-utils";
import { createAIWorkRecords } from "@/lib/ai/work-items/contracts";
import { ScrapeWorkHandler } from "@/lib/scraper/application/scrape-work-handler";
import type { ScrapeCompanyPipeline } from "@/lib/scraper/application/scrape-company-pipeline";
import type { ScrapeSessionProjector } from "@/lib/scraper/application/scrape-session-projector";
import { LocalDataMaintenanceService } from "@/lib/scraper/maintenance";
import type { ScrapeSessionProjectionStore } from "@/lib/scraper/queue/projection-store";
import { InProcessLocalDataOperationGate } from "@/lib/scraper/runtime/data-operation-gate";
import type { ScrapeSettingsProvider } from "@/lib/scraper/settings/provider";

import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

vi.mock("@/lib/db", () => ({ db: {} }));

const sqlite = createSqliteTestHarness("switchy-data-maintenance-");
const createTestDatabase = () => sqlite.createDatabase().database;

function seedCompany(
  database: ReturnType<typeof createTestDatabase>,
  name: string
) {
  return database
    .insert(companies)
    .values({ name, careersUrl: `https://example.com/${name.toLowerCase()}` })
    .returning({ id: companies.id })
    .get();
}

describe("LocalDataMaintenanceService", () => {
  it("cancels an in-flight scrape before deleting its jobs", async () => {
    const database = createTestDatabase();
    const company = seedCompany(database, "ConcurrentScrape");
    database.insert(scrapeSessions).values({
      id: "active-scrape",
      triggerSource: "manual",
      status: "in_progress",
      companiesTotal: 1,
    }).run();
    database.insert(scrapeQueueItems).values({
      id: "active-item",
      sessionId: "active-scrape",
      companyId: company.id,
      status: "running",
      workerId: "worker",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }).run();
    database.insert(jobs).values({
      companyId: company.id,
      externalId: "existing-role",
      title: "Existing role",
      url: "https://example.com/existing-role",
    }).run();
    const item = database.select().from(scrapeQueueItems).get();
    if (!item) throw new Error("Expected a queue item.");

    const scrapeStarted = Promise.withResolvers<void>();
    const cancellationObserved = Promise.withResolvers<void>();
    const gate = new InProcessLocalDataOperationGate();
    const handler = new ScrapeWorkHandler(
      {
        scrape: vi.fn<ScrapeCompanyPipeline["scrape"]>(async (_companyId, request) => {
          scrapeStarted.resolve();
          const signal = request.signal;
          if (!signal) throw new Error("Expected scrape cancellation signal.");
          return new Promise((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                cancellationObserved.resolve();
                reject(signal.reason);
              },
              { once: true }
            );
          });
        }),
      },
      { getCompany: vi.fn() },
      { requestSessionCancellation: vi.fn() },
      {
        getSession: vi.fn().mockResolvedValue({
          id: "active-scrape",
          triggerSource: "manual",
          status: "in_progress",
        }),
      } as unknown as ScrapeSessionProjectionStore,
      {
        loadCommittedResult: vi.fn().mockResolvedValue(null),
      } as unknown as ScrapeSessionProjector,
      {} as ScrapeSettingsProvider,
      undefined,
      gate
    );
    const maintenance = new LocalDataMaintenanceService(database, gate);

    const runningScrape = handler.handle(item, new AbortController().signal);
    await scrapeStarted.promise;
    const deletion = maintenance.deleteCompanyJobs([company.id]);
    await cancellationObserved.promise;
    await expect(runningScrape).rejects.toMatchObject({ name: "AbortError" });
    await expect(deletion).resolves.toBe(1);
    expect(database.select().from(jobs).all()).toHaveLength(0);
  });

  it("terminates the complete parent scrape and scoped match work before deleting company jobs", async () => {
    const database = createTestDatabase();
    const target = seedCompany(database, "Target");
    const sibling = seedCompany(database, "Sibling");
    const targetJob = database
      .insert(jobs)
      .values({
        companyId: target.id,
        externalId: "target-role",
        title: "Target role",
        url: "https://example.com/target-role",
      })
      .returning({ id: jobs.id })
      .get();
    database.insert(jobs).values({
      companyId: sibling.id,
      externalId: "sibling-role",
      title: "Sibling role",
      url: "https://example.com/sibling-role",
    }).run();
    database.insert(scrapeSessions).values({
      id: "parent-session",
      triggerSource: "manual",
      status: "in_progress",
      companiesTotal: 2,
    }).run();
    database.insert(scrapeQueueItems).values([
      {
        id: "target-running",
        sessionId: "parent-session",
        companyId: target.id,
        status: "running",
        workerId: "scrape-worker",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
      {
        id: "sibling-queued",
        sessionId: "parent-session",
        companyId: sibling.id,
        status: "queued",
      },
    ]).run();
    const log = database
      .insert(scrapingLogs)
      .values({
        companyId: target.id,
        sessionId: "parent-session",
        status: "success",
        matcherStatus: "in_progress",
        matcherJobsTotal: 1,
        matcherJobsCompleted: 0,
      })
      .returning({ id: scrapingLogs.id })
      .get();
    database.insert(matchSessions).values([
      {
        id: "durable-match",
        triggerSource: "auto_match",
        companyId: target.id,
        status: "in_progress",
        jobsTotal: 1,
      },
      {
        id: "manual-match",
        triggerSource: "manual",
        companyId: target.id,
        status: "in_progress",
        jobsTotal: 1,
      },
    ]).run();
    database.insert(scrapeMatchOutbox).values({
      id: "durable-match",
      scrapingLogId: log.id,
      companyId: target.id,
      jobIdsJson: JSON.stringify([targetJob.id]),
      status: "running",
      workerId: "match-worker",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }).run();
    const deleted = await new LocalDataMaintenanceService(
      database
    ).deleteCompanyJobs([target.id]);

    expect(deleted).toBe(1);
    expect(
      database
        .select()
        .from(scrapeSessions)
        .where(eq(scrapeSessions.id, "parent-session"))
        .get()
    ).toMatchObject({ status: "failed" });
    expect(
      database
        .select()
        .from(scrapeQueueItems)
        .where(eq(scrapeQueueItems.id, "target-running"))
        .get()
    ).toMatchObject({ status: "running", cancelRequested: true });
    expect(
      database
        .select()
        .from(scrapeQueueItems)
        .where(eq(scrapeQueueItems.id, "sibling-queued"))
        .get()
    ).toMatchObject({ status: "cancelled", cancelRequested: true });
    expect(
      database
        .select()
        .from(matchSessions)
        .where(eq(matchSessions.id, "durable-match"))
        .get()
    ).toBeUndefined();
    expect(
      database
        .select()
        .from(matchSessions)
        .where(eq(matchSessions.id, "manual-match"))
        .get()
    ).toMatchObject({ status: "failed" });
    expect(database.select().from(scrapingLogs).get()).toMatchObject({
      matcherStatus: null,
      matcherJobsTotal: null,
      matcherJobsCompleted: 0,
      matcherErrorCount: 0,
    });
    expect(database.select().from(jobs).all()).toHaveLength(1);
    expect(database.select().from(companies).all()).toHaveLength(2);
  });

  it("deletes durable match history without deleting its parent scrape history", async () => {
    const database = createTestDatabase();
    const company = seedCompany(database, "History");
    database.insert(scrapeSessions).values({
      id: "scrape-parent",
      triggerSource: "scheduler",
      status: "completed",
      completedAt: new Date(),
    }).run();
    const log = database
      .insert(scrapingLogs)
      .values({
        companyId: company.id,
        sessionId: "scrape-parent",
        status: "success",
        matcherStatus: "in_progress",
        matcherJobsTotal: 3,
        matcherJobsCompleted: 1,
        matcherErrorCount: 1,
      })
      .returning({ id: scrapingLogs.id })
      .get();
    database.insert(matchSessions).values({
      id: "match-child",
      triggerSource: "auto_match",
      companyId: company.id,
      status: "in_progress",
      jobsTotal: 3,
    }).run();
    database.insert(scrapeMatchOutbox).values({
      id: "match-child",
      scrapingLogId: log.id,
      companyId: company.id,
      jobIdsJson: "[]",
      status: "running",
      workerId: "worker",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }).run();

    const deleted = await new LocalDataMaintenanceService(
      database
    ).deleteMatchHistory("match-child");

    expect(deleted).toBe(1);
    expect(database.select().from(matchSessions).all()).toHaveLength(0);
    expect(database.select().from(scrapeMatchOutbox).all()).toHaveLength(0);
    expect(database.select().from(scrapeSessions).get()).toMatchObject({
      id: "scrape-parent",
      status: "completed",
    });
    expect(database.select().from(scrapingLogs).get()).toMatchObject({
      matcherStatus: null,
      matcherJobsTotal: null,
      matcherJobsCompleted: 0,
      matcherErrorCount: 0,
    });
  });

  it("clears match data and all session history in one transaction", async () => {
    const database = createTestDatabase();
    const company = seedCompany(database, "MatchData");
    const contentUpdatedAt = new Date("2026-01-15T00:00:00.000Z");
    const matchedJob = database
      .insert(jobs)
      .values({
        companyId: company.id,
        externalId: "matched-role",
        title: "Matched role",
        url: "https://example.com/matched-role",
        matchScore: 94,
        matchReasons: '["fit"]',
        matchedSkills: '["typescript"]',
        missingSkills: "[]",
        recommendations: '["apply"]',
        updatedAt: contentUpdatedAt,
      })
      .returning({ id: jobs.id })
      .get();
    database.insert(matchResults).values({
      id: "match-result-1",
      jobId: matchedJob.id,
      candidateFingerprint: "a".repeat(64),
      jobFingerprint: "b".repeat(64),
      scoringPolicyVersion: "legacy-import-v1",
      score: 94,
      breakdownJson: '{"legacy":94}',
      evidenceJson: '{"reasons":["fit"],"matchedSkills":["typescript"],"missingSkills":[],"recommendations":["apply"],"componentEvidence":{}}',
      confidence: 0,
      source: "legacy",
      isStale: true,
    }).run();
    database.insert(scrapeSessions).values({
      id: "scrape-session",
      triggerSource: "manual",
      status: "completed",
    }).run();
    const log = database
      .insert(scrapingLogs)
      .values({
        companyId: company.id,
        sessionId: "scrape-session",
        status: "success",
        matcherStatus: "completed",
        matcherJobsTotal: 1,
        matcherJobsCompleted: 1,
      })
      .returning({ id: scrapingLogs.id })
      .get();
    database.insert(matchSessions).values([
      {
        id: "outbox-session",
        triggerSource: "auto_match",
        companyId: company.id,
        status: "completed",
      },
      {
        id: "manual-session",
        triggerSource: "manual",
        companyId: company.id,
        status: "completed",
      },
    ]).run();
    database.insert(scrapeMatchOutbox).values({
      id: "outbox-session",
      scrapingLogId: log.id,
      companyId: company.id,
      jobIdsJson: "[]",
      status: "completed",
    }).run();

    const gate = new InProcessLocalDataOperationGate();
    const matchStarted = Promise.withResolvers<void>();
    const cancellationObserved = Promise.withResolvers<void>();
    const matching = gate.runMatch(
      { jobIds: [matchedJob.id] },
      undefined,
      async (signal) => {
        matchStarted.resolve();
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              cancellationObserved.resolve();
              reject(signal.reason);
            },
            { once: true }
          );
        });
      }
    );
    await matchStarted.promise;
    const deletion = new LocalDataMaintenanceService(
      database,
      gate
    ).deleteMatchData();

    await cancellationObserved.promise;
    await expect(matching).rejects.toMatchObject({ name: "AbortError" });
    const jobsCleared = await deletion;

    expect(jobsCleared).toBe(1);
    expect(database.select().from(matchSessions).all()).toHaveLength(0);
    expect(database.select().from(scrapeMatchOutbox).all()).toHaveLength(0);
    expect(database.select().from(matchResults).all()).toHaveLength(0);
    expect(database.select().from(jobs).get()).toMatchObject({
      matchScore: 94,
      matchReasons: '["fit"]',
      matchedSkills: '["typescript"]',
      missingSkills: "[]",
      recommendations: '["apply"]',
      updatedAt: contentUpdatedAt,
    });
    expect(database.select().from(scrapingLogs).get()).toMatchObject({
      matcherStatus: null,
      matcherJobsTotal: null,
      matcherJobsCompleted: 0,
    });
  });

  it("deletes large company selections in bounded SQLite batches", async () => {
    const database = createTestDatabase();
    const companyCount = DEFAULT_SQLITE_PARAMETER_CHUNK_SIZE + 5;
    const companyValues = Array.from({ length: companyCount }, (_, index) => ({
      name: `Company ${index}`,
      careersUrl: `https://example.com/company-${index}`,
    }));
    for (let index = 0; index < companyValues.length; index += 100) {
      database.insert(companies).values(companyValues.slice(index, index + 100)).run();
    }
    const companyIds = database
      .select({ id: companies.id })
      .from(companies)
      .all()
      .map((company) => company.id);
    const lastCompanyId = companyIds.at(-1);
    if (lastCompanyId === undefined) throw new Error("Expected seeded companies");
    const targetJob = database
      .insert(jobs)
      .values({
        companyId: lastCompanyId,
        externalId: "large-selection-role",
        title: "Large selection role",
        url: "https://example.com/large-selection-role",
      })
      .returning({ id: jobs.id })
      .get();
    const records = createAIWorkRecords({
      id: "large-selection-match",
      jobIds: [targetJob.id],
      triggerSource: "company_refresh",
      companyId: lastCompanyId,
      now: new Date(),
    });
    database.insert(matchSessions).values(records.session).run();
    database.insert(aiWorkItems).values(records.workItem).run();

    const result = await new LocalDataMaintenanceService(
      database
    ).deleteCompanies(companyIds);

    expect(result).toEqual({ deletedCompanies: companyCount, deletedJobs: 1 });
    expect(database.select().from(companies).all()).toHaveLength(0);
    expect(database.select().from(matchSessions).all()).toHaveLength(0);
    expect(database.select().from(aiWorkItems).all()).toHaveLength(0);
  });
});
