import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  importLegacyMatchWork,
  parseMatchWorkPayload,
} from "@/lib/ai/work-items";
import {
  getMatchPipelineProgress,
  markJobAnalysisStarted,
} from "@/lib/ai/matcher/tracking";
import { logMatchFailure } from "@/lib/ai/matcher/tracking/session";
import {
  DrizzleAIWorkStore,
  enqueueCoalescedProfileMatchWork,
  enqueueMatchWork,
  insertCompletedEmptyMatchSession,
} from "@/lib/ai/work-items/repository";
import {
  aiWorkItems,
  companies,
  jobs,
  matchLogs,
  matchSessionJobs,
  matchSessions,
  scrapeMatchOutbox,
  scrapingLogs,
} from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-ai-work-items-");

function insertCompany(database: ReturnType<typeof harness.createDatabase>["database"]) {
  return database.insert(companies).values({
    name: "Synthetic Company",
    careersUrl: "https://example.test/careers",
  }).returning().get();
}

describe("generic local AI work repository", () => {
  it("creates a match session and validated work item atomically", () => {
    const { database } = harness.createDatabase();
    const company = insertCompany(database);

    const queued = enqueueMatchWork(database, {
      jobIds: [3, 3, 7],
      triggerSource: "company_refresh",
      companyId: company.id,
    });

    expect(queued).toEqual({
      sessionId: expect.any(String),
      status: "queued",
      total: 2,
    });
    const session = database.select().from(matchSessions).get();
    const work = database.select().from(aiWorkItems).get();
    expect(session).toMatchObject({ id: queued.sessionId, jobsTotal: 2, status: "queued" });
    expect(work).toMatchObject({
      id: queued.sessionId,
      matchSessionId: queued.sessionId,
      workType: "match_jobs",
      companyId: company.id,
      status: "queued",
    });
    expect(parseMatchWorkPayload(work!.payloadJson)).toMatchObject({ jobIds: [3, 7] });
  });

  it("persists pollable per-job pipeline progress", async () => {
    const { database } = harness.createDatabase();
    const company = insertCompany(database);
    const jobRows = database.insert(jobs).values([
      { companyId: company.id, title: "First role", url: "https://example.test/first" },
      { companyId: company.id, title: "Second role", url: "https://example.test/second" },
    ]).returning({ id: jobs.id }).all();
    const queued = enqueueMatchWork(database, {
      jobIds: jobRows.map((row) => row.id),
      triggerSource: "manual",
    });

    expect(database.select().from(matchSessionJobs).all()).toHaveLength(2);
    await markJobAnalysisStarted(queued.sessionId, [jobRows[0]!.id], database);
    await logMatchFailure(
      queued.sessionId,
      jobRows[1]!.id,
      25,
      new Error("provider response was invalid"),
      1,
      "analysis-model",
      database,
      "analysis"
    );

    const progress = await getMatchPipelineProgress(queued.sessionId, database);
    expect(progress.analysis).toMatchObject({
      total: 2,
      completed: 1,
      active: 1,
      failed: 1,
    });
    expect(progress.matching).toMatchObject({ total: 2, completed: 1, failed: 1 });
    expect(progress.jobs.map((row) => row.jobTitle)).toEqual([
      "First role",
      "Second role",
    ]);
  });

  it("durably coalesces queued profile-update work", () => {
    const { database } = harness.createDatabase();

    const first = enqueueCoalescedProfileMatchWork(
      database,
      [1, 2],
      new Date(1)
    );
    const second = enqueueCoalescedProfileMatchWork(
      database,
      [2, 3],
      new Date(2)
    );

    expect(second.sessionId).toBe(first.sessionId);
    expect(second.total).toBe(3);
    expect(database.select().from(matchSessions).all()).toEqual([
      expect.objectContaining({
        id: first.sessionId,
        triggerSource: "profile_update",
        status: "queued",
        jobsTotal: 3,
      }),
    ]);
    const work = database.select().from(aiWorkItems).get();
    expect(parseMatchWorkPayload(work!.payloadJson).jobIds).toEqual([1, 2, 3]);
  });

  it("persists a pollable terminal session when there is no work", () => {
    const { database } = harness.createDatabase();
    const completed = insertCompletedEmptyMatchSession(database, {
      triggerSource: "match_unmatched",
      id: "empty-session",
      now: new Date("2026-07-15T00:00:00.000Z"),
    });

    expect(completed).toEqual({
      sessionId: "empty-session",
      status: "completed",
      total: 0,
    });
    expect(database.select().from(matchSessions).get()).toMatchObject({
      id: "empty-session",
      status: "completed",
      jobsTotal: 0,
      jobsCompleted: 0,
      completedAt: new Date("2026-07-15T00:00:00.000Z"),
    });
    expect(database.select().from(aiWorkItems).all()).toEqual([]);
  });

  it("rolls back the session when the work item cannot satisfy its company FK", () => {
    const { database } = harness.createDatabase();

    expect(() => enqueueMatchWork(database, {
      jobIds: [1],
      triggerSource: "company_refresh",
      companyId: 999,
    })).toThrow();
    expect(database.select().from(matchSessions).all()).toEqual([]);
    expect(database.select().from(aiWorkItems).all()).toEqual([]);
  });

  it("imports nonterminal legacy work once and preserves completed legacy history", () => {
    const { database } = harness.createDatabase();
    const company = insertCompany(database);
    const logs = database.insert(scrapingLogs).values([
      { companyId: company.id, status: "success" },
      { companyId: company.id, status: "success" },
      { companyId: company.id, status: "success" },
    ]).returning().all();
    for (const [index, status] of ["queued", "in_progress", "completed"].entries()) {
      database.insert(matchSessions).values({
        id: `legacy-${index}`,
        triggerSource: "auto_match",
        companyId: company.id,
        status,
        jobsTotal: 1,
      }).run();
    }
    database.insert(scrapeMatchOutbox).values([
      {
        id: "legacy-0",
        scrapingLogId: logs[0]!.id,
        companyId: company.id,
        jobIdsJson: "[11]",
        status: "pending",
      },
      {
        id: "legacy-1",
        scrapingLogId: logs[1]!.id,
        companyId: company.id,
        jobIdsJson: "[22]",
        status: "running",
        attemptCount: 1,
        workerId: "dead-worker",
        leaseExpiresAt: new Date(0),
      },
      {
        id: "legacy-2",
        scrapingLogId: logs[2]!.id,
        companyId: company.id,
        jobIdsJson: "[33]",
        status: "completed",
        completedAt: new Date(),
      },
    ]).run();

    expect(importLegacyMatchWork(database)).toBe(2);
    expect(importLegacyMatchWork(database)).toBe(0);
    expect(database.select().from(aiWorkItems).all()).toHaveLength(2);
    expect(database.select().from(aiWorkItems)
      .where(eq(aiWorkItems.id, "legacy-1")).get()).toMatchObject({
        status: "queued",
        attemptCount: 1,
        workerId: null,
        leaseExpiresAt: null,
      });
    expect(database.select().from(scrapeMatchOutbox).all().map((row) => row.status))
      .toEqual(["migrated", "migrated", "completed"]);
    expect(database.select().from(aiWorkItems)
      .where(eq(aiWorkItems.id, "legacy-2")).get()).toBeUndefined();
  });

  it("terminalizes exhausted legacy work without granting another provider attempt", () => {
    const { database } = harness.createDatabase();
    const company = insertCompany(database);
    const log = database.insert(scrapingLogs).values({
      companyId: company.id,
      status: "success",
      matcherStatus: "in_progress",
    }).returning().get();
    const jobRows = database.insert(jobs).values([
      { companyId: company.id, title: "Recovered", url: "https://example.test/recovered" },
      { companyId: company.id, title: "Pending", url: "https://example.test/pending" },
    ]).returning({ id: jobs.id }).all();
    database.insert(matchSessions).values({
      id: "legacy-exhausted",
      triggerSource: "auto_match",
      companyId: company.id,
      status: "in_progress",
      jobsTotal: 2,
    }).run();
    database.insert(matchLogs).values({
      sessionId: "legacy-exhausted",
      jobId: jobRows[0]!.id,
      status: "success",
    }).run();
    database.insert(scrapeMatchOutbox).values({
      id: "legacy-exhausted",
      scrapingLogId: log.id,
      companyId: company.id,
      jobIdsJson: JSON.stringify(jobRows.map((jobRow) => jobRow.id)),
      status: "running",
      attemptCount: 3,
      maxAttempts: 3,
      workerId: "dead-worker",
      leaseExpiresAt: new Date(0),
    }).run();

    expect(importLegacyMatchWork(database)).toBe(0);

    expect(database.select().from(aiWorkItems).all()).toEqual([]);
    expect(database.select().from(scrapeMatchOutbox).get()).toMatchObject({
      status: "failed",
      attemptCount: 3,
      lastError: "Legacy matcher work exhausted its retry attempts before migration.",
    });
    expect(database.select().from(matchSessions).get()).toMatchObject({
      status: "failed",
      jobsCompleted: 2,
      jobsSucceeded: 1,
      jobsFailed: 1,
    });
    expect(database.select().from(scrapingLogs).get()).toMatchObject({
      matcherStatus: "failed",
      matcherJobsCompleted: 2,
      matcherErrorCount: 1,
    });
  });

  it("fails one malformed legacy row without blocking valid legacy or current work", async () => {
    const { database } = harness.createDatabase();
    const company = insertCompany(database);
    const logs = database.insert(scrapingLogs).values([
      { companyId: company.id, status: "success", matcherStatus: "pending" },
      { companyId: company.id, status: "success", matcherStatus: "pending" },
    ]).returning().all();
    database.insert(matchSessions).values([
      {
        id: "legacy-malformed",
        triggerSource: "auto_match",
        companyId: company.id,
        status: "queued",
        jobsTotal: 2,
      },
      {
        id: "legacy-valid",
        triggerSource: "auto_match",
        companyId: company.id,
        status: "queued",
        jobsTotal: 1,
      },
    ]).run();
    database.insert(scrapeMatchOutbox).values([
      {
        id: "legacy-malformed",
        scrapingLogId: logs[0]!.id,
        companyId: company.id,
        jobIdsJson: "{not-json",
        status: "pending",
      },
      {
        id: "legacy-valid",
        scrapingLogId: logs[1]!.id,
        companyId: company.id,
        jobIdsJson: "[22]",
        status: "pending",
      },
    ]).run();
    const current = enqueueMatchWork(database, {
      id: "current-work",
      jobIds: [33],
      triggerSource: "manual",
      now: new Date(Date.now() + 1),
    });

    expect(importLegacyMatchWork(database)).toBe(1);
    expect(database.select().from(scrapeMatchOutbox)
      .where(eq(scrapeMatchOutbox.id, "legacy-malformed")).get()).toMatchObject({
        status: "failed",
        workerId: null,
        leaseExpiresAt: null,
        lastError: "Legacy matcher work payload was invalid and could not be migrated.",
      });
    expect(database.select().from(matchSessions)
      .where(eq(matchSessions.id, "legacy-malformed")).get()).toMatchObject({
        status: "failed",
        jobsCompleted: 2,
        jobsSucceeded: 0,
        jobsFailed: 2,
      });
    expect(database.select().from(scrapingLogs)
      .where(eq(scrapingLogs.id, logs[0]!.id)).get()).toMatchObject({
        matcherStatus: "failed",
        matcherJobsCompleted: 2,
        matcherErrorCount: 2,
      });
    expect(database.select().from(aiWorkItems)
      .where(eq(aiWorkItems.id, "legacy-valid")).get()).toMatchObject({ status: "queued" });
    expect(database.select().from(aiWorkItems)
      .where(eq(aiWorkItems.id, current.sessionId)).get()).toMatchObject({ status: "queued" });

    const store = new DrizzleAIWorkStore(database);
    const firstClaimed = await store.claimNext(
      "worker-1",
      new Date(Date.now() + 5),
      60_000
    );
    const secondClaimed = await store.claimNext(
      "worker-2",
      new Date(Date.now() + 5),
      60_000
    );
    expect(new Set([firstClaimed?.id, secondClaimed?.id])).toEqual(
      new Set(["legacy-valid", "current-work"])
    );
  });

  it("skips cancellation-requested queued work when claiming", async () => {
    const { database } = harness.createDatabase();
    const store = new DrizzleAIWorkStore(database);
    enqueueMatchWork(database, {
      id: "cancelled-head",
      jobIds: [1],
      triggerSource: "manual",
      now: new Date(0),
    });
    enqueueMatchWork(database, {
      id: "claimable-next",
      jobIds: [2],
      triggerSource: "manual",
      now: new Date(1),
    });
    database.update(aiWorkItems).set({ cancelRequested: true })
      .where(eq(aiWorkItems.id, "cancelled-head")).run();

    const claimed = await store.claimNext("worker-1", new Date(10), 60_000);

    expect(claimed?.id).toBe("claimable-next");
  });

  it("releases graceful shutdown work without consuming an attempt", async () => {
    const { database } = harness.createDatabase();
    const store = new DrizzleAIWorkStore(database);
    enqueueMatchWork(database, {
      id: "release-session",
      jobIds: [1],
      triggerSource: "manual",
      now: new Date(0),
    });
    const claimed = await store.claimNext("worker-1", new Date(1), 60_000);
    expect(claimed?.attemptCount).toBe(1);

    expect(await store.release(
      claimed!.id,
      "worker-1",
      claimed!.attemptCount,
      new Date(2)
    )).toBe(true);

    expect(database.select().from(aiWorkItems)
      .where(eq(aiWorkItems.id, "release-session")).get()).toMatchObject({
        status: "queued",
        attemptCount: 0,
        workerId: null,
      });
  });

  it("transactionally restores session and scrape projections when retrying", async () => {
    const { database } = harness.createDatabase();
    const company = insertCompany(database);
    const scrapingLog = database.insert(scrapingLogs).values({
      companyId: company.id,
      status: "success",
      matcherStatus: "in_progress",
      matcherJobsTotal: 3,
      matcherJobsCompleted: 99,
      matcherErrorCount: 99,
    }).returning().get();
    const jobRows = database.insert(jobs).values([1, 2, 3].map((index) => ({
      companyId: company.id,
      title: `Retry role ${index}`,
      url: `https://example.test/retry/${index}`,
    }))).returning({ id: jobs.id }).all();
    enqueueMatchWork(database, {
      id: "retry-session",
      jobIds: jobRows.map((job) => job.id),
      triggerSource: "auto_match",
      companyId: company.id,
      scrapingLogId: scrapingLog.id,
      now: new Date(0),
    });
    database.insert(matchLogs).values([
      { sessionId: "retry-session", jobId: jobRows[0]!.id, status: "success" },
      { sessionId: "retry-session", jobId: jobRows[1]!.id, status: "failed" },
    ]).run();
    database.update(matchSessions).set({
      status: "in_progress",
      jobsCompleted: 99,
      jobsSucceeded: 99,
      jobsFailed: 0,
      errorCount: 0,
    }).where(eq(matchSessions.id, "retry-session")).run();
    const store = new DrizzleAIWorkStore(database);
    const claimed = await store.claimNext("worker-1", new Date(1), 60_000);

    expect(await store.retry(
      claimed!.id,
      "worker-1",
      "temporary provider failure with private detail",
      new Date(5_000),
      new Date(2)
    )).toBe(true);

    expect(database.select().from(matchSessions)
      .where(eq(matchSessions.id, "retry-session")).get()).toMatchObject({
        status: "queued",
        jobsCompleted: 2,
        jobsSucceeded: 1,
        jobsFailed: 1,
        errorCount: 1,
      });
    expect(database.select().from(scrapingLogs)
      .where(eq(scrapingLogs.id, scrapingLog.id)).get()).toMatchObject({
        matcherStatus: "pending",
        matcherJobsCompleted: 2,
        matcherErrorCount: 1,
      });
    expect(database.select().from(aiWorkItems)
      .where(eq(aiWorkItems.id, "retry-session")).get()).toMatchObject({
        status: "queued",
        lastErrorCode: "unknown",
        lastError: "The AI request failed.",
      });
  });
});
