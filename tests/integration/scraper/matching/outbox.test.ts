import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createAICapabilityRuntime } from "@/lib/ai/runtime/capability-runtime";
import {
  adaptiveProviderLimiter,
  resetAdaptiveProviderLimiter,
} from "@/lib/ai/runtime/adaptive-provider-limiter";
import { db } from "@/lib/db";
import {
  companies,
  jobs,
  matchLogs,
  matchSessions,
  aiWorkItems,
  scrapeQueueItems,
  scrapeSessions,
  scrapingLogs,
  settings,
} from "@/lib/db/schema";
import { DrizzleScraperRepository } from "@/lib/scraper/infrastructure/repository";
import { LocalDataMaintenanceService } from "@/lib/scraper/maintenance";
import { stopMatchSession } from "@/lib/scraper/matching/lifecycle";
import { AIWorkDispatcher } from "@/lib/ai/work-items/dispatcher";
import { DrizzleAIWorkStore, enqueueMatchWork } from "@/lib/ai/work-items/repository";
import { InProcessLocalDataOperationGate } from "@/lib/scraper/runtime/data-operation-gate";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ai/runtime-context", () => ({
  resolveAIContextForCapability: vi.fn(),
}));
vi.mock("@/lib/ai/matcher", () => ({ matchWithTracking: vi.fn() }));
vi.mock("@/lib/ai/matcher/execution/work-executor", () => ({ executeMatchWork: vi.fn() }));
const runtimeMocks = vi.hoisted(() => ({
  create: vi.fn(),
  recordResolutionFailure: vi.fn(),
  startAttempt: vi.fn(),
  completeAttempt: vi.fn(),
  completeSuccess: vi.fn(),
  completeFailure: vi.fn(),
}));
vi.mock("@/lib/ai/runtime/default-run-repository", () => ({
  aiRunRepository: runtimeMocks,
}));

const sqlite = createSqliteTestHarness("switchy-match-outbox-");
const createTestDatabase = () => sqlite.createDatabase().database;

function successfulProviderResult(
  text = "Synthetic analysis"
): Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>> {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 4, noCache: 4, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 2, text: 2, reasoning: 0 },
    },
    warnings: [],
  };
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
  companyId: number,
  jobCount = 1
) {
  const repository = new DrizzleScraperRepository(database);
  const externalIds = Array.from(
    { length: jobCount },
    (_, index) => `role-${index + 1}`
  );
  return repository.persistScrapeResult({
    companyId,
    openExternalIds: externalIds,
    archiveMissing: true,
    statusesToArchive: ["new"],
    jobsToInsert: externalIds.map((externalId, index) => ({
      externalId,
      title: `Role ${index + 1}`,
      url: `https://example.com/jobs/${index + 1}`,
      description: "Detailed role description",
      status: "new",
    })),
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

describe("AIWorkDispatcher", () => {
  it("shares adaptive provider limiting across concurrent durable sessions", async () => {
    resetAdaptiveProviderLimiter();
    runtimeMocks.create.mockReset();
    runtimeMocks.completeSuccess.mockReset();
    runtimeMocks.completeFailure.mockReset();
    let runNumber = 0;
    runtimeMocks.create.mockImplementation(async () => `run-${++runNumber}`);
    runtimeMocks.completeSuccess.mockResolvedValue(undefined);
    runtimeMocks.completeFailure.mockResolvedValue(undefined);
    const database = createTestDatabase();
    database.insert(settings).values({ key: "matcher_concurrency_limit", value: "2" }).run();
    const settingsBefore = database.select().from(settings).all();
    const initialStarted = Promise.withResolvers<void>();
    const releaseInitial = Promise.withResolvers<void>();
    let mode: "initial" | "rate_limit" | "success" = "initial";
    let initialActive = 0;
    let maxInitialActive = 0;
    let rateLimited = false;
    let rateFailureAt = 0;
    let rateRetryAt = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        if (mode === "initial") {
          initialActive += 1;
          maxInitialActive = Math.max(maxInitialActive, initialActive);
          if (initialActive === 2) initialStarted.resolve();
          await releaseInitial.promise;
          initialActive -= 1;
          return successfulProviderResult();
        }
        if (mode === "rate_limit" && !rateLimited) {
          rateLimited = true;
          rateFailureAt = Date.now();
          throw new APICallError({
            message: "Synthetic provider rate limit",
            url: "https://provider.invalid/generate",
            requestBodyValues: {},
            statusCode: 429,
            responseHeaders: { "retry-after-ms": "20" },
            responseBody: "rate limited",
            isRetryable: true,
          });
        }
        if (mode === "rate_limit") rateRetryAt = Date.now();
        return successfulProviderResult();
      },
    });
    const executeMatch = vi.fn(async (jobIds: number[]) => {
      const runtime = await createAICapabilityRuntime({
        capability: "job_analysis",
        resolved: {
          snapshot: {
            providerRecordId: "provider-shared",
            provider: "openai",
            modelId: "synthetic-model",
            model,
          },
          reasoningEffort: "medium",
        },
        providerConcurrencyLimit: 2,
      });
      await runtime.executeText({
        instructions: "Extract synthetic evidence",
        prompt: "Untrusted synthetic job text",
        policy: { maxAttempts: 2, timeoutMs: 1_000, reasoningEffort: "medium" },
        versions: { prompt: "p1", schema: "s1", policy: "e1" },
        inputFingerprint: String(jobIds[0]).padStart(64, "0"),
        retry: { baseDelayMs: 0, maxDelayMs: 0 },
      });
      return new Map(jobIds.map((jobId) => [jobId, {
        score: 90,
        reasons: [],
        matchedSkills: [],
      }]));
    });
    const dispatcher = new AIWorkDispatcher(database, executeMatch);
    for (const id of [1, 2]) {
      enqueueMatchWork(database, {
        id: `adaptive-initial-${id}`,
        jobIds: [id],
        triggerSource: "manual",
        now: new Date(id),
      });
    }

    const initialDispatch = dispatcher.runAvailable();
    await initialStarted.promise;
    expect(maxInitialActive).toBe(2);
    releaseInitial.resolve();
    await initialDispatch;

    mode = "rate_limit";
    enqueueMatchWork(database, {
      id: "adaptive-rate-limit",
      jobIds: [3],
      triggerSource: "manual",
      now: new Date(3),
    });
    await dispatcher.runAvailable();
    expect(rateRetryAt - rateFailureAt).toBeGreaterThanOrEqual(15);
    expect(adaptiveProviderLimiter.getSnapshot("provider-shared")).toMatchObject({
      ceiling: 2,
      currentLimit: 1,
      consecutiveSuccesses: 1,
    });

    mode = "success";
    for (let id = 4; id < 23; id += 1) {
      enqueueMatchWork(database, {
        id: `adaptive-recovery-${id}`,
        jobIds: [id],
        triggerSource: "manual",
        now: new Date(id),
      });
    }
    await dispatcher.runAvailable();

    expect(adaptiveProviderLimiter.getSnapshot("provider-shared")).toMatchObject({
      ceiling: 2,
      currentLimit: 2,
      consecutiveSuccesses: 0,
    });
    expect(database.select().from(settings).all()).toEqual(settingsBefore);
  });

  it("claims independent durable sessions concurrently while provider work is pending", async () => {
    const database = createTestDatabase();
    enqueueMatchWork(database, {
      id: "concurrent-session-1",
      jobIds: [1],
      triggerSource: "manual",
      now: new Date(0),
    });
    enqueueMatchWork(database, {
      id: "concurrent-session-2",
      jobIds: [2],
      triggerSource: "manual",
      now: new Date(1),
    });
    const bothStarted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let active = 0;
    let maxActive = 0;
    const executeMatch = vi.fn(async (jobIds: number[]) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (active === 2) bothStarted.resolve();
      await release.promise;
      active -= 1;
      return new Map(jobIds.map((jobId) => [jobId, {
        score: 90,
        reasons: [],
        matchedSkills: [],
      }]));
    });
    const dispatcher = new AIWorkDispatcher(database, executeMatch);

    const pending = dispatcher.runAvailable();
    await bothStarted.promise;
    expect(maxActive).toBe(2);
    release.resolve();
    const summary = await pending;

    expect(summary).toMatchObject({ claimed: 2, completed: 2, failed: 0 });
    expect(database.select().from(aiWorkItems).all()).toEqual([
      expect.objectContaining({ id: "concurrent-session-1", status: "completed" }),
      expect.objectContaining({ id: "concurrent-session-2", status: "completed" }),
    ]);
  });

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
    const executeMatch = vi.fn(async (jobIds: number[]) =>
      new Map(
        jobIds.map((jobId) => [
          jobId,
          {
            score: 90,
            reasons: [],
            matchedSkills: [],
          },
        ])
      )
    );
    expect(database.select().from(matchSessions).get()).toMatchObject({
      id: persisted.matchOutboxId,
      status: "queued",
      jobsTotal: 1,
    });

    // A newly constructed dispatcher represents the process restarting after commit.
    const dispatcher = new AIWorkDispatcher(database, executeMatch);
    const summary = await dispatcher.runAvailable();

    expect(executeMatch).toHaveBeenCalledWith(
      persisted.matchableJobIds,
      expect.objectContaining({
        sessionId: persisted.matchOutboxId,
        signal: expect.any(AbortSignal),
      })
    );
    expect(summary).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(database.select().from(aiWorkItems).get()).toMatchObject({
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
    const dispatcher = new AIWorkDispatcher(database, executeMatch);

    const summary = await dispatcher.runAvailable();

    expect(executeMatch).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(
      database
        .select()
        .from(aiWorkItems)
        .where(eq(aiWorkItems.id, persisted.matchOutboxId))
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
    const store = new DrizzleAIWorkStore(fakeDatabase, {
      busyRetries: 1,
      busyRetryDelayMs: 0,
    });

    const renewed = await store.heartbeat(
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
        .from(aiWorkItems)
        .where(eq(aiWorkItems.id, persisted.matchOutboxId))
        .get()
    ).toBeUndefined();
    expect(() =>
      database.delete(scrapeSessions).where(eq(scrapeSessions.id, "session-1")).run()
    ).not.toThrow();
  });

  it.each(["queued", "running"] as const)(
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
          .update(aiWorkItems)
          .set({
            status: "running",
            workerId: "worker-1",
            leaseExpiresAt: new Date(Date.now() + 60_000),
          })
          .where(eq(aiWorkItems.id, persisted.matchOutboxId))
          .run();
      }

      const result = await stopMatchSession(persisted.matchOutboxId, database);
      const executeMatch = vi.fn();
      const dispatcher = new AIWorkDispatcher(database, executeMatch);
      await dispatcher.runAvailable();

      expect(result).toEqual({ exists: true, stopped: true, status: "cancelled" });
      expect(executeMatch).not.toHaveBeenCalled();
      expect(
        database
          .select()
          .from(matchSessions)
          .where(eq(matchSessions.id, persisted.matchOutboxId))
          .get()
      ).toMatchObject({ status: "cancelled" });
      expect(
        database
          .select()
          .from(aiWorkItems)
          .where(eq(aiWorkItems.id, persisted.matchOutboxId))
          .get()
      ).toMatchObject({
        status: "cancelled",
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
      .update(aiWorkItems)
      .set({
        status: "running",
        workerId: "worker-1",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      })
      .where(eq(aiWorkItems.id, persisted.matchOutboxId))
      .run();

    await stopMatchSession(persisted.matchOutboxId, database);

    expect(
      database
        .select()
        .from(matchSessions)
        .where(eq(matchSessions.id, persisted.matchOutboxId))
        .get()
    ).toMatchObject({
      status: "cancelled",
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

    await new LocalDataMaintenanceService(database).deleteAllJobs();

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
        .from(aiWorkItems)
        .where(eq(aiWorkItems.id, persisted.matchOutboxId))
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

  it("terminates company-scoped scrape and match work before deleting its jobs", async () => {
    const database = createTestDatabase();
    const company = seedCompanyAndSession(database);
    const persisted = await persistMatchableJob(database, company.id);
    if (!persisted.matchOutboxId) throw new Error("Expected a durable match handoff.");
    const otherCompany = database
      .insert(companies)
      .values({ name: "Globex", careersUrl: "https://globex.example/jobs" })
      .returning({ id: companies.id })
      .get();
    database.update(scrapeSessions).set({ companiesTotal: 2 }).run();
    database.insert(scrapeQueueItems).values([
      {
        id: "queue-item-completed",
        sessionId: "session-1",
        companyId: company.id,
        status: "completed",
        resultJson: "{}",
        completedAt: new Date(),
      },
      {
        id: "queue-item-queued",
        sessionId: "session-1",
        companyId: otherCompany.id,
        status: "queued",
      },
    ]).run();

    const deletedCount = await new LocalDataMaintenanceService(
      database
    ).deleteCompanyJobs([company.id]);

    expect(deletedCount).toBe(1);
    expect(database.select().from(jobs).all()).toHaveLength(0);
    expect(database.select().from(scrapeSessions).get()).toMatchObject({
      status: "failed",
    });
    expect(database.select().from(scrapeQueueItems).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "queue-item-completed",
          status: "completed",
        }),
        expect.objectContaining({
          id: "queue-item-queued",
          status: "cancelled",
          cancelRequested: true,
        }),
      ])
    );
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
        .from(aiWorkItems)
        .where(eq(aiWorkItems.id, persisted.matchOutboxId))
        .get()
    ).toBeUndefined();
    expect(database.select().from(scrapingLogs).get()).toMatchObject({
      matcherStatus: null,
      matcherJobsTotal: null,
      matcherJobsCompleted: 0,
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
    database.insert(aiWorkItems).values({
      id: "outbox-expired",
      workType: "match_jobs",
      matchSessionId: "outbox-expired",
      scrapingLogId: log.id,
      companyId: company.id,
      payloadJson: JSON.stringify({
        jobIds: [42],
        triggerSource: "auto_match",
        companyId: company.id,
        scrapingLogId: log.id,
      }),
      status: "running",
      attemptCount: 1,
      maxAttempts: 3,
      availableAt: new Date(0),
      workerId: "dead-worker",
      leaseExpiresAt: new Date(0),
    }).run();
    const executeMatch = vi.fn(async () =>
      new Map([
        [
          42,
          {
            score: 90,
            reasons: [],
            matchedSkills: [],
          },
        ],
      ])
    );
    const dispatcher = new AIWorkDispatcher(database, executeMatch);

    const summary = await dispatcher.runAvailable();

    expect(summary).toMatchObject({ recovered: 1, claimed: 1, completed: 1 });
    expect(database.select().from(aiWorkItems).where(
      eq(aiWorkItems.id, "outbox-expired")
    ).get()).toMatchObject({
      status: "completed",
      attemptCount: 2,
    });
  });

  it("completes from paid checkpoints without repeating provider work", async () => {
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
      .update(aiWorkItems)
      .set({ maxAttempts: 1 })
      .where(eq(aiWorkItems.id, persisted.matchOutboxId))
      .run();
    const executeMatch = vi.fn(async () => {
      throw new Error("provider unavailable");
    });
    const dispatcher = new AIWorkDispatcher(database, executeMatch);

    const summary = await dispatcher.runAvailable();

    expect(summary).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(executeMatch).not.toHaveBeenCalled();
    expect(
      database
        .select()
        .from(matchSessions)
        .where(eq(matchSessions.id, persisted.matchOutboxId))
        .get()
    ).toMatchObject({
      status: "completed",
      jobsCompleted: 1,
      jobsSucceeded: 1,
      jobsFailed: 0,
    });
    expect(database.select().from(scrapingLogs).get()).toMatchObject({
      matcherStatus: "completed",
      matcherJobsCompleted: 1,
      matcherErrorCount: 0,
    });
  });

  it("closes exhausted work with the latest paid checkpoint", async () => {
    const database = createTestDatabase();
    const company = seedCompanyAndSession(database);
    const persisted = await persistMatchableJob(database, company.id, 2);
    if (!persisted.matchOutboxId) throw new Error("Expected a durable match handoff.");
    database.insert(matchLogs).values({
      sessionId: persisted.matchOutboxId,
      jobId: persisted.matchableJobIds[0],
      status: "success",
      score: 92,
    }).run();
    database
      .update(aiWorkItems)
      .set({ maxAttempts: 1 })
      .where(eq(aiWorkItems.id, persisted.matchOutboxId))
      .run();
    const executeMatch = vi.fn(async () => {
      throw new Error("provider unavailable");
    });
    const dispatcher = new AIWorkDispatcher(database, executeMatch);

    const summary = await dispatcher.runAvailable();

    expect(executeMatch).toHaveBeenCalledWith(
      [persisted.matchableJobIds[1]],
      expect.any(Object)
    );
    expect(summary).toMatchObject({ claimed: 1, failed: 1, retried: 0 });
    expect(
      database
        .select()
        .from(matchSessions)
        .where(eq(matchSessions.id, persisted.matchOutboxId))
        .get()
    ).toMatchObject({
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

  it("aborts in-flight matching when the durable session is stopped", async () => {
    const database = createTestDatabase();
    const company = seedCompanyAndSession(database);
    const persisted = await persistMatchableJob(database, company.id);
    if (!persisted.matchOutboxId) throw new Error("Expected a durable match handoff.");
    const dataOperationGate = new InProcessLocalDataOperationGate();
    const started = Promise.withResolvers<AbortSignal>();
    const executeMatch = vi.fn(
      async (jobIds, options): Promise<never> =>
        dataOperationGate.runMatch(
          { jobIds, sessionId: options.sessionId },
          options.signal,
          async (signal) =>
            new Promise((_resolve, reject) => {
              started.resolve(signal);
              signal.addEventListener(
                "abort",
                () => reject(signal.reason),
                { once: true }
              );
            })
        )
    );
    const dispatcher = new AIWorkDispatcher(database, executeMatch, {
      heartbeatIntervalMs: 60_000,
    });

    const running = dispatcher.runAvailable();
    const signal = await started.promise;
    await stopMatchSession(
      persisted.matchOutboxId,
      database,
      dataOperationGate
    );
    const summary = await running;

    expect(signal.aborted).toBe(true);
    expect(summary).toMatchObject({ completed: 0, retried: 0, failed: 0 });
    expect(
      database
        .select()
        .from(aiWorkItems)
        .where(eq(aiWorkItems.id, persisted.matchOutboxId))
        .get()
    ).toMatchObject({ status: "cancelled", workerId: null });
  });

  it("aborts in-flight manual matching when its session is stopped", async () => {
    const database = createTestDatabase();
    database.insert(matchSessions).values({
      id: "manual-session",
      status: "in_progress",
      triggerSource: "manual",
      jobsTotal: 1,
    }).run();
    const dataOperationGate = new InProcessLocalDataOperationGate();
    const started = Promise.withResolvers<void>();
    const matching = dataOperationGate.runMatch(
      { jobIds: [1], sessionId: "manual-session" },
      undefined,
      async (signal): Promise<never> =>
        new Promise((_resolve, reject) => {
          started.resolve();
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        })
    );
    await started.promise;

    await stopMatchSession("manual-session", database, dataOperationGate);

    await expect(matching).rejects.toMatchObject({ name: "AbortError" });
    expect(
      database
        .select()
        .from(matchSessions)
        .where(eq(matchSessions.id, "manual-session"))
        .get()
    ).toMatchObject({ status: "cancelled" });
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
      .update(aiWorkItems)
      .set({
        status: "running",
        attemptCount: 3,
        maxAttempts: 3,
        workerId: "dead-worker",
        leaseExpiresAt: new Date(0),
      })
      .where(eq(aiWorkItems.id, persisted.matchOutboxId))
      .run();
    const dispatcher = new AIWorkDispatcher(database, vi.fn());

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
    database.insert(aiWorkItems).values({
      id: "outbox-waiting-for-lease",
      workType: "match_jobs",
      matchSessionId: "outbox-waiting-for-lease",
      scrapingLogId: log.id,
      companyId: company.id,
      payloadJson: JSON.stringify({
        jobIds: [42],
        triggerSource: "auto_match",
        companyId: company.id,
        scrapingLogId: log.id,
      }),
      status: "running",
      attemptCount: 1,
      workerId: "crashed-worker",
      leaseExpiresAt,
    }).run();
    const executeMatch = vi.fn();
    const dispatcher = new AIWorkDispatcher(database, executeMatch);

    const summary = await dispatcher.runAvailable();

    expect(executeMatch).not.toHaveBeenCalled();
    if (!summary.nextAvailableAt) throw new Error("Expected a scheduled lease recovery.");
    expect(Math.floor(summary.nextAvailableAt.getTime() / 1_000)).toBe(
      Math.floor(leaseExpiresAt.getTime() / 1_000)
    );
  });
});
