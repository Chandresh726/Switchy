import { and, eq, inArray, isNotNull, isNull, like, notLike, or } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { AI_MATCH_POLICY_BASE_VERSION } from "@/lib/ai/matcher/evidence/ai-match";
import type * as databaseSchema from "@/lib/db/schema";
import { db } from "@/lib/db";
import { jobs, matchLogs, matchResults, matchSessions, settings } from "@/lib/db/schema";
import { chunkSqliteParameters } from "@/lib/db/sqlite-utils";

type ArtifactDatabase = BetterSQLite3Database<typeof databaseSchema>;

const MATCH_HISTORY_CLEANUP_SETTING = "ai.match_history_v3_cleanup_completed";
const TERMINAL_MATCH_SESSION_STATUSES = new Set(["completed", "failed", "cancelled"]);

export interface ObsoleteMatchDataCleanupResult {
  deletedMatchResults: number;
  deletedMatchHistorySessions: number;
  deletedMatchHistoryLogs: number;
  clearedLegacyJobs: number;
}

export function removeObsoleteMatchData(
  database: ArtifactDatabase = db
): ObsoleteMatchDataCleanupResult {
  return database.transaction((tx) => {
    let deletedMatchHistorySessions = 0;
    let deletedMatchHistoryLogs = 0;
    const historyCleanupCompleted = tx.select({ key: settings.key }).from(settings)
      .where(inArray(settings.key, [MATCH_HISTORY_CLEANUP_SETTING])).limit(1).get();

    if (!historyCleanupCompleted) {
      const currentSessionIds = new Set(
        tx.select({ sessionId: matchLogs.sessionId }).from(matchLogs)
          .innerJoin(matchResults, eq(matchLogs.matchResultId, matchResults.id))
          .where(and(
            isNotNull(matchLogs.sessionId),
            like(matchResults.matchPolicyVersion, `${AI_MATCH_POLICY_BASE_VERSION}-%`)
          )).all()
          .filter((row) => row.sessionId !== null)
          .map((row) => row.sessionId!)
      );
      const obsoleteSessionIds = tx.select({ id: matchSessions.id, status: matchSessions.status })
        .from(matchSessions).all()
        .filter((row) => TERMINAL_MATCH_SESSION_STATUSES.has(row.status))
        .filter((row) => !currentSessionIds.has(row.id))
        .map((row) => row.id);

      for (const ids of chunkSqliteParameters(obsoleteSessionIds)) {
        deletedMatchHistoryLogs += tx.select({ id: matchLogs.id }).from(matchLogs)
          .where(inArray(matchLogs.sessionId, ids)).all().length;
        deletedMatchHistorySessions += tx.delete(matchSessions)
          .where(inArray(matchSessions.id, ids))
          .returning({ id: matchSessions.id }).all().length;
      }

      deletedMatchHistoryLogs += tx.delete(matchLogs)
        .where(isNull(matchLogs.sessionId))
        .returning({ id: matchLogs.id }).all().length;
      tx.insert(settings).values({
        key: MATCH_HISTORY_CLEANUP_SETTING,
        value: new Date().toISOString(),
      }).onConflictDoNothing().run();
    }

    const obsoleteIds = tx.select({ id: matchResults.id }).from(matchResults).where(or(
      isNull(matchResults.matchPolicyVersion),
      notLike(matchResults.matchPolicyVersion, `${AI_MATCH_POLICY_BASE_VERSION}-%`)
    )).all().map((row) => row.id);

    let deletedMatchResults = 0;
    for (const ids of chunkSqliteParameters(obsoleteIds)) {
      tx.update(matchLogs).set({ matchResultId: null })
        .where(inArray(matchLogs.matchResultId, ids)).run();
      deletedMatchResults += tx.delete(matchResults)
        .where(inArray(matchResults.id, ids))
        .returning({ id: matchResults.id }).all().length;
    }

    const clearedLegacyJobs = tx.update(jobs).set({
      matchScore: null,
      matchReasons: null,
      matchedSkills: null,
      missingSkills: null,
      recommendations: null,
    }).where(or(
      isNotNull(jobs.matchScore),
      isNotNull(jobs.matchReasons),
      isNotNull(jobs.matchedSkills),
      isNotNull(jobs.missingSkills),
      isNotNull(jobs.recommendations)
    )).returning({ id: jobs.id }).all().length;

    return {
      deletedMatchResults,
      deletedMatchHistorySessions,
      deletedMatchHistoryLogs,
      clearedLegacyJobs,
    };
  }, { behavior: "immediate" });
}
