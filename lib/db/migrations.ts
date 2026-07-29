import type Database from "better-sqlite3";
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type * as databaseSchema from "./schema";
import {
  aiCacheEvents,
  aiGeneratedContent,
  aiGenerationEvents,
  aiGenerationHistory,
  aiProviders,
  aiRuns,
  matchLogs,
  matchResults,
  matchSessionJobs,
  settings,
} from "./schema";

interface ProviderMigrationRecord {
  id: string;
  provider: string;
  isActive: boolean | null;
  isDefault: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

function isMissingTableError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("no such table");
}

function reconcileDuplicateNonCustomProviders(
  database: BetterSQLite3Database<typeof databaseSchema>
): void {
  let providers: ProviderMigrationRecord[];
  try {
    providers = database.select({
      id: aiProviders.id,
      provider: aiProviders.provider,
      isActive: aiProviders.isActive,
      isDefault: aiProviders.isDefault,
      createdAt: aiProviders.createdAt,
      updatedAt: aiProviders.updatedAt,
    }).from(aiProviders)
      .where(ne(aiProviders.provider, "custom"))
      .orderBy(
        desc(aiProviders.isDefault),
        desc(aiProviders.isActive),
        desc(aiProviders.updatedAt),
        asc(aiProviders.createdAt),
        asc(aiProviders.id)
      ).all();
  } catch (error) {
    if (isMissingTableError(error)) return;
    throw error;
  }

  const groups = new Map<string, ProviderMigrationRecord[]>();
  for (const provider of providers) {
    const group = groups.get(provider.provider) ?? [];
    group.push(provider);
    groups.set(provider.provider, group);
  }
  if (Array.from(groups.values()).every((group) => group.length < 2)) return;

  database.transaction((tx) => {
    for (const duplicates of groups.values()) {
      const survivor = duplicates[0];
      if (!survivor || duplicates.length < 2) continue;
      for (const duplicate of duplicates.slice(1)) {
        tx.update(settings).set({ value: survivor.id })
          .where(eq(settings.value, duplicate.id)).run();
        tx.delete(settings)
          .where(eq(settings.key, `provider_model_catalog:${duplicate.id}`)).run();
        try {
          tx.update(aiRuns).set({ providerRecordId: survivor.id })
            .where(eq(aiRuns.providerRecordId, duplicate.id)).run();
        } catch (error) {
          if (!isMissingTableError(error)) throw error;
        }
        tx.delete(aiProviders).where(eq(aiProviders.id, duplicate.id)).run();
      }
    }
  });
}

function backfillAICacheEvents(
  database: BetterSQLite3Database<typeof databaseSchema>
): void {
  const legacyBackfillKey = "migration:ai_cache_events_v1";
  try {
    database.delete(settings).where(eq(settings.key, legacyBackfillKey)).run();
    if (database.select({ id: aiCacheEvents.id }).from(aiCacheEvents).limit(1).get()) return;
  } catch (error) {
    if (isMissingTableError(error)) return;
    throw error;
  }

  database.transaction((tx) => {
    const cachedAnalyses = tx.select({
      sessionId: matchSessionJobs.sessionId,
      jobId: matchSessionJobs.jobId,
      sourceRunId: matchSessionJobs.analysisRunId,
      artifactId: matchSessionJobs.jobAnalysisId,
      createdAt: matchSessionJobs.analysisCompletedAt,
    }).from(matchSessionJobs)
      .where(eq(matchSessionJobs.analysisStatus, "cached"))
      .all();
    for (const cached of cachedAnalyses) {
      if (!cached.artifactId) continue;
      tx.insert(aiCacheEvents).values({
        id: `legacy:analysis:${cached.sessionId}:${cached.jobId}`,
        capability: "job_analysis",
        subjectType: "job",
        subjectId: String(cached.jobId),
        sourceRunId: cached.sourceRunId,
        artifactType: "job_analysis",
        artifactId: cached.artifactId,
        sessionId: cached.sessionId,
        createdAt: cached.createdAt ?? new Date(),
      }).onConflictDoNothing().run();
    }

    const cachedMatches = tx.select({
      logId: matchLogs.id,
      sessionId: matchLogs.sessionId,
      jobId: matchLogs.jobId,
      artifactId: matchLogs.matchResultId,
      sourceRunId: matchResults.matchRunId,
      createdAt: matchLogs.completedAt,
    }).from(matchLogs)
      .leftJoin(matchResults, eq(matchLogs.matchResultId, matchResults.id))
      .where(eq(matchLogs.modelUsed, "cache"))
      .all();
    for (const cached of cachedMatches) {
      if (!cached.jobId || !cached.artifactId) continue;
      tx.insert(aiCacheEvents).values({
        id: `legacy:match:${cached.logId}`,
        capability: "match_evaluation",
        subjectType: "job",
        subjectId: String(cached.jobId),
        sourceRunId: cached.sourceRunId,
        artifactType: "match_result",
        artifactId: cached.artifactId,
        sessionId: cached.sessionId,
        createdAt: cached.createdAt ?? new Date(),
      }).onConflictDoNothing().run();
    }
  });
}

function backfillWritingEvents(
  database: BetterSQLite3Database<typeof databaseSchema>
): void {
  const legacyBackfillKey = "migration:ai_generation_events_v1";
  try {
    database.delete(settings).where(eq(settings.key, legacyBackfillKey)).run();
    if (
      database.select({ id: aiGenerationEvents.id })
        .from(aiGenerationEvents)
        .limit(1)
        .get()
    ) return;
  } catch (error) {
    if (isMissingTableError(error)) return;
    throw error;
  }

  database.transaction((tx) => {
    const variants = tx.select().from(aiGenerationHistory).all();
    for (const variant of variants) {
      if (variant.selectedAt) {
        tx.insert(aiGenerationEvents).values({
          variantId: variant.id,
          action: "selected",
          source: "generated",
          createdAt: variant.selectedAt,
        }).run();
      }
      if (variant.copiedAt) {
        tx.insert(aiGenerationEvents).values({
          variantId: variant.id,
          action: "copied",
          source: "copy",
          createdAt: variant.copiedAt,
        }).run();
      }
      if (variant.discardedAt) {
        tx.insert(aiGenerationEvents).values({
          variantId: variant.id,
          action: "discarded",
          source: "discard",
          createdAt: variant.discardedAt,
        }).run();
      }
    }

    const contents = tx.select({ id: aiGeneratedContent.id })
      .from(aiGeneratedContent)
      .where(isNull(aiGeneratedContent.currentVariantId))
      .all();
    for (const content of contents) {
      const latest = tx.select({ id: aiGenerationHistory.id })
        .from(aiGenerationHistory)
        .where(and(
          eq(aiGenerationHistory.contentId, content.id),
          isNull(aiGenerationHistory.discardedAt)
        ))
        .orderBy(desc(aiGenerationHistory.createdAt), desc(aiGenerationHistory.id))
        .limit(1)
        .get();
      if (latest) {
        tx.update(aiGeneratedContent).set({ currentVariantId: latest.id })
          .where(eq(aiGeneratedContent.id, content.id))
          .run();
      }
    }
  });
}

export function migrateLocalDatabase(
  database: BetterSQLite3Database<typeof databaseSchema>,
  migrationsFolder: string
): void {
  const sqlite = (database as unknown as { $client: Database.Database }).$client;
  sqlite.pragma("foreign_keys = OFF");
  try {
    reconcileDuplicateNonCustomProviders(database);
    migrate(database, { migrationsFolder });
    backfillAICacheEvents(database);
    backfillWritingEvents(database);
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
  const foreignKeyViolations = sqlite.pragma("foreign_key_check") as unknown[];
  if (foreignKeyViolations.length > 0) {
    throw new Error(`Migration left ${foreignKeyViolations.length} foreign-key violation(s)`);
  }
  const integrity = sqlite.pragma("integrity_check") as Array<{ integrity_check: string }>;
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
    throw new Error("Migration failed SQLite integrity validation");
  }
}
