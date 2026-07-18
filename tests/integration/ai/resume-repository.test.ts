import { rmSync } from "node:fs";
import { join } from "node:path";

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it } from "vitest";

import {
  deserializeResumeArtifacts,
  persistResumeVersion,
} from "@/lib/ai/resume/repository";
import {
  aiRuns,
  companies,
  education,
  experience,
  jobs,
  profile,
  resumes,
  scrapeSessions,
  skills,
} from "@/lib/db/schema";
import { migrateLocalDatabase } from "@/lib/db/migrations";
import { runPersistencePreflight } from "@/lib/db/persistence-preflight";
import { createMigrationsThrough } from "@test/helpers/migrations";
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
const legacyProfile = sqliteTable("profile", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
});

afterEach(() => {
  for (const folder of temporaryMigrationFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

function migrationsThrough(maxIndex: number): string {
  const destination = createMigrationsThrough(maxIndex, "switchy-resume-migrations-");
  temporaryMigrationFolders.push(destination);
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
      storageState: "ready",
      stagingPath: null,
      isCurrent: true,
    });
    const second = persistResumeVersion(database, {
      profileId: candidate.id,
      fileName: "synthetic-resume.docx",
      filePath: "resumes/synthetic-resume.docx",
      parsedData: null,
      aiRunId: null,
      parserVersion: null,
      warnings: [],
      storageState: "ready",
      stagingPath: null,
      isCurrent: true,
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

  it("upgrades a populated migration-24 database without changing resume data", () => {
    const { connection, database } = harness.createDatabase({ migrate: false });
    migrateLocalDatabase(database, migrationsThrough(24));
    const candidate = database.insert(legacyProfile).values({ name: "Existing User" }).returning().get();
    database.insert(legacyResumes).values({
      profileId: candidate.id,
      fileName: "existing.txt",
      filePath: "resumes/existing.txt",
      parsedData: JSON.stringify({ name: "Existing User", skills: [], experience: [] }),
      version: 1,
      isCurrent: true,
    }).run();
    database.insert(skills).values({ profileId: candidate.id, name: "TypeScript" }).run();
    database.insert(experience).values({
      profileId: candidate.id,
      company: "Acme",
      title: "Engineer",
      startDate: "2024-01",
    }).run();
    database.insert(education).values({
      profileId: candidate.id,
      institution: "Example University",
      degree: "BS",
    }).run();
    const company = database.insert(companies).values({
      name: "Acme",
      careersUrl: "https://example.com/careers",
    }).returning().get();
    database.insert(jobs).values({
      companyId: company.id,
      title: "Engineer",
      url: "https://example.com/jobs/1",
      status: "interested",
      matchScore: 82,
    }).run();
    database.insert(scrapeSessions).values({
      id: "migration-24-session",
      triggerSource: "manual",
      companiesTotal: 1,
      companiesCompleted: 1,
    }).run();
    const countsBefore = {
      profiles: database.select().from(legacyProfile).all().length,
      resumes: database.select().from(legacyResumes).all().length,
      skills: database.select().from(skills).all().length,
      experience: database.select().from(experience).all().length,
      education: database.select().from(education).all().length,
      companies: database.select().from(companies).all().length,
      jobs: database.select().from(jobs).all().length,
      scrapeSessions: database.select().from(scrapeSessions).all().length,
    };

    expect(runPersistencePreflight(database)).toMatchObject({
      existingSchema: true,
      profileCount: 1,
      profilesWithMultipleCurrentResumes: 0,
      invalidJobStatuses: 0,
      invalidMatchScores: 0,
    });

    migrateLocalDatabase(database, join(process.cwd(), "drizzle"));

    expect({
      profiles: database.select().from(profile).all().length,
      resumes: database.select().from(resumes).all().length,
      skills: database.select().from(skills).all().length,
      experience: database.select().from(experience).all().length,
      education: database.select().from(education).all().length,
      companies: database.select().from(companies).all().length,
      jobs: database.select().from(jobs).all().length,
      scrapeSessions: database.select().from(scrapeSessions).all().length,
    }).toEqual(countsBefore);

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
    expect(connection.pragma("foreign_key_check")).toEqual([]);
    expect(connection.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    expect(() => database.insert(profile).values({
      name: "Second profile",
      singletonKey: "alternate",
    }).run()).toThrow();
    expect(() => database.insert(resumes).values({
      profileId: candidate.id,
      fileName: "duplicate-current.txt",
      filePath: "resumes/duplicate-current.txt",
      parsedData: "null",
      version: 2,
      isCurrent: true,
    }).run()).toThrow();
    expect(() => database.insert(jobs).values({
      companyId: company.id,
      title: "Invalid",
      url: "https://example.com/jobs/invalid",
      status: "invalid" as never,
    }).run()).toThrow();
  });
});
