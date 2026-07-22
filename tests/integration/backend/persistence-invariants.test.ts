import { afterEach, describe, expect, it, vi } from "vitest";

import {
  companies,
  jobs,
  people,
  peopleImportIssues,
  peopleImportSessions,
  personSourceRecords,
  profile,
  resumes,
  settings,
} from "@/lib/db/schema";
import { PersistencePreflightError, runPersistencePreflight } from "@/lib/db/persistence-preflight";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-persistence-invariants-");

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.resetModules();
});

describe("local persistence invariants", () => {
  it("allows preflight on a new empty database before the first migration", () => {
    const { database } = harness.createDatabase({ migrate: false });
    expect(runPersistencePreflight(database)).toMatchObject({
      existingSchema: false,
      profileCount: 0,
    });
  });

  it("rolls back all setting updates when one upsert fails", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    const { upsertSettings } = await import("@/lib/settings/settings-service");

    await expect(upsertSettings([
      { key: "scheduler_enabled", value: "false" },
      { key: null as never, value: "invalid" },
    ])).rejects.toThrow();
    expect(database.select().from(settings).all()).toEqual([]);
  });

  it("deduplicates repeated source identities and records the issue atomically", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    const { importPeopleCsv } = await import("@/lib/people/sync/import");
    const duplicateCsv = [
      "First Name,Last Name,Profile URL,Company,Position,Connected On",
      "Ada,Lovelace,https://linkedin.com/in/ada,Acme,Engineer,2024-01-01",
      "Ada,Lovelace,https://linkedin.com/in/ada,Acme,Engineer,2024-01-01",
    ].join("\n");

    await expect(importPeopleCsv({
      source: "linkedin",
      content: duplicateCsv,
      fileName: "connections.csv",
    })).resolves.toMatchObject({ insertedRows: 1, duplicateRows: 1 });
    expect(database.select().from(people).all()).toHaveLength(1);
    expect(database.select().from(personSourceRecords).all()).toHaveLength(1);
    expect(database.select().from(peopleImportSessions).get()).toMatchObject({
      status: "completed",
      totalRows: 2,
      duplicateRows: 1,
    });
    expect(database.select().from(peopleImportIssues).get()).toMatchObject({
      rowNumber: 3,
      kind: "duplicate",
    });
  });

  it("enforces singleton profile, resume lineage, job status, and score constraints", () => {
    const { database } = harness.createDatabase();
    const localProfile = database.insert(profile).values({ name: "Local" }).returning().get();
    expect(() => database.insert(profile).values({
      name: "Second",
      singletonKey: "alternate",
    }).run()).toThrow();
    database.insert(resumes).values({
      profileId: localProfile.id,
      fileName: "one.txt",
      filePath: "resumes/one.txt",
      parsedData: "null",
      version: 1,
      isCurrent: true,
    }).run();
    expect(() => database.insert(resumes).values({
      profileId: localProfile.id,
      fileName: "duplicate.txt",
      filePath: "resumes/duplicate.txt",
      parsedData: "null",
      version: 1,
    }).run()).toThrow();
    expect(() => database.insert(resumes).values({
      profileId: localProfile.id,
      fileName: "current.txt",
      filePath: "resumes/current.txt",
      parsedData: "null",
      version: 2,
      isCurrent: true,
    }).run()).toThrow();

    const company = database.insert(companies).values({
      name: "Acme",
      careersUrl: "https://example.com/careers",
    }).returning().get();
    expect(() => database.insert(jobs).values({
      companyId: company.id,
      title: "Invalid status",
      url: "https://example.com/jobs/invalid-status",
      status: "unknown" as never,
    }).run()).toThrow();
    expect(() => database.insert(jobs).values({
      companyId: company.id,
      title: "Invalid score",
      url: "https://example.com/jobs/invalid-score",
      matchScore: 101,
    }).run()).toThrow();
  });

  it("preflight rejects semantic company duplicates before migration", () => {
    const { database } = harness.createDatabase();
    database.insert(companies).values([
      { name: "One", careersUrl: "https://www.example.com/careers/" },
      { name: "Two", careersUrl: "https://example.com/careers" },
    ]).run();

    expect(() => runPersistencePreflight(database)).toThrow(PersistencePreflightError);
  });
});
