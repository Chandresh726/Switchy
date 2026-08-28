import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jobsQuerySchema } from "@/lib/api/contracts/jobs";
import {
  aiWorkItems,
  companies,
  jobs,
  matchLogs,
  matchResults,
  matchSessions,
  notificationDeliveries,
  scrapeMatchOutbox,
  scrapeSessions,
  settings,
} from "@/lib/db/schema";
import { DrizzleScraperRepository } from "@/lib/scraper/infrastructure/repository";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const mocks = vi.hoisted(() => ({
  sendNativeNotification: vi.fn(),
}));

const harness = createSqliteTestHarness("switchy-notifications-");

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/encryption");
  vi.doUnmock("@/lib/settings/settings-service");
  vi.doUnmock("@/lib/ai/matcher/presentation");
  vi.doUnmock("@/lib/notifications/native-notifier");
  vi.resetModules();
  mocks.sendNativeNotification.mockReset();
});

interface SeedMatchedScrapeOptions {
  matchSessionStatus?: "completed" | "in_progress" | "cancelled";
  scrapeCompletedAt?: Date;
  withMatch?: boolean;
}

async function seedMatchedScrape(
  database: ReturnType<typeof harness.createDatabase>["database"],
  triggerSource: "scheduler" | "manual",
  suffix: string,
  options: SeedMatchedScrapeOptions = {}
) {
  const company = database.insert(companies).values({
    name: `Acme ${suffix}`,
    careersUrl: `https://example.com/${suffix}`,
  }).returning().get();
  const scrapeSessionId = `00000000-0000-4000-8000-0000000000${suffix}`;
  database.insert(scrapeSessions).values({
    id: scrapeSessionId,
    triggerSource,
    status: "in_progress",
  }).run();

  const persisted = await new DrizzleScraperRepository(database).persistScrapeResult({
    companyId: company.id,
    openExternalIds: [`role-${suffix}`],
    archiveMissing: true,
    statusesToArchive: ["new"],
    jobsToInsert: [{
      externalId: `role-${suffix}`,
      title: `Staff Engineer ${suffix}`,
      url: `https://example.com/${suffix}/job`,
      description: "Detailed role description",
      status: "new",
    }],
    existingJobUpdates: [],
    startedAtMs: Date.now(),
    enableMatching: true,
    log: {
      sessionId: scrapeSessionId,
      triggerSource,
      platform: "greenhouse",
      status: "success",
      jobsFound: 1,
      jobsFiltered: 0,
    },
  });
  if (!persisted.matchOutboxId || persisted.matchableJobIds.length !== 1) {
    throw new Error("Expected a durable match work item for the scraped job.");
  }
  const matchSessionId = persisted.matchOutboxId;
  const job = database.select().from(jobs)
    .where(eq(jobs.id, persisted.matchableJobIds[0]!)).get();
  if (!job) throw new Error("Expected the persisted scraped job.");

  const matchSessionStatus = options.matchSessionStatus ?? "completed";
  const matchCompletedAt = matchSessionStatus === "in_progress"
    ? null
    : new Date("2026-08-27T10:01:00.000Z");
  database.update(matchSessions).set({
    status: matchSessionStatus,
    completedAt: matchCompletedAt,
  }).where(eq(matchSessions.id, matchSessionId)).run();
  database.update(aiWorkItems).set({
    status: matchSessionStatus === "in_progress" ? "running" : matchSessionStatus,
    completedAt: matchCompletedAt,
    updatedAt: matchCompletedAt ?? new Date("2026-08-27T10:00:30.000Z"),
  }).where(eq(aiWorkItems.id, matchSessionId)).run();
  database.update(scrapeSessions).set({
    status: "completed",
    completedAt: options.scrapeCompletedAt ?? new Date("2026-08-27T10:00:00.000Z"),
  }).where(eq(scrapeSessions.id, scrapeSessionId)).run();

  if (options.withMatch === false) {
    return { job, matchSessionId, scrapeSessionId };
  }

  const matchResultId = `result-${suffix}`;
  database.insert(matchResults).values({
    id: matchResultId,
    jobId: job.id,
    candidateFingerprint: "candidate",
    jobFingerprint: `job-${suffix}`,
    scoringPolicyVersion: "v1",
    score: 88,
    breakdownJson: "{}",
    evidenceJson: "{}",
    confidence: 0,
    source: "ai",
    isStale: false,
  }).run();
  database.insert(matchLogs).values({
    sessionId: matchSessionId,
    jobId: job.id,
    status: "success",
    score: 88,
    matchResultId,
  }).run();
  return { job, matchSessionId, scrapeSessionId };
}

function seedNotificationSettings(
  database: ReturnType<typeof harness.createDatabase>["database"]
): void {
  const enabledAt = new Date("2026-08-27T09:00:00.000Z");
  database.insert(settings).values([
    {
      key: "notifications_enabled",
      value: "true",
      updatedAt: enabledAt,
    },
    {
      key: "notifications_enabled_at",
      value: enabledAt.toISOString(),
      updatedAt: enabledAt,
    },
    {
      key: "notifications_match_score_threshold",
      value: "75",
      updatedAt: enabledAt,
    },
  ]).run();
}

function mockNotificationRuntime(
  database: ReturnType<typeof harness.createDatabase>["database"]
): void {
  vi.doMock("@/lib/db", () => ({ db: database }));
  vi.doMock("@/lib/encryption", () => ({
    decryptSecret: (value: string) => value,
    encryptSecret: (value: string) => value,
  }));
  vi.doMock("@/lib/notifications/native-notifier", () => ({
    sendNativeNotification: mocks.sendNativeNotification,
  }));
}

describe("scheduled match notifications", () => {
  it("sends one aggregate for an eligible scheduled scrape and never for a manual scrape", async () => {
    const { database } = harness.createDatabase();
    const scheduled = await seedMatchedScrape(database, "scheduler", "01");
    await seedMatchedScrape(database, "manual", "02");
    seedNotificationSettings(database);

    mocks.sendNativeNotification.mockResolvedValue(undefined);
    mockNotificationRuntime(database);

    const { dispatchScheduledMatchNotifications } = await import("@/lib/notifications/service");
    await expect(dispatchScheduledMatchNotifications()).resolves.toBe(1);
    await expect(dispatchScheduledMatchNotifications()).resolves.toBe(0);

    expect(mocks.sendNativeNotification).toHaveBeenCalledTimes(1);
    expect(mocks.sendNativeNotification).toHaveBeenCalledWith({
      title: "New profile match found",
      body: expect.stringContaining("Staff Engineer 01 at Acme 01 · 88% match"),
      path: `/jobs?scrapeSessionId=${scheduled.scrapeSessionId}&minScore=75&sortBy=matchScore&sortOrder=desc`,
    });

    const deliveries = database.select().from(notificationDeliveries).all();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      scrapeSessionId: scheduled.scrapeSessionId,
      bestJobId: scheduled.job.id,
      matchCount: 1,
      threshold: 75,
      status: "sent",
      attemptCount: 1,
    });
    expect(database.select().from(notificationDeliveries)
      .where(eq(notificationDeliveries.status, "sent")).all()).toHaveLength(1);
    expect(database.select().from(aiWorkItems).all()).toHaveLength(2);
    expect(database.select().from(scrapeMatchOutbox).all()).toEqual([]);
  });

  it("scopes the notification click destination to jobs matched in that scrape", async () => {
    const { database } = harness.createDatabase();
    const scheduled = await seedMatchedScrape(database, "scheduler", "03");
    await seedMatchedScrape(database, "scheduler", "04");
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/matcher/presentation", () => ({
      getCurrentMatchContext: vi.fn().mockResolvedValue(null),
      getMatchPresentations: vi.fn().mockImplementation(async (rows: Array<{ id: number; matchScore: number | null }>) =>
        new Map(rows.map((row) => [row.id, {
          matchScore: row.matchScore,
          matchReasons: [],
          matchedSkills: [],
          matchResultId: null,
          matchBreakdown: null,
          matchStale: false,
          matchLegacy: false,
          matchSummary: "",
          matchReasoning: [],
          matchRunId: null,
          matchPolicyVersion: null,
          scoringPolicyVersion: null,
        }]))
      ),
    }));

    const { listJobs } = await import("@/lib/application/jobs-service");
    const result = await listJobs(jobsQuerySchema.parse({
      scrapeSessionId: scheduled.scrapeSessionId,
      sortBy: "discoveredAt",
    }));

    expect(result.totalCount).toBe(1);
    expect(result.jobs.map(({ id }) => id)).toEqual([scheduled.job.id]);
  });

  it("prioritizes a new alert while recording older no-match sessions", async () => {
    const { database } = harness.createDatabase();
    for (let index = 0; index < 100; index += 1) {
      database.insert(scrapeSessions).values({
        id: crypto.randomUUID(),
        triggerSource: "scheduler",
        status: "completed",
        completedAt: new Date("2026-08-27T09:30:00.000Z"),
      }).run();
    }
    const scheduled = await seedMatchedScrape(database, "scheduler", "05");
    seedNotificationSettings(database);

    mocks.sendNativeNotification.mockResolvedValue(undefined);
    mockNotificationRuntime(database);

    const { dispatchScheduledMatchNotifications } = await import("@/lib/notifications/service");
    await expect(dispatchScheduledMatchNotifications()).resolves.toBe(1);
    await expect(dispatchScheduledMatchNotifications()).resolves.toBe(0);

    expect(mocks.sendNativeNotification).toHaveBeenCalledOnce();
    expect(mocks.sendNativeNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining(scheduled.scrapeSessionId),
      })
    );
    expect(database.select().from(notificationDeliveries)
      .where(eq(notificationDeliveries.status, "skipped")).all()).toHaveLength(100);
  });

  it("waits for active matcher work before delivering", async () => {
    const { database } = harness.createDatabase();
    const scheduled = await seedMatchedScrape(database, "scheduler", "07", {
      matchSessionStatus: "in_progress",
    });
    seedNotificationSettings(database);
    mocks.sendNativeNotification.mockResolvedValue(undefined);
    mockNotificationRuntime(database);

    const { dispatchScheduledMatchNotifications } = await import("@/lib/notifications/service");
    await expect(dispatchScheduledMatchNotifications()).resolves.toBe(0);
    expect(mocks.sendNativeNotification).not.toHaveBeenCalled();
    expect(database.select().from(notificationDeliveries).all()).toEqual([]);

    const completedAt = new Date("2026-08-27T10:02:00.000Z");
    database.update(matchSessions).set({
      status: "completed",
      completedAt,
    }).where(eq(matchSessions.id, scheduled.matchSessionId)).run();
    database.update(aiWorkItems).set({
      status: "completed",
      completedAt,
      updatedAt: completedAt,
    }).where(eq(aiWorkItems.id, scheduled.matchSessionId)).run();

    await expect(dispatchScheduledMatchNotifications()).resolves.toBe(1);
    expect(mocks.sendNativeNotification).toHaveBeenCalledOnce();
  });

  it("finalizes cancelled matcher sessions using their completed matches", async () => {
    const { database } = harness.createDatabase();
    const matched = await seedMatchedScrape(database, "scheduler", "08", {
      matchSessionStatus: "cancelled",
      scrapeCompletedAt: new Date("2026-08-27T10:02:00.000Z"),
    });
    const unmatched = await seedMatchedScrape(database, "scheduler", "09", {
      matchSessionStatus: "cancelled",
      scrapeCompletedAt: new Date("2026-08-27T10:01:00.000Z"),
      withMatch: false,
    });
    seedNotificationSettings(database);
    mocks.sendNativeNotification.mockResolvedValue(undefined);
    mockNotificationRuntime(database);

    const { dispatchScheduledMatchNotifications } = await import("@/lib/notifications/service");
    await expect(dispatchScheduledMatchNotifications()).resolves.toBe(1);
    await expect(dispatchScheduledMatchNotifications()).resolves.toBe(0);

    expect(mocks.sendNativeNotification).toHaveBeenCalledOnce();
    expect(database.select().from(notificationDeliveries)
      .where(eq(notificationDeliveries.scrapeSessionId, matched.scrapeSessionId)).get())
      .toMatchObject({ status: "sent", matchCount: 1 });
    expect(database.select().from(notificationDeliveries)
      .where(eq(notificationDeliveries.scrapeSessionId, unmatched.scrapeSessionId)).get())
      .toMatchObject({ status: "skipped", matchCount: 0 });
  });

  it("stops an active delivery batch immediately after opt-out", async () => {
    const { database } = harness.createDatabase();
    const first = await seedMatchedScrape(database, "scheduler", "10", {
      scrapeCompletedAt: new Date("2026-08-27T10:02:00.000Z"),
    });
    const remaining = await seedMatchedScrape(database, "scheduler", "11", {
      scrapeCompletedAt: new Date("2026-08-27T10:01:00.000Z"),
    });
    seedNotificationSettings(database);
    mocks.sendNativeNotification.mockImplementationOnce(async () => {
      database.update(settings).set({
        value: "false",
        updatedAt: new Date("2026-08-27T10:03:00.000Z"),
      }).where(eq(settings.key, "notifications_enabled")).run();
    });
    mockNotificationRuntime(database);

    const { dispatchScheduledMatchNotifications } = await import("@/lib/notifications/service");
    await expect(dispatchScheduledMatchNotifications()).resolves.toBe(1);

    expect(mocks.sendNativeNotification).toHaveBeenCalledOnce();
    expect(mocks.sendNativeNotification).toHaveBeenCalledWith(expect.objectContaining({
      path: expect.stringContaining(first.scrapeSessionId),
    }));
    expect(database.select().from(notificationDeliveries).all()).toHaveLength(1);
    expect(database.select().from(notificationDeliveries)
      .where(eq(notificationDeliveries.scrapeSessionId, remaining.scrapeSessionId)).get())
      .toBeUndefined();
  });

  it("backs off failed native delivery before retrying", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T11:00:00.000Z"));
    const { database } = harness.createDatabase();
    await seedMatchedScrape(database, "scheduler", "06");
    seedNotificationSettings(database);

    mocks.sendNativeNotification
      .mockRejectedValueOnce(new Error("notification service unavailable"))
      .mockResolvedValue(undefined);
    mockNotificationRuntime(database);

    const { dispatchScheduledMatchNotifications } = await import("@/lib/notifications/service");
    await expect(dispatchScheduledMatchNotifications()).resolves.toBe(0);
    await expect(dispatchScheduledMatchNotifications()).resolves.toBe(0);
    expect(mocks.sendNativeNotification).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(5 * 60 * 1_000 + 1);
    await expect(dispatchScheduledMatchNotifications()).resolves.toBe(1);
    expect(mocks.sendNativeNotification).toHaveBeenCalledTimes(2);
  });

  it("automatically retries a failed delivery when its backoff expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T11:00:00.000Z"));
    const { database } = harness.createDatabase();
    await seedMatchedScrape(database, "scheduler", "12");
    seedNotificationSettings(database);

    mocks.sendNativeNotification
      .mockRejectedValueOnce(new Error("notification service unavailable"))
      .mockResolvedValue(undefined);
    mockNotificationRuntime(database);

    const { reconcileMatchNotifications } = await import("@/lib/notifications/service");
    await reconcileMatchNotifications();
    expect(mocks.sendNativeNotification).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000 + 1);
    expect(mocks.sendNativeNotification).toHaveBeenCalledTimes(2);
    expect(database.select().from(notificationDeliveries).all()[0]).toMatchObject({
      status: "sent",
      attemptCount: 2,
    });
  });

  it("gives up on a delivery once the retry budget is spent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T11:00:00.000Z"));
    const { database } = harness.createDatabase();
    await seedMatchedScrape(database, "scheduler", "07");
    seedNotificationSettings(database);

    mocks.sendNativeNotification.mockRejectedValue(new Error("helper unavailable"));
    mockNotificationRuntime(database);

    const { dispatchScheduledMatchNotifications } = await import("@/lib/notifications/service");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(dispatchScheduledMatchNotifications()).resolves.toBe(0);
      vi.advanceTimersByTime(5 * 60 * 1_000 + 1);
    }

    expect(mocks.sendNativeNotification).toHaveBeenCalledTimes(3);
    expect(database.select().from(notificationDeliveries).all()[0]).toMatchObject({
      status: "failed",
      attemptCount: 3,
    });
  });

  it("refuses a test notification while notifications are disabled", async () => {
    const { database } = harness.createDatabase();
    mockNotificationRuntime(database);

    const { sendNotificationTest } = await import("@/lib/notifications/service");
    await expect(sendNotificationTest()).rejects.toMatchObject({
      code: "notifications_disabled",
    });
    expect(mocks.sendNativeNotification).not.toHaveBeenCalled();

    seedNotificationSettings(database);
    mocks.sendNativeNotification.mockResolvedValue(undefined);
    await expect(sendNotificationTest()).resolves.toMatchObject({ success: true });
    expect(mocks.sendNativeNotification).toHaveBeenCalledOnce();
  });
});
