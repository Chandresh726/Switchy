import { describe, expect, it } from "vitest";

import {
  getAIRunSummaries,
  getAIUsageSummary,
} from "@/lib/ai/observability";
import { aiRuns, matchLogs } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-ai-observability-");
const NOW = new Date("2026-07-14T12:00:00.000Z");

function run(id: string, overrides: Partial<typeof aiRuns.$inferInsert> = {}) {
  return {
    id,
    capability: "job_analysis",
    providerRecordId: "provider-1",
    provider: "openai",
    modelId: "synthetic-model",
    promptVersion: "p1",
    schemaVersion: "s1",
    policyVersion: "e1",
    inputFingerprint: id.padEnd(64, "a").slice(0, 64),
    status: "succeeded",
    attemptCount: 1,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    durationMs: 100,
    cacheStatus: "miss",
    qualityResult: "passed",
    startedAt: new Date(NOW.getTime() - 60_000),
    completedAt: new Date(NOW.getTime() - 59_900),
    createdAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  };
}

describe("AI observability", () => {
  it("summarizes calls, tokens, latency, full match reuse, and sanitized failures", async () => {
    const { database } = harness.createDatabase();
    database.insert(aiRuns).values([
      run("run-success", { cacheStatus: "hit" }),
      run("run-failed", {
        capability: "resume_parse",
        status: "failed",
        errorCode: "timeout",
        qualityResult: "failed",
        durationMs: 300,
        attemptCount: 3,
      }),
      run("run-running", {
        capability: "writing_cover_letter",
        status: "running",
        attemptCount: 0,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        durationMs: null,
        completedAt: null,
      }),
      run("run-cancelled", {
        capability: "writing_referral",
        status: "cancelled",
        errorCode: "aborted",
        attemptCount: 1,
      }),
      run("run-resolution-failed", {
        capability: "match_adjudication",
        status: "failed",
        errorCode: "invalid_model",
        attemptCount: 0,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        durationMs: 0,
      }),
      run("run-older", {
        createdAt: new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1_000),
        startedAt: new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1_000),
      }),
    ]).run();
    database.insert(matchLogs).values({
      status: "success",
      modelUsed: "cache",
      completedAt: new Date(NOW.getTime() - 1_000),
    }).run();

    const sevenDays = await getAIUsageSummary(7, database, NOW);
    const thirtyDays = await getAIUsageSummary(30, database, NOW);

    expect(sevenDays).toMatchObject({
      executions: 5,
      calls: 5,
      succeeded: 1,
      failed: 2,
      running: 1,
      cancelled: 1,
      successRate: 33,
      inputTokens: 30,
      outputTokens: 15,
      totalTokens: 45,
      averageLatencyMs: 125,
      fullMatchCacheReuses: 1,
      failures: [
        { code: "invalid_model", count: 1 },
        { code: "timeout", count: 1 },
      ],
    });
    expect(sevenDays.capabilities.map((capability) => capability.capability)).toEqual([
      "resume_parse",
      "job_analysis",
      "writing_referral",
      "match_adjudication",
      "writing_cover_letter",
    ]);
    expect(sevenDays.capabilities.find((item) => item.capability === "resume_parse"))
      .toMatchObject({ executions: 1, calls: 3 });
    expect(sevenDays.capabilities.find((item) => item.capability === "match_adjudication"))
      .toMatchObject({ executions: 1, calls: 0 });
    expect(thirtyDays).toMatchObject({ executions: 6, calls: 6 });
    expect(JSON.stringify(sevenDays)).not.toContain("currency");
  });

  it("returns safe run summaries for history provenance", async () => {
    const { database } = harness.createDatabase();
    database.insert(aiRuns).values(run("run-summary", {
      finishReason: "stop",
      errorMessage: "private provider detail",
    })).run();

    const summaries = await getAIRunSummaries(["run-summary", "missing"], database);

    expect(summaries.get("run-summary")).toMatchObject({
      id: "run-summary",
      modelId: "synthetic-model",
      status: "succeeded",
      attempts: 1,
      totalTokens: 15,
      finishReason: "stop",
    });
    const serializedSummaries = JSON.stringify(Array.from(summaries.values()));
    expect(serializedSummaries).not.toContain("private provider detail");
    expect(Object.keys(summaries.get("run-summary") ?? {}).sort()).toEqual([
      "attempts",
      "cacheStatus",
      "capability",
      "completedAt",
      "durationMs",
      "errorCode",
      "finishReason",
      "id",
      "inputTokens",
      "modelId",
      "outputTokens",
      "provider",
      "qualityResult",
      "startedAt",
      "status",
      "totalTokens",
    ]);
  });

  it("bounds periods, merges unknown failures, and ignores failed cache logs", async () => {
    const { database } = harness.createDatabase();
    database.insert(aiRuns).values([
      run("run-null-error", {
        status: "failed",
        errorCode: null,
      }),
      run("run-unknown-error", {
        status: "failed",
        errorCode: "unknown",
      }),
      run("run-future", {
        createdAt: new Date(NOW.getTime() + 1_000),
        startedAt: new Date(NOW.getTime() + 1_000),
        completedAt: new Date(NOW.getTime() + 1_100),
      }),
    ]).run();
    database.insert(matchLogs).values([
      {
        status: "success",
        modelUsed: "cache",
        completedAt: new Date(NOW.getTime() - 1_000),
      },
      {
        status: "failed",
        modelUsed: "cache",
        completedAt: new Date(NOW.getTime() - 1_000),
      },
      {
        status: "success",
        modelUsed: "cache",
        completedAt: new Date(NOW.getTime() + 1_000),
      },
    ]).run();

    const summary = await getAIUsageSummary(7, database, NOW);

    expect(summary).toMatchObject({
      executions: 2,
      succeeded: 0,
      failed: 2,
      fullMatchCacheReuses: 1,
      failures: [{ code: "unknown", count: 2 }],
    });
  });

  it("loads more than one SQLite-safe chunk of distinct run summaries", async () => {
    const { database } = harness.createDatabase();
    const rows = Array.from({ length: 401 }, (_, index) => run(`run-${index + 1}`));
    for (let index = 0; index < rows.length; index += 100) {
      database.insert(aiRuns).values(rows.slice(index, index + 100)).run();
    }

    const summaries = await getAIRunSummaries(rows.map((row) => row.id), database);

    expect(summaries.size).toBe(401);
    expect(Array.from(summaries.keys())).toEqual(rows.map((row) => row.id));
    expect(summaries.get("run-401")?.modelId).toBe("synthetic-model");
  });
});
