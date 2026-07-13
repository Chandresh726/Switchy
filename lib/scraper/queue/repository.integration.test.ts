import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { companies, scrapeQueueItems, scrapeSessions } from "@/lib/db/schema";

import { DrizzleLocalScrapeQueueRepository } from "./repository";

vi.mock("@/lib/db", () => ({ db: {} }));

const openConnections: Database.Database[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const connection of openConnections.splice(0)) connection.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createQueueDatabases() {
  const directory = mkdtempSync(join(tmpdir(), "switchy-queue-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "queue.db");
  const firstConnection = new Database(databasePath);
  const secondConnection = new Database(databasePath);
  openConnections.push(firstConnection, secondConnection);

  for (const connection of [firstConnection, secondConnection]) {
    connection.pragma("journal_mode = WAL");
    connection.pragma("foreign_keys = ON");
    connection.pragma("busy_timeout = 1");
  }

  const firstDatabase = drizzle(firstConnection, { schema });
  const secondDatabase = drizzle(secondConnection, { schema });
  migrate(firstDatabase, { migrationsFolder: join(process.cwd(), "drizzle") });

  return {
    firstConnection,
    firstDatabase,
    secondDatabase,
  };
}

describe("DrizzleLocalScrapeQueueRepository", () => {
  it("retries transient SQLite contention while renewing a worker lease", async () => {
    let attempts = 0;
    const returning = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
      }
      return [{ id: "item-1" }];
    });
    const fakeDatabase = {
      update: vi.fn(() => ({
        set: () => ({
          where: () => ({ returning }),
        }),
      })),
    } as unknown as typeof db;
    const repository = new DrizzleLocalScrapeQueueRepository(fakeDatabase, {
      claimBusyRetries: 1,
      claimBusyRetryDelayMs: 0,
    });

    const renewed = await repository.heartbeat(
      "item-1",
      "worker-1",
      new Date(Date.now() + 60_000)
    );

    expect(renewed).toBe(true);
    expect(returning).toHaveBeenCalledTimes(2);
  });

  it("retries an immediate claim through lock contention and permits only one owner", async () => {
    const { firstConnection, firstDatabase, secondDatabase } = createQueueDatabases();
    const now = new Date();
    const company = firstDatabase
      .insert(companies)
      .values({ name: "Acme", careersUrl: "https://example.com/jobs" })
      .returning({ id: companies.id })
      .get();
    firstDatabase.insert(scrapeSessions).values({
      id: "session-1",
      triggerSource: "manual",
      companiesTotal: 1,
    }).run();

    const firstRepository = new DrizzleLocalScrapeQueueRepository(firstDatabase, {
      claimBusyRetries: 3,
      claimBusyRetryDelayMs: 2,
    });
    const secondRepository = new DrizzleLocalScrapeQueueRepository(secondDatabase, {
      claimBusyRetries: 3,
      claimBusyRetryDelayMs: 2,
    });
    await firstRepository.enqueue({ sessionId: "session-1", companyIds: [company.id] });

    let contenderClaim: Promise<typeof scrapeQueueItems.$inferSelect | null> | undefined;
    firstConnection.transaction(() => {
      contenderClaim = secondRepository.claimNext("worker-2", now, 60_000);
    }).immediate();

    const claimed = await contenderClaim;
    const duplicateClaim = await firstRepository.claimNext("worker-1", now, 60_000);

    expect(claimed).toMatchObject({ status: "running", workerId: "worker-2" });
    expect(duplicateClaim).toBeNull();
    expect(firstDatabase.select().from(scrapeQueueItems).all()).toHaveLength(1);
  });

  it("releases a lease without consuming an attempt", async () => {
    const { firstDatabase } = createQueueDatabases();
    const company = firstDatabase
      .insert(companies)
      .values({ name: "Acme", careersUrl: "https://example.com/jobs" })
      .returning({ id: companies.id })
      .get();
    firstDatabase.insert(scrapeSessions).values({
      id: "session-1",
      triggerSource: "manual",
      companiesTotal: 1,
    }).run();
    const repository = new DrizzleLocalScrapeQueueRepository(firstDatabase);
    await repository.enqueue({ sessionId: "session-1", companyIds: [company.id] });
    const claimed = await repository.claimNext("worker-1", new Date(), 60_000);

    const released = await repository.release(
      claimed!.id,
      "worker-1",
      claimed!.attemptCount,
      new Date()
    );
    const stored = firstDatabase.select().from(scrapeQueueItems).get();

    expect(released).toBe(true);
    expect(stored).toMatchObject({
      status: "queued",
      attemptCount: 0,
      workerId: null,
      leaseExpiresAt: null,
    });
  });
});
