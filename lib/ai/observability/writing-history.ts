import { count, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  aiGeneratedContent,
  aiGenerationEvents,
  aiGenerationHistory,
  aiRuns,
  companies,
  jobs,
} from "@/lib/db/schema";
import {
  chunkSqliteParameters,
  loadSqliteParameterChunks,
} from "@/lib/db/sqlite-utils";

import { getAIRunSummaries } from "./run-summaries";

export async function getWritingHistoryPage(page: { limit: number; offset: number }, database: typeof db = db) {
  const contents = await database.select({
    id: aiGeneratedContent.id, jobId: aiGeneratedContent.jobId, type: aiGeneratedContent.type,
    content: aiGeneratedContent.content, currentVariantId: aiGeneratedContent.currentVariantId,
    updatedAt: aiGeneratedContent.updatedAt, jobTitle: jobs.title,
    companyName: companies.name, companyLogoUrl: companies.logoUrl,
  }).from(aiGeneratedContent).innerJoin(jobs, eq(jobs.id, aiGeneratedContent.jobId))
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .orderBy(desc(aiGeneratedContent.updatedAt), desc(aiGeneratedContent.id)).limit(page.limit).offset(page.offset);
  const [{ total }] = await database.select({ total: count() }).from(aiGeneratedContent);
  const variants = await loadSqliteParameterChunks(contents.map((item) => item.id), (ids) => database.select({
    id: aiGenerationHistory.id, contentId: aiGenerationHistory.contentId, aiRunId: aiGenerationHistory.aiRunId,
  }).from(aiGenerationHistory).where(inArray(aiGenerationHistory.contentId, ids))
    .orderBy(desc(aiGenerationHistory.createdAt), desc(aiGenerationHistory.id)));
  const events = await loadSqliteParameterChunks(variants.map((item) => item.id), (ids) => database.select({
    variantId: aiGenerationEvents.variantId, action: aiGenerationEvents.action, total: count(),
  }).from(aiGenerationEvents).where(inArray(aiGenerationEvents.variantId, ids))
    .groupBy(aiGenerationEvents.variantId, aiGenerationEvents.action));
  const variantsByContent = new Map<number, typeof variants>();
  for (const variant of variants) {
    const rows = variantsByContent.get(variant.contentId) ?? [];
    rows.push(variant);
    variantsByContent.set(variant.contentId, rows);
  }
  const eventsByVariant = new Map<number, typeof events>();
  for (const event of events) {
    const rows = eventsByVariant.get(event.variantId) ?? [];
    rows.push(event);
    eventsByVariant.set(event.variantId, rows);
  }
  const runIds = new Set<string>();
  const selected = contents.map((content) => {
    const history = variantsByContent.get(content.id) ?? [];
    const display = history.find((variant) => variant.id === content.currentVariantId) ?? history[0];
    const runId = display?.aiRunId ?? history.find((variant) => variant.aiRunId)?.aiRunId;
    if (runId) runIds.add(runId);
    const signals = history.flatMap((variant) => eventsByVariant.get(variant.id) ?? []);
    const { content: text, ...summary } = content;
    return { ...summary, preview: text.slice(0, 80), displayVariantId: display?.id ?? null,
      variantCount: history.length,
      copiedCount: signals.filter((event) => event.action === "copied").reduce((total, event) => total + event.total, 0),
      discardedCount: signals.filter((event) => event.action === "discarded").reduce((total, event) => total + event.total, 0),
      runId,
    };
  });
  const runs = await loadSqliteParameterChunks([...runIds], (ids) => database.select({
    id: aiRuns.id, provider: aiRuns.provider, modelId: aiRuns.modelId,
  }).from(aiRuns).where(inArray(aiRuns.id, ids)));
  const runsById = new Map(runs.map((run) => [run.id, run]));
  return {
    contents: selected.map(({ runId, ...summary }) => ({ ...summary, latestRun: runId ? runsById.get(runId) ?? null : null })),
    pagination: { total, ...page, hasMore: page.offset + contents.length < total },
  };
}

export async function getWritingHistoryContents(database: typeof db = db, contentId?: number) {
  const contents = await database
    .select({
      id: aiGeneratedContent.id,
      jobId: aiGeneratedContent.jobId,
      type: aiGeneratedContent.type,
      content: aiGeneratedContent.content,
      currentVariantId: aiGeneratedContent.currentVariantId,
      settingsSnapshot: aiGeneratedContent.settingsSnapshot,
      createdAt: aiGeneratedContent.createdAt,
      updatedAt: aiGeneratedContent.updatedAt,
      jobTitle: jobs.title,
      companyName: companies.name,
      companyLogoUrl: companies.logoUrl,
    })
    .from(aiGeneratedContent)
    .innerJoin(jobs, eq(aiGeneratedContent.jobId, jobs.id))
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(contentId === undefined ? undefined : eq(aiGeneratedContent.id, contentId))
    .orderBy(desc(aiGeneratedContent.updatedAt), desc(aiGeneratedContent.id));

  if (contents.length === 0) return [];

  const allHistory = await loadSqliteParameterChunks(
    contents.map((content) => content.id),
    (contentIdChunk) => database.select().from(aiGenerationHistory)
      .where(inArray(aiGenerationHistory.contentId, contentIdChunk))
  );
  allHistory.sort((left, right) => {
    const byCreatedAt = (left.createdAt?.getTime() ?? 0) - (right.createdAt?.getTime() ?? 0);
    return byCreatedAt || left.id - right.id;
  });
  const [allEvents, runSummaries] = await Promise.all([
    loadSqliteParameterChunks(
      allHistory.map((history) => history.id),
      (variantIdChunk) => database.select().from(aiGenerationEvents)
        .where(inArray(aiGenerationEvents.variantId, variantIdChunk))
    ),
    getAIRunSummaries(
      allHistory.flatMap((history) => history.aiRunId ? [history.aiRunId] : []),
      database
    ),
  ]);
  allEvents.sort((left, right) => {
    const byCreatedAt = left.createdAt.getTime() - right.createdAt.getTime();
    return byCreatedAt || left.id - right.id;
  });
  const eventsByVariantId = new Map<number, typeof allEvents>();
  for (const event of allEvents) {
    const existing = eventsByVariantId.get(event.variantId) ?? [];
    existing.push(event);
    eventsByVariantId.set(event.variantId, existing);
  }

  const historyByContentId = new Map<number, typeof allHistory>();
  for (const history of allHistory) {
    const existing = historyByContentId.get(history.contentId) ?? [];
    existing.push(history);
    historyByContentId.set(history.contentId, existing);
  }
  return contents.map((content) => ({
    ...content,
    history: (historyByContentId.get(content.id) ?? []).map((history) => ({
      id: history.id,
      variant: history.variant,
      userPrompt: history.userPrompt,
      parentVariantId: history.parentVariantId,
      aiRunId: history.aiRunId,
      aiRun: history.aiRunId ? runSummaries.get(history.aiRunId) ?? null : null,
      source: history.source,
      selectedAt: history.selectedAt?.toISOString() ?? null,
      copiedAt: history.copiedAt?.toISOString() ?? null,
      discardedAt: history.discardedAt?.toISOString() ?? null,
      editDistance: history.editDistance,
      editDistanceRatio: history.editDistanceRatio,
      createdAt: history.createdAt?.toISOString()
        ?? content.createdAt?.toISOString()
        ?? content.updatedAt?.toISOString()
        ?? null,
      events: (eventsByVariantId.get(history.id) ?? []).map((event) => ({
        id: event.id,
        action: event.action as "selected" | "copied" | "discarded",
        source: event.source as "generated" | "initial_load" | "navigation" | "copy" | "discard",
        createdAt: event.createdAt.toISOString(),
      })),
    })),
  }));
}

export function clearWritingHistory(database: typeof db = db): void {
  database.transaction((tx) => {
    const contentIds = tx.select({ id: aiGeneratedContent.id })
      .from(aiGeneratedContent)
      .all()
      .map((content) => content.id);
    for (const contentIdChunk of chunkSqliteParameters(contentIds)) {
      tx.delete(aiGenerationHistory)
        .where(inArray(aiGenerationHistory.contentId, contentIdChunk))
        .run();
    }
    tx.delete(aiGeneratedContent).run();
  });
}
