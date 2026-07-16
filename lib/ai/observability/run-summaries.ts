import { inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { aiRuns } from "@/lib/db/schema";
import { chunkSqliteParameters } from "@/lib/db/sqlite-utils";

import type { AIRunSummary } from "./types";

function formatDate(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export async function getAIRunSummaries(
  runIds: readonly string[],
  database: typeof db = db
): Promise<Map<string, AIRunSummary>> {
  const uniqueIds = Array.from(new Set(runIds.filter(Boolean)));
  const loadedSummaries = new Map<string, AIRunSummary>();
  for (const idChunk of chunkSqliteParameters(uniqueIds)) {
    const rows = await database.select({
      id: aiRuns.id,
      capability: aiRuns.capability,
      provider: aiRuns.provider,
      modelId: aiRuns.modelId,
      status: aiRuns.status,
      attempts: aiRuns.attemptCount,
      inputTokens: aiRuns.inputTokens,
      outputTokens: aiRuns.outputTokens,
      totalTokens: aiRuns.totalTokens,
      durationMs: aiRuns.durationMs,
      finishReason: aiRuns.finishReason,
      cacheStatus: aiRuns.cacheStatus,
      qualityResult: aiRuns.qualityResult,
      errorCode: aiRuns.errorCode,
      startedAt: aiRuns.startedAt,
      completedAt: aiRuns.completedAt,
    }).from(aiRuns).where(inArray(aiRuns.id, idChunk));
    for (const row of rows) {
      loadedSummaries.set(row.id, {
        ...row,
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
