import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it } from "vitest";

import {
  deserializeResumeArtifacts,
  persistResumeVersion,
} from "@/lib/ai/resume/repository";
import { aiRuns, profile, resumes } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-resume-repository-");
const temporaryMigrationFolders: string[] = [];
const legacyResumes = sqliteTable("resumes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: integer("profile_id"),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  parsedData: text("parsed_data").notNull(),
  version: integer("version").notNull(),
  isCurrent: integer("is_current", { mode: "boolean" }).notNull(),
});

afterEach(() => {
  for (const folder of temporaryMigrationFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

function migrationsThrough(maxIndex: number): string {
  const source = join(process.cwd(), "drizzle");
  const destination = mkdtempSync(join(tmpdir(), "switchy-resume-migrations-"));
  temporaryMigrationFolders.push(destination);
  mkdirSync(join(destination, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(join(source, "meta", "_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const entries = journal.entries.filter((entry) => entry.idx <= maxIndex);
  for (const entry of entries) {
    cpSync(join(source, `${entry.tag}.sql`), join(destination, `${entry.tag}.sql`));
  }
  writeFileSync(join(destination, "meta", "_journal.json"), JSON.stringify({
    ...journal,
    entries,
  }));
  return destination;
}

function insertRun(database: ReturnType<typeof harness.createDatabase>["database"]): string {
  const id = "resume-run-1";
  database.insert(aiRuns).values({
    id,
    capability: "resume_parse",
    providerRecordId: "provider-1",
    provider: "openai",
    modelId: "synthetic-model",
    promptVersion: "resume-normalization-prompt-v2",
    schemaVersion: "resume-data-v2",
    policyVersion: "resume-normalization-policy-v2",
    inputFingerprint: "fixture-fingerprint",
    status: "succeeded",
  }).run();
  return id;
}

describe("resume artifact repository", () => {
  it("stores validated parse provenance, warnings, and version lineage", () => {
    const { database } = harness.createDatabase();
    const candidate = database.insert(profile).values({ name: "Alex Rivera" }).returning().get();
    const aiRunId = insertRun(database);
    const first = persistResumeVersion(database, {
      profileId: candidate.id,
      fileName: "synthetic-resume.pdf",
      filePath: "resumes/synthetic-resume.pdf",
      parsedData: {
        name: "Alex Rivera",
        skills: [{ name: "TypeScript" }],
        experience: [],
      },
      aiRunId,
      parserVersion: "resume-normalizer-v2",
      warnings: [{
        code: "malformed_date",
        path: "education.0.endDate",
        message: "Date should use YYYY-MM format.",
      }],
    });
    const second = persistResumeVersion(database, {
      profileId: candidate.id,
      fileName: "synthetic-resume.docx",
      filePath: "resumes/synthetic-resume.docx",
      parsedData: null,
      aiRunId: null,
      parserVersion: null,
      warnings: [],
    });

    expect(first).toMatchObject({ aiRunId, parserVersion: "resume-normalizer-v2", version: 1 });
    expect(deserializeResumeArtifacts(first)).toMatchObject({
      parsedData: { name: "Alex Rivera" },
      warnings: [{ code: "malformed_date", path: "education.0.endDate" }],
    });
    expect(second).toMatchObject({ version: 2, isCurrent: true });
    expect(database.select().from(resumes).all().map((record) => record.isCurrent))
      .toEqual([false, true]);
  });

  it("upgrades an existing resume without changing its local data", () => {
    const { database } = harness.createDatabase({ migrate: false });
    migrate(database, { migrationsFolder: migrationsThrough(18) });
    const candidate = database.insert(profile).values({ name: "Existing User" }).returning().get();
    database.insert(legacyResumes).values({
      profileId: candidate.id,
      fileName: "existing.txt",
      filePath: "resumes/existing.txt",
      parsedData: JSON.stringify({ name: "Existing User", skills: [], experience: [] }),
      version: 1,
      isCurrent: true,
    }).run();

    migrate(database, { migrationsFolder: join(process.cwd(), "drizzle") });

    const upgraded = database.select().from(resumes).get();
    expect(upgraded).toMatchObject({
      fileName: "existing.txt",
      aiRunId: null,
      parserVersion: null,
      validationWarnings: null,
    });
    expect(deserializeResumeArtifacts(upgraded!)).toMatchObject({
      parsedData: { name: "Existing User" },
      warnings: [],
    });
    const foreignKey = database.$client.prepare("PRAGMA foreign_key_list(resumes)")
      .all().find((entry) => (entry as { from?: string }).from === "ai_run_id") as
      | { on_delete?: string }
      | undefined;
    expect(foreignKey?.on_delete).toBe("NO ACTION");
  });
});
