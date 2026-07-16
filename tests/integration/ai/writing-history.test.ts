import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearWritingHistory,
  getWritingHistoryContents,
} from "@/lib/ai/observability/writing-history";
import { persistWritingVariant } from "@/lib/ai/writing/repository";
import {
  aiGeneratedContent,
  aiGenerationHistory,
  aiRuns,
  companies,
  jobs,
} from "@/lib/db/schema";
import { migrateLocalDatabase } from "@/lib/db/migrations";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-writing-history-");
const temporaryMigrationFolders: string[] = [];
const preWritingHistory = sqliteTable("aiGenerationHistory", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contentId: integer("content_id").notNull(),
  variant: text("variant").notNull(),
  userPrompt: text("user_prompt"),
  parentVariantId: integer("parent_variant_id"),
  createdAt: integer("created_at", { mode: "timestamp" }),
});

afterEach(() => {
  for (const folder of temporaryMigrationFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

function migrationsThrough(maxIndex: number): string {
  const source = join(process.cwd(), "drizzle");
  const destination = mkdtempSync(join(tmpdir(), "switchy-writing-migrations-"));
  temporaryMigrationFolders.push(destination);
  mkdirSync(join(destination, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(join(source, "meta", "_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const entries = journal.entries.filter((entry) => entry.idx <= maxIndex);
  for (const entry of entries) {
    cpSync(join(source, `${entry.tag}.sql`), join(destination, `${entry.tag}.sql`));
  }
  writeFileSync(
    join(destination, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries })
  );
  return destination;
}

function insertJob(database: ReturnType<typeof harness.createDatabase>["database"]) {
  const company = database.insert(companies).values({
    name: "Example",
    careersUrl: "https://example.com/careers",
  }).returning().get();
  return database.insert(jobs).values({
    companyId: company.id,
    title: "Staff Engineer",
    description: "Build reliable systems",
    url: "https://example.com/jobs/staff-engineer",
  }).returning().get();
}

describe("AI writing history persistence", () => {
  it("persists generated and edited variants atomically with lineage and edit metadata", () => {
    const { database } = harness.createDatabase();
    const job = insertJob(database);
    const initial = persistWritingVariant(database, {
      jobId: job.id,
      type: "cover_letter",
      text: "I build reliable distributed systems for growing teams.",
      settingsSnapshot: '{"tone":"professional"}',
      userPrompt: null,
      parentVariant: null,
      aiRunId: null,
      source: "generated",
    });
    const parent = initial.history[0];
    expect(parent).toBeDefined();

    const edited = persistWritingVariant(database, {
      jobId: job.id,
      type: "cover_letter",
      text: "I build reliable distributed systems for ambitious growing teams.",
      settingsSnapshot: null,
      userPrompt: "Make it warmer",
      parentVariant: parent!,
      aiRunId: null,
      source: "manual_edit",
    });

    const variants = edited.history;
    expect(variants).toHaveLength(2);
    expect(variants[1]).toMatchObject({
      parentVariantId: variants[0].id,
      source: "manual_edit",
      userPrompt: "Make it warmer",
    });
    expect(variants[1].editDistance).toBeGreaterThan(0);
    expect(variants[1].editDistanceRatio).toBeGreaterThan(0);
  });

  it("rolls back the content insert when the history insert fails", () => {
    const { database } = harness.createDatabase();
    const job = insertJob(database);

    expect(() => persistWritingVariant(database, {
      jobId: job.id,
      type: "referral",
      text: "Could you refer me for this role?",
      settingsSnapshot: null,
      userPrompt: null,
      parentVariant: null,
      aiRunId: "missing-run",
      source: "generated",
    })).toThrow();

    expect(database.select().from(aiGeneratedContent)
      .where(eq(aiGeneratedContent.jobId, job.id)).all()).toEqual([]);
    expect(database.select().from(aiGenerationHistory).all()).toEqual([]);
  });

  it("upgrades existing writing history with safe defaults and preserved content", async () => {
    const { database } = harness.createDatabase({ migrate: false });
    migrateLocalDatabase(database, migrationsThrough(17));
    const job = insertJob(database);
    const content = database.insert(aiGeneratedContent).values({
      jobId: job.id,
      type: "referral",
      content: "Existing local draft",
    }).returning().get();
    database.insert(preWritingHistory).values({
      contentId: content.id,
      variant: "Existing local draft",
    }).run();

    migrateLocalDatabase(database, join(process.cwd(), "drizzle"));

    const upgraded = database.select().from(aiGenerationHistory).get();
    expect(upgraded).toMatchObject({
      variant: "Existing local draft",
      source: "generated",
      aiRunId: null,
      parentVariantId: null,
    });
    const firstRead = await getWritingHistoryContents(database);
    const secondRead = await getWritingHistoryContents(database);
    expect(firstRead[0]?.history[0]?.createdAt).toBe(content.createdAt?.toISOString());
    expect(secondRead[0]?.history[0]?.createdAt).toBe(firstRead[0]?.history[0]?.createdAt);
  });

  it("loads and atomically clears more than one SQLite parameter chunk", async () => {
    const { database } = harness.createDatabase();
    const count = 401;
    const company = database.insert(companies).values({
      name: "History Scale Test",
      careersUrl: "https://example.com/history-scale",
    }).returning().get();
    const timestamps = Array.from(
      { length: count },
      (_, index) => new Date(1_700_000_000_000 + index * 1_000)
    );

    const jobRows = Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      companyId: company.id,
      title: `Role ${index + 1}`,
      description: "Build reliable local software",
      url: `https://example.com/jobs/${index + 1}`,
    }));
    for (let index = 0; index < jobRows.length; index += 50) {
      database.insert(jobs).values(jobRows.slice(index, index + 50)).run();
    }

    const runRows = Array.from({ length: count }, (_, index) => ({
      id: `writing-run-${index + 1}`,
      capability: "writing_cover_letter",
      providerRecordId: "provider-1",
      provider: "openai",
      modelId: "synthetic-model",
      promptVersion: "writing-v1",
      schemaVersion: "writing-v1",
      policyVersion: "writing-v1",
      inputFingerprint: (index + 1).toString(16).padStart(64, "0"),
      status: "succeeded",
      attemptCount: 1,
      totalTokens: 100,
      durationMs: 250,
      finishReason: "stop",
      qualityResult: "passed",
      startedAt: timestamps[index]!,
      completedAt: timestamps[index]!,
      createdAt: timestamps[index]!,
    }));
    for (let index = 0; index < runRows.length; index += 25) {
      database.insert(aiRuns).values(runRows.slice(index, index + 25)).run();
    }

    const contentRows = Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      jobId: index + 1,
      type: "cover_letter",
      content: `Draft ${index + 1}`,
      createdAt: timestamps[index]!,
      updatedAt: timestamps[index]!,
    }));
    for (let index = 0; index < contentRows.length; index += 50) {
      database.insert(aiGeneratedContent)
        .values(contentRows.slice(index, index + 50))
        .run();
    }

    const historyRows = Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      contentId: index + 1,
      variant: `Draft ${index + 1}`,
      aiRunId: `writing-run-${index + 1}`,
      source: "generated",
      createdAt: timestamps[index]!,
    }));
    for (let index = 0; index < historyRows.length; index += 50) {
      database.insert(aiGenerationHistory)
        .values(historyRows.slice(index, index + 50))
        .run();
    }

    const contents = await getWritingHistoryContents(database);

    expect(contents).toHaveLength(count);
    expect(contents.map((content) => content.id)).toEqual(
      Array.from({ length: count }, (_, index) => count - index)
    );
    expect(contents.map((content) => content.history.map((history) => history.aiRunId)))
      .toEqual(Array.from(
        { length: count },
        (_, index) => [`writing-run-${count - index}`]
      ));
    expect(contents[0]).toMatchObject({
      id: count,
      history: [{
        aiRunId: `writing-run-${count}`,
        aiRun: {
          id: `writing-run-${count}`,
          modelId: "synthetic-model",
        },
      }],
    });
    expect(contents[count - 1]).toMatchObject({
      id: 1,
      history: [{
        aiRunId: "writing-run-1",
        aiRun: { id: "writing-run-1", modelId: "synthetic-model" },
      }],
    });

    clearWritingHistory(database);

    expect(database.select().from(aiGenerationHistory).all()).toEqual([]);
    expect(database.select().from(aiGeneratedContent).all()).toEqual([]);
    expect(database.select().from(aiRuns).all()).toHaveLength(count);
    expect(database.select().from(jobs).all()).toHaveLength(count);
  });
});
