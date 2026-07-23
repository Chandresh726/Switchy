import path from "node:path";

import type Database from "better-sqlite3";

import { ensureJobFingerprintProjection } from "@/lib/ai/artifacts/job-fingerprint-projection";
import { removeObsoleteMatchData } from "@/lib/ai/artifacts/obsolete-match-data";
import { db } from "@/lib/db";
import { migrateLocalDatabase } from "@/lib/db/migrations";
import { runPersistencePreflight } from "@/lib/db/persistence-preflight";
import { backfillPersonSourceRecords } from "@/lib/people/source-records";

const sqlite = (db as unknown as { $client: Database.Database }).$client;
try {
  const preflightReport = runPersistencePreflight(db);
  console.log("Persistence preflight passed", preflightReport);

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
  sqlite.close();
}
