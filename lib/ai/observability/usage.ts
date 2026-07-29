import { and, count, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { aiCacheEvents, aiRuns, matchLogs } from "@/lib/db/schema";
import {
  capabilitiesInGroup,
  type AICapabilityGroup,
} from "@/lib/ai/runtime/capability-groups";

import type {
  AIUsageCapabilitySummary,
  AIUsagePeriod,
  AIUsageProviderSummary,
  AIUsageSummary,
} from "./types";

export interface AIUsageSummaryOptions {
  /** Restrict the ledger to one product area. Omit for every capability. */
  group?: AICapabilityGroup;
  database?: typeof db;
  now?: Date;
}

export async function getAIUsageSummary(
  days: AIUsagePeriod,
  { group, database = db, now = new Date() }: AIUsageSummaryOptions = {}
): Promise<AIUsageSummary> {
  const since = days === "all"
    ? null
    : new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);
  const runPeriod = and(
    since ? gte(aiRuns.createdAt, since) : undefined,
    lte(aiRuns.createdAt, now),
    group ? inArray(aiRuns.capability, [...capabilitiesInGroup(group)]) : undefined
  );
  const cachePeriod = and(
    since ? gte(aiCacheEvents.createdAt, since) : undefined,
    lte(aiCacheEvents.createdAt, now),
    eq(aiCacheEvents.subjectType, "job"),
    group
      ? inArray(aiCacheEvents.capability, [...capabilitiesInGroup(group)])
      : undefined
  );
  // Full-match cache reuse is a matching-only signal, so it stays out of the
  // writing and profile views entirely rather than reporting a misleading zero.
  const includeMatchCache = group === undefined || group === "matching";
  const normalizedErrorCode = sql<string>`coalesce(${aiRuns.errorCode}, 'unknown')`;
  const [
    overallRows,
    capabilityRows,
    providerRows,
    failureRows,
    cachedMatchRows,
    cacheRows,
  ] = await Promise.all([
    database.select({
      executions: count(),
      calls: sql<number>`coalesce(sum(${aiRuns.attemptCount}), 0)`,
      succeeded: sql<number>`coalesce(sum(case when ${aiRuns.status} = 'succeeded' then 1 else 0 end), 0)`,
      failed: sql<number>`coalesce(sum(case when ${aiRuns.status} = 'failed' then 1 else 0 end), 0)`,
      running: sql<number>`coalesce(sum(case when ${aiRuns.status} = 'running' then 1 else 0 end), 0)`,
      cancelled: sql<number>`coalesce(sum(case when ${aiRuns.status} = 'cancelled' then 1 else 0 end), 0)`,
      abandoned: sql<number>`coalesce(sum(case when ${aiRuns.status} = 'abandoned' then 1 else 0 end), 0)`,
      terminalExecutions: sql<number>`coalesce(sum(case when ${aiRuns.status} <> 'running' then 1 else 0 end), 0)`,
      tokenTrackedExecutions: sql<number>`coalesce(sum(case when ${aiRuns.status} <> 'running' and ${aiRuns.totalTokens} is not null then 1 else 0 end), 0)`,
      inputTokens: sql<number>`coalesce(sum(${aiRuns.inputTokens}), 0)`,
      inputNoCacheTokens: sql<number>`coalesce(sum(${aiRuns.inputNoCacheTokens}), 0)`,
      inputCacheReadTokens: sql<number>`coalesce(sum(${aiRuns.inputCacheReadTokens}), 0)`,
      inputCacheWriteTokens: sql<number>`coalesce(sum(${aiRuns.inputCacheWriteTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${aiRuns.outputTokens}), 0)`,
      outputTextTokens: sql<number>`coalesce(sum(${aiRuns.outputTextTokens}), 0)`,
      outputReasoningTokens: sql<number>`coalesce(sum(${aiRuns.outputReasoningTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${aiRuns.totalTokens}), 0)`,
      averageLatencyMs: sql<number>`coalesce(avg(${aiRuns.durationMs}), 0)`,
    }).from(aiRuns).where(runPeriod),
    database.select({
      capability: aiRuns.capability,
      executions: count(),
      calls: sql<number>`coalesce(sum(${aiRuns.attemptCount}), 0)`,
      succeeded: sql<number>`coalesce(sum(case when ${aiRuns.status} = 'succeeded' then 1 else 0 end), 0)`,
      failed: sql<number>`coalesce(sum(case when ${aiRuns.status} = 'failed' then 1 else 0 end), 0)`,
      abandoned: sql<number>`coalesce(sum(case when ${aiRuns.status} = 'abandoned' then 1 else 0 end), 0)`,
      tokenTrackedExecutions: sql<number>`coalesce(sum(case when ${aiRuns.status} <> 'running' and ${aiRuns.totalTokens} is not null then 1 else 0 end), 0)`,
      totalTokens: sql<number>`coalesce(sum(${aiRuns.totalTokens}), 0)`,
      averageLatencyMs: sql<number>`coalesce(avg(${aiRuns.durationMs}), 0)`,
    }).from(aiRuns)
      .where(runPeriod)
      .groupBy(aiRuns.capability),
    database.select({
      provider: aiRuns.provider,
      modelId: aiRuns.modelId,
      executions: count(),
      calls: sql<number>`coalesce(sum(${aiRuns.attemptCount}), 0)`,
      succeeded: sql<number>`coalesce(sum(case when ${aiRuns.status} = 'succeeded' then 1 else 0 end), 0)`,
      failed: sql<number>`coalesce(sum(case when ${aiRuns.status} = 'failed' then 1 else 0 end), 0)`,
      abandoned: sql<number>`coalesce(sum(case when ${aiRuns.status} = 'abandoned' then 1 else 0 end), 0)`,
      totalTokens: sql<number>`coalesce(sum(${aiRuns.totalTokens}), 0)`,
    }).from(aiRuns)
      .where(runPeriod)
      .groupBy(aiRuns.provider, aiRuns.modelId),
    database.select({
      errorCode: normalizedErrorCode,
      failures: count(),
    }).from(aiRuns)
      .where(and(inArray(aiRuns.status, ["failed", "abandoned"]), runPeriod))
      .groupBy(normalizedErrorCode),
    includeMatchCache
      ? database.select({ count: count() }).from(matchLogs).where(and(
        eq(matchLogs.modelUsed, "cache"),
        eq(matchLogs.status, "success"),
        since ? gte(matchLogs.completedAt, since) : undefined,
        lte(matchLogs.completedAt, now)
      ))
      : Promise.resolve([]),
    database.select({
      capability: aiCacheEvents.capability,
      count: count(),
    }).from(aiCacheEvents)
      .where(cachePeriod)
      .groupBy(aiCacheEvents.capability),
  ]);
  const overall = overallRows[0];
  const executions = Number(overall?.executions ?? 0);
  const calls = Number(overall?.calls ?? 0);
  const succeeded = Number(overall?.succeeded ?? 0);
  const failed = Number(overall?.failed ?? 0);
  const running = Number(overall?.running ?? 0);
  const cancelled = Number(overall?.cancelled ?? 0);
  const abandoned = Number(overall?.abandoned ?? 0);
  const terminalExecutions = Number(overall?.terminalExecutions ?? 0);
  const tokenTrackedExecutions = Number(overall?.tokenTrackedExecutions ?? 0);
  const finished = succeeded + failed + abandoned;
  const cacheByCapability = new Map(
    cacheRows.map((row) => [row.capability, Number(row.count)])
  );
  const capabilityByName = new Map<string, AIUsageCapabilitySummary>();
  for (const row of capabilityRows) {
    capabilityByName.set(row.capability, {
      capability: row.capability,
      executions: Number(row.executions),
      calls: Number(row.calls),
      succeeded: Number(row.succeeded),
      failed: Number(row.failed),
      abandoned: Number(row.abandoned),
      cacheHits: cacheByCapability.get(row.capability) ?? 0,
      tokenTrackedExecutions: Number(row.tokenTrackedExecutions),
      totalTokens: Number(row.totalTokens),
      averageLatencyMs: Math.round(Number(row.averageLatencyMs)),
    });
  }
  for (const [capability, cacheHits] of cacheByCapability) {
    if (capabilityByName.has(capability)) continue;
    capabilityByName.set(capability, {
      capability,
      executions: 0,
      calls: 0,
      succeeded: 0,
      failed: 0,
      abandoned: 0,
      cacheHits,
      tokenTrackedExecutions: 0,
      totalTokens: 0,
      averageLatencyMs: 0,
    });
  }
  const capabilities = Array.from(capabilityByName.values()).sort((left, right) => (
    right.calls - left.calls || left.capability.localeCompare(right.capability)
  ));
  const providers: AIUsageProviderSummary[] = providerRows.map((row) => ({
    provider: row.provider,
    modelId: row.modelId,
    executions: Number(row.executions),
    calls: Number(row.calls),
    succeeded: Number(row.succeeded),
    failed: Number(row.failed),
    abandoned: Number(row.abandoned),
    totalTokens: Number(row.totalTokens),
  })).sort((left, right) => (
    right.calls - left.calls ||
    left.provider.localeCompare(right.provider) ||
    left.modelId.localeCompare(right.modelId)
  ));
  const cacheHits = cacheRows.reduce((total, row) => total + Number(row.count), 0);

  return {
    days,
    periodStart: (since ?? new Date(0)).toISOString(),
    periodEnd: now.toISOString(),
    executions,
    calls,
    succeeded,
    failed,
    running,
    cancelled,
    abandoned,
    successRate: finished === 0 ? 0 : Math.round((succeeded / finished) * 100),
    terminalExecutions,
    tokenTrackedExecutions,
    tokenCoveragePercent: terminalExecutions === 0
      ? 0
      : Math.round((tokenTrackedExecutions / terminalExecutions) * 100),
    inputTokens: Number(overall?.inputTokens ?? 0),
    inputNoCacheTokens: Number(overall?.inputNoCacheTokens ?? 0),
    inputCacheReadTokens: Number(overall?.inputCacheReadTokens ?? 0),
    inputCacheWriteTokens: Number(overall?.inputCacheWriteTokens ?? 0),
    outputTokens: Number(overall?.outputTokens ?? 0),
    outputTextTokens: Number(overall?.outputTextTokens ?? 0),
    outputReasoningTokens: Number(overall?.outputReasoningTokens ?? 0),
    totalTokens: Number(overall?.totalTokens ?? 0),
    averageLatencyMs: Math.round(Number(overall?.averageLatencyMs ?? 0)),
    cacheHits,
    ...(includeMatchCache
      ? { fullMatchCacheReuses: Number(cachedMatchRows[0]?.count ?? 0) }
      : {}),
    capabilities,
    providers,
    failures: failureRows.map((row) => ({
      code: row.errorCode,
      count: Number(row.failures),
    }))
      .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code)),
  };
}
