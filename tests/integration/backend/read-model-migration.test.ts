import { rmSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "vitest";

import { migrateLocalDatabase } from "@/lib/db/migrations";
import { companies, jobs, matchResults } from "@/lib/db/schema";
import { createMigrationsThrough } from "@test/helpers/migrations";
import { preMatchColumnsJobs } from "@test/helpers/migration-schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-read-model-migration-");

it("drops obsolete job match storage while preserving application and result identities", () => {
  const { database, connection } = harness.createDatabase({ migrate: false });
  const previous = createMigrationsThrough(44, "switchy-before-read-model-");
  try {
    migrateLocalDatabase(database, previous);
    const company = database.insert(companies).values({ name: "Upgrade", careersUrl: "https://upgrade.example/jobs" }).returning().get();
    const job = database.insert(preMatchColumnsJobs).values({ companyId: company.id, title: "Applied role", url: "https://upgrade.example/jobs/1", status: "applied", matchScore: 50, matchReasons: "[]" }).returning().get();
    database.insert(matchResults).values({ id: "preserved-match", jobId: job.id, candidateFingerprint: "candidate", jobFingerprint: "job", scoringPolicyVersion: "current-policy", source: "ai", score: 88, confidence: 0, breakdownJson: "{}", evidenceJson: "{}" }).run();
    migrateLocalDatabase(database, join(process.cwd(), "drizzle"));
    expect(database.select().from(jobs).get()).toMatchObject({ id: job.id, companyId: company.id, status: "applied" });
    expect(database.select().from(matchResults).get()).toMatchObject({ id: "preserved-match", jobId: job.id, score: 88 });
    const columns = connection.pragma("table_info(jobs)") as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toContain("match_score");
    expect(connection.pragma("foreign_key_check")).toEqual([]);
  } finally { rmSync(previous, { recursive: true, force: true }); }
});
