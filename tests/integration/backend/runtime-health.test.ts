import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aiWorkItems,
  companies,
  scrapeQueueItems,
  scrapeSessions,
} from "@/lib/db/schema";
import {
  readinessResponseSchema,
  runtimeHealthResponseSchema,
} from "@/lib/api/contracts/health";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-runtime-health-");

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.resetModules();
});

describe("local runtime health", () => {
  it("tracks initialization, queue metrics, and nonessential failures without leaking details", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    const health = await import("@/lib/runtime/health");
    const { GET: getReady } = await import("@/app/api/health/ready/route");
    const { GET: getRuntime } = await import("@/app/api/health/runtime/route");
    health.resetRuntimeHealthForTests();

    const pending = await getReady(new Request("http://localhost/api/health/ready"));
    expect(pending.status).toBe(503);
    const pendingBody = readinessResponseSchema.parse(await pending.json());
    expect(pendingBody).toMatchObject({
      ready: false,
      databaseAvailable: true,
      schedulerInitialization: "pending",
      queueRecovery: "pending",
    });

    health.setSchedulerInitialization("ready");
    health.setScrapeQueueRecovery("ready");
    health.setMatcherDispatchRecovery("ready");
    health.setLegacyMatchImportRecovery("ready");
    health.recordRuntimeError("matcher", "local_provider_unavailable");
    const ready = await getReady(new Request("http://localhost/api/health/ready"));
    expect(ready.status).toBe(200);

    const company = database.insert(companies).values({
      name: "Health Co",
      careersUrl: "https://example.com/health",
    }).returning().get();
    database.insert(scrapeSessions).values({
      id: "health-session",
      triggerSource: "manual",
      status: "in_progress",
      companiesTotal: 1,
    }).run();
    database.insert(scrapeQueueItems).values({
      id: "expired-health-work",
      sessionId: "health-session",
      companyId: company.id,
      status: "running",
      workerId: "local-worker",
      leaseExpiresAt: new Date(0),
      createdAt: new Date(Date.now() - 60_000),
    }).run();
    database.insert(aiWorkItems).values({
      id: "queued-health-work",
      workType: "match_jobs",
      payloadJson: "{}",
      status: "queued",
      createdAt: new Date(Date.now() - 60_000),
    }).run();

    const runtime = await getRuntime(new Request("http://localhost/api/health/runtime"));
    const body = runtimeHealthResponseSchema.parse(await runtime.json());
    expect(body).toMatchObject({
      databaseAvailable: true,
      schedulerInitialization: "ready",
      queueRecovery: "ready",
      expiredLeaseCount: 1,
      oldestQueuedWorkAgeMs: expect.any(Number),
      lastError: {
        subsystem: "matcher",
        code: "local_provider_unavailable",
      },
    });
    expect(JSON.stringify(body)).not.toContain("local-worker");
  });

  it("fails readiness when the database cannot be queried", async () => {
    vi.doMock("@/lib/db", () => ({
      db: { select: () => { throw new Error("private database failure"); } },
    }));
    const health = await import("@/lib/runtime/health");
    health.resetRuntimeHealthForTests();
    health.setSchedulerInitialization("ready");
    health.setScrapeQueueRecovery("ready");
    health.setMatcherDispatchRecovery("ready");
    health.setLegacyMatchImportRecovery("ready");

    const result = await health.getReadinessHealth();

    expect(result).toEqual({
      ready: false,
      databaseAvailable: false,
      schedulerInitialization: "ready",
      queueRecovery: "ready",
    });
  });

  it("recovers readiness after a transient subsystem recovery failure", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    const health = await import("@/lib/runtime/health");
    health.resetRuntimeHealthForTests();
    health.setSchedulerInitialization("ready");
    health.setMatcherDispatchRecovery("ready");
    health.setLegacyMatchImportRecovery("ready");
    health.setScrapeQueueRecovery("failed");

    expect((await health.getReadinessHealth()).ready).toBe(false);

    health.setScrapeQueueRecovery("ready");

    expect(await health.getReadinessHealth()).toMatchObject({
      ready: true,
      queueRecovery: "ready",
    });
  });

  it("does not hide a failed legacy import behind a successful matcher dispatch", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    const health = await import("@/lib/runtime/health");
    health.resetRuntimeHealthForTests();
    health.setSchedulerInitialization("ready");
    health.setScrapeQueueRecovery("ready");
    health.setLegacyMatchImportRecovery("failed");
    health.setMatcherDispatchRecovery("ready");

    expect(await health.getReadinessHealth()).toMatchObject({
      ready: false,
      queueRecovery: "failed",
    });

    health.setLegacyMatchImportRecovery("ready");

    expect((await health.getReadinessHealth()).ready).toBe(true);
  });
});
