import { and, count, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { aiRuns, matchLogs } from "@/lib/db/schema";

import type {
  AIUsageCapabilitySummary,
  AIUsageSummary,
} from "./types";

export function parseAIUsageDays(value: string | null | undefined): 7 | 30 {
  return value === "30" ? 30 : 7;
}

export async function getAIUsageSummary(
  days: 7 | 30,
  database: typeof db = db,
  now = new Date()
): Promise<AIUsageSummary> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);
  const runPeriod = and(gte(aiRuns.createdAt, since), lte(aiRuns.createdAt, now));
  const normalizedErrorCode = sql<string>`coalesce(${aiRuns.errorCode}, 'unknown')`;
  const [overallRows, capabilityRows, failureRows, cachedMatchRows] = await Promise.all([
    database.select({
      executions: count(),
      calls: sql<number>`coalesce(sum(${aiRuns.attemptCount}), 0)`,
      succeeded: sql<number>`coalesce(sum(case when ${aiRuns.status} = 'succeeded' then 1 else 0 end), 0)`,
      failed: sql<number>`coalesce(sum(case when ${aiRuns.status} = 'failed' then 1 else 0 end), 0)`,
      running: sql<number>`coalesce(sum(case when ${aiRuns.status} = 'running' then 1 else 0 end), 0)`,
      cancelled: sql<number>`coalesce(sum(case when ${aiRuns.status} = 'cancelled' then 1 else 0 end), 0)`,
      inputTokens: sql<number>`coalesce(sum(${aiRuns.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${aiRuns.outputTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${aiRuns.totalTokens}), 0)`,
      averageLatencyMs: sql<number>`coalesce(avg(${aiRuns.durationMs}), 0)`,
    }).from(aiRuns).where(runPeriod),
    database.select({
      capability: aiRuns.capability,
      executions: count(),
      calls: sql<number>`coalesce(sum(${aiRuns.attemptCount}), 0)`,
      succeeded: sql<number>`coalesce(sum(case when ${aiRuns.status} = 'succeeded' then 1 else 0 end), 0)`,
      failed: sql<number>`coalesce(sum(case when ${aiRuns.status} = 'failed' then 1 else 0 end), 0)`,
      totalTokens: sql<number>`coalesce(sum(${aiRuns.totalTokens}), 0)`,
      averageLatencyMs: sql<number>`coalesce(avg(${aiRuns.durationMs}), 0)`,
    }).from(aiRuns)
      .where(runPeriod)
      .groupBy(aiRuns.capability),
    database.select({
      errorCode: normalizedErrorCode,
      failures: count(),
    }).from(aiRuns)
      .where(and(eq(aiRuns.status, "failed"), runPeriod))
      .groupBy(normalizedErrorCode),
    database.select({ count: count() }).from(matchLogs).where(and(
      eq(matchLogs.modelUsed, "cache"),
      eq(matchLogs.status, "success"),
      gte(matchLogs.completedAt, since),
      lte(matchLogs.completedAt, now)
    )),
  ]);
  const overall = overallRows[0];
  const executions = Number(overall?.executions ?? 0);
  const calls = Number(overall?.calls ?? 0);
  const succeeded = Number(overall?.succeeded ?? 0);
  const failed = Number(overall?.failed ?? 0);
  const running = Number(overall?.running ?? 0);
  const cancelled = Number(overall?.cancelled ?? 0);
  const finished = succeeded + failed;
  const capabilities: AIUsageCapabilitySummary[] = capabilityRows.map((row) => ({
    capability: row.capability,
    executions: Number(row.executions),
    calls: Number(row.calls),
    succeeded: Number(row.succeeded),
    failed: Number(row.failed),
    totalTokens: Number(row.totalTokens),
    averageLatencyMs: Math.round(Number(row.averageLatencyMs)),
  })).sort((left, right) => (
    right.calls - left.calls || left.capability.localeCompare(right.capability)
  ));

  return {
    days,
    periodStart: since.toISOString(),
    periodEnd: now.toISOString(),
    executions,
    calls,
    succeeded,
    failed,
    running,
    cancelled,
    successRate: finished === 0 ? 0 : Math.round((succeeded / finished) * 100),
    inputTokens: Number(overall?.inputTokens ?? 0),
    outputTokens: Number(overall?.outputTokens ?? 0),
    totalTokens: Number(overall?.totalTokens ?? 0),
    averageLatencyMs: Math.round(Number(overall?.averageLatencyMs ?? 0)),
    fullMatchCacheReuses: Number(cachedMatchRows[0]?.count ?? 0),
    capabilities,
    failures: failureRows.map((row) => ({
      code: row.errorCode,
      count: Number(row.failures),
    }))
      .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code)),
  };
}
