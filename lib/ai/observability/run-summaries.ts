import { inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { aiRunAttempts, aiRuns } from "@/lib/db/schema";
import { chunkSqliteParameters } from "@/lib/db/sqlite-utils";

import type { AIRunSummary } from "./types";

function formatDate(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function parseWarningCodes(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((warning): warning is string => typeof warning === "string")
      : [];
  } catch {
    return [];
  }
}

export async function getAIRunSummaries(
  runIds: readonly string[],
  database: typeof db = db
): Promise<Map<string, AIRunSummary>> {
  const uniqueIds = Array.from(new Set(runIds.filter(Boolean)));
  const loadedSummaries = new Map<string, AIRunSummary>();
  for (const idChunk of chunkSqliteParameters(uniqueIds)) {
    const [rows, attempts] = await Promise.all([
      database.select({
        id: aiRuns.id,
        capability: aiRuns.capability,
        provider: aiRuns.provider,
        modelId: aiRuns.modelId,
        status: aiRuns.status,
        attempts: aiRuns.attemptCount,
        inputTokens: aiRuns.inputTokens,
        inputNoCacheTokens: aiRuns.inputNoCacheTokens,
        inputCacheReadTokens: aiRuns.inputCacheReadTokens,
        inputCacheWriteTokens: aiRuns.inputCacheWriteTokens,
        outputTokens: aiRuns.outputTokens,
        outputTextTokens: aiRuns.outputTextTokens,
        outputReasoningTokens: aiRuns.outputReasoningTokens,
        totalTokens: aiRuns.totalTokens,
        durationMs: aiRuns.durationMs,
        finishReason: aiRuns.finishReason,
        providerRequestId: aiRuns.providerRequestId,
        providerConfigFingerprint: aiRuns.providerConfigFingerprint,
        cacheStatus: aiRuns.cacheStatus,
        qualityResult: aiRuns.qualityResult,
        warningsJson: aiRuns.warningsJson,
        errorCode: aiRuns.errorCode,
        startedAt: aiRuns.startedAt,
        completedAt: aiRuns.completedAt,
      }).from(aiRuns).where(inArray(aiRuns.id, idChunk)),
      database.select().from(aiRunAttempts)
        .where(inArray(aiRunAttempts.runId, idChunk))
        .orderBy(aiRunAttempts.runId, aiRunAttempts.attemptNumber),
    ]);
    const attemptsByRunId = new Map<string, typeof attempts>();
    for (const attempt of attempts) {
      const runAttempts = attemptsByRunId.get(attempt.runId) ?? [];
      runAttempts.push(attempt);
      attemptsByRunId.set(attempt.runId, runAttempts);
    }
    for (const row of rows) {
      const { warningsJson, ...summary } = row;
      loadedSummaries.set(row.id, {
        ...summary,
        warningCodes: parseWarningCodes(warningsJson),
        attemptHistory: (attemptsByRunId.get(row.id) ?? []).map((attempt) => ({
          attemptNumber: attempt.attemptNumber,
          status: attempt.status,
          inputTokens: attempt.inputTokens,
          inputNoCacheTokens: attempt.inputNoCacheTokens,
          inputCacheReadTokens: attempt.inputCacheReadTokens,
          inputCacheWriteTokens: attempt.inputCacheWriteTokens,
          outputTokens: attempt.outputTokens,
          outputTextTokens: attempt.outputTextTokens,
          outputReasoningTokens: attempt.outputReasoningTokens,
          totalTokens: attempt.totalTokens,
          durationMs: attempt.durationMs,
          finishReason: attempt.finishReason,
          providerRequestId: attempt.providerRequestId,
          warningCodes: parseWarningCodes(attempt.warningCodesJson),
          errorCode: attempt.errorCode,
          retryDelayMs: attempt.retryDelayMs,
          startedAt: attempt.startedAt.toISOString(),
          completedAt: formatDate(attempt.completedAt),
        })),
        startedAt: row.startedAt.toISOString(),
        completedAt: formatDate(row.completedAt),
      });
    }
  }
  return new Map(uniqueIds.flatMap((id) => {
    const summary = loadedSummaries.get(id);
    return summary ? [[id, summary] as const] : [];
  }));
}
