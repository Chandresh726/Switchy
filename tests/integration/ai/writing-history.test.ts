import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it } from "vitest";

import { persistWritingVariant } from "@/lib/ai/writing/repository";
import { aiGeneratedContent, aiGenerationHistory, companies, jobs } from "@/lib/db/schema";
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

  it("upgrades existing writing history with safe defaults and preserved content", () => {
    const { database } = harness.createDatabase({ migrate: false });
    migrate(database, { migrationsFolder: migrationsThrough(17) });
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

    migrate(database, { migrationsFolder: join(process.cwd(), "drizzle") });

    const upgraded = database.select().from(aiGenerationHistory).get();
    expect(upgraded).toMatchObject({
      variant: "Existing local draft",
      source: "generated",
      aiRunId: null,
      parentVariantId: null,
    });
  });
});
