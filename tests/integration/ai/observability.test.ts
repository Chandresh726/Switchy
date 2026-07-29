import { describe, expect, it } from "vitest";

import {
  getAIRunSummaries,
  getAIUsageSummary,
} from "@/lib/ai/observability";
import { aiCacheEvents, aiRuns, matchLogs } from "@/lib/db/schema";
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
      run("run-oldest", {
        createdAt: new Date(NOW.getTime() - 45 * 24 * 60 * 60 * 1_000),
        startedAt: new Date(NOW.getTime() - 45 * 24 * 60 * 60 * 1_000),
      }),
    ]).run();
    database.insert(matchLogs).values({
      status: "success",
      modelUsed: "cache",
      completedAt: new Date(NOW.getTime() - 1_000),
    }).run();
    database.insert(aiCacheEvents).values([
      {
        id: "cache-analysis",
        capability: "job_analysis",
        subjectType: "job",
        subjectId: "1",
        artifactType: "job_analysis",
        artifactId: "analysis-1",
        createdAt: new Date(NOW.getTime() - 2_000),
      },
      {
        id: "cache-match",
        capability: "match_evaluation",
        subjectType: "job",
        subjectId: "1",
        artifactType: "match_result",
        artifactId: "match-1",
        createdAt: new Date(NOW.getTime() - 1_000),
      },
    ]).run();

    const sevenDays = await getAIUsageSummary(7, { database, now: NOW });
    const thirtyDays = await getAIUsageSummary(30, { database, now: NOW });
    const allTime = await getAIUsageSummary("all", { database, now: NOW });

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
      cacheHits: 2,
      terminalExecutions: 4,
      tokenTrackedExecutions: 3,
      tokenCoveragePercent: 75,
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
      "match_evaluation",
      "writing_cover_letter",
    ]);
    expect(sevenDays.capabilities.find((item) => item.capability === "resume_parse"))
      .toMatchObject({ executions: 1, calls: 3 });
    expect(sevenDays.capabilities.find((item) => item.capability === "match_adjudication"))
      .toMatchObject({ executions: 1, calls: 0 });
    expect(sevenDays.capabilities.find((item) => item.capability === "match_evaluation"))
      .toMatchObject({ executions: 0, calls: 0, cacheHits: 1 });
    expect(sevenDays.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "openai", modelId: "synthetic-model" }),
    ]));
    expect(thirtyDays).toMatchObject({ executions: 6, calls: 6 });
    expect(allTime).toMatchObject({
      days: "all",
      executions: 7,
      calls: 7,
      periodStart: "1970-01-01T00:00:00.000Z",
    });
    expect(JSON.stringify(sevenDays)).not.toContain("currency");
  });

  it("scopes the ledger to one capability group and keeps match reuse out of writing", async () => {
    const { database } = harness.createDatabase();
    database.insert(aiRuns).values([
      run("group-analysis", { capability: "job_analysis" }),
      run("group-evaluation", { capability: "match_evaluation", totalTokens: 40 }),
      run("group-cover-letter", { capability: "writing_cover_letter", totalTokens: 7 }),
      run("group-referral", {
        capability: "writing_referral",
        status: "failed",
        errorCode: "timeout",
      }),
      run("group-resume", { capability: "resume_parse" }),
    ]).run();
    database.insert(matchLogs).values({
      status: "success",
      modelUsed: "cache",
      completedAt: new Date(NOW.getTime() - 1_000),
    }).run();
    database.insert(aiCacheEvents).values({
      id: "group-cache-analysis",
      capability: "job_analysis",
      subjectType: "job",
      subjectId: "7",
      artifactType: "job_analysis",
      artifactId: "analysis-7",
      createdAt: new Date(NOW.getTime() - 1_000),
    }).run();

    const matching = await getAIUsageSummary(7, { database, now: NOW, group: "matching" });
    const writing = await getAIUsageSummary(7, { database, now: NOW, group: "writing" });

    expect(matching.capabilities.map((item) => item.capability).sort())
      .toEqual(["job_analysis", "match_evaluation"]);
    expect(matching).toMatchObject({
      executions: 2,
      totalTokens: 55,
      cacheHits: 1,
      fullMatchCacheReuses: 1,
      failures: [],
    });

    expect(writing.capabilities.map((item) => item.capability).sort())
      .toEqual(["writing_cover_letter", "writing_referral"]);
    expect(writing).toMatchObject({
      executions: 2,
      totalTokens: 22,
      cacheHits: 0,
      failures: [{ code: "timeout", count: 1 }],
    });
    expect(writing.fullMatchCacheReuses).toBeUndefined();
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
      "attemptHistory",
      "attempts",
      "cacheStatus",
      "capability",
      "completedAt",
      "durationMs",
      "errorCode",
      "finishReason",
      "id",
      "inputCacheReadTokens",
      "inputCacheWriteTokens",
      "inputNoCacheTokens",
      "inputTokens",
      "modelId",
      "outputReasoningTokens",
      "outputTextTokens",
      "outputTokens",
      "provider",
      "providerConfigFingerprint",
      "providerRequestId",
      "qualityResult",
      "startedAt",
      "status",
      "totalTokens",
      "warningCodes",
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

    const summary = await getAIUsageSummary(7, { database, now: NOW });
    const allTime = await getAIUsageSummary("all", { database, now: NOW });

    expect(summary).toMatchObject({
      executions: 2,
      succeeded: 0,
      failed: 2,
      fullMatchCacheReuses: 1,
      failures: [{ code: "unknown", count: 2 }],
    });
    expect(allTime).toMatchObject({
      executions: 2,
      fullMatchCacheReuses: 1,
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
