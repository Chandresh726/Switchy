import { eq, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { scrapeFetchState } from "@/lib/db/schema";

import type { ScrapeFetchStateStore } from "./fetch-state";

export class DrizzleScrapeFetchStateStore implements ScrapeFetchStateStore {
  constructor(private readonly database: typeof db = db) {}

  get(key: string): unknown {
    const row = this.database.select().from(scrapeFetchState)
      .where(eq(scrapeFetchState.key, key)).get();
    if (!row || row.expiresAt.getTime() <= Date.now()) return undefined;
    try {
      return JSON.parse(row.value);
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown, expiresAt: Date): void {
    this.database.transaction((tx) => {
      tx.delete(scrapeFetchState).where(lte(scrapeFetchState.expiresAt, new Date())).run();
      tx.insert(scrapeFetchState).values({ key, value: JSON.stringify(value), expiresAt })
        .onConflictDoUpdate({ target: scrapeFetchState.key, set: { value: JSON.stringify(value), expiresAt } }).run();
    });
  }

  delete(key: string): void {
    this.database.delete(scrapeFetchState).where(eq(scrapeFetchState.key, key)).run();
  }

  mutate<T>(key: string, expiresAt: Date, update: (previous: unknown) => T): T {
    return this.database.transaction((tx) => {
      const row = tx.select().from(scrapeFetchState).where(eq(scrapeFetchState.key, key)).get();
      let previous: unknown;
      if (row && row.expiresAt.getTime() > Date.now()) {
        try { previous = JSON.parse(row.value); } catch { /* Treat invalid cache data as absent. */ }
      }
      const value = update(previous);
      tx.insert(scrapeFetchState).values({ key, value: JSON.stringify(value), expiresAt })
        .onConflictDoUpdate({ target: scrapeFetchState.key, set: { value: JSON.stringify(value), expiresAt } }).run();
      return value;
    }, { behavior: "immediate" });
  }
}
