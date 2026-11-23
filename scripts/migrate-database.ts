import path from "node:path";

import type Database from "better-sqlite3";

import { withDirectoryLock } from "@/lib/runtime/file-lock";
import { getRuntimeDirectory, getSwitchyRootDirectory } from "@/lib/state/layout";
import { registerRuntimeLock } from "@/lib/state/runtime-lock";

async function main(): Promise<void> {
  const root = getSwitchyRootDirectory();
  await withDirectoryLock(path.join(getRuntimeDirectory(root), "migration.lock"), async () => {
    const expectedParent = process.env.SWITCHY_MIGRATION_PARENT_PID;
    if (expectedParent && process.ppid !== Number(expectedParent)) {
      throw new Error("The migration owner exited before the migration started");
    }
    const unregister = registerRuntimeLock();
    let sqlite: Database.Database | undefined;
    try {
      const { db } = await import("@/lib/db");
      sqlite = (db as unknown as { $client: Database.Database }).$client;
      const [
        { migrateLocalDatabase }, { runPersistencePreflight },
        { ensureJobFingerprintProjection }, { removeObsoleteMatchData }, { backfillPersonSourceRecords },
      ] = await Promise.all([
        import("@/lib/db/migrations"), import("@/lib/db/persistence-preflight"),
        import("@/lib/ai/artifacts/job-fingerprint-projection"), import("@/lib/ai/artifacts/obsolete-match-data"), import("@/lib/people/source-records"),
      ]);
      runPersistencePreflight(db);
      migrateLocalDatabase(db, path.join(process.cwd(), "drizzle"));
      console.log("Database migrations and integrity checks completed");

      const personSources = backfillPersonSourceRecords(db);
      if (personSources.inserted > 0) {
        console.log(`[People] Backfilled ${personSources.inserted} person source record(s).`);
      }

      const jobFingerprints = ensureJobFingerprintProjection(db);
      if (jobFingerprints.updated > 0 || jobFingerprints.skipped > 0) {
        console.log(
          `[AI artifacts] Job fingerprints updated: ${jobFingerprints.updated}; ` +
          `skipped: ${jobFingerprints.skipped}`
        );
      }

      const obsoleteMatchData = removeObsoleteMatchData(db);
      if (
        obsoleteMatchData.deletedMatchResults > 0 ||
        obsoleteMatchData.deletedMatchHistorySessions > 0 ||
        obsoleteMatchData.deletedMatchHistoryLogs > 0 ||
        obsoleteMatchData.clearedLegacyJobs > 0
      ) {
        console.log(
          `[AI artifacts] Removed ${obsoleteMatchData.deletedMatchResults} obsolete match result(s); ` +
          `${obsoleteMatchData.deletedMatchHistorySessions} obsolete match session(s); ` +
          `${obsoleteMatchData.deletedMatchHistoryLogs} obsolete match log(s); ` +
          `cleared legacy match data from ${obsoleteMatchData.clearedLegacyJobs} job(s).`
        );
      }
    } finally {
      sqlite?.close();
      unregister();
    }
  });
}

main().catch((error: unknown) => {
  console.error("Database migration failed:", error);
  process.exitCode = 1;
});
