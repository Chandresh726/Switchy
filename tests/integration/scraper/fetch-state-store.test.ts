import { describe, expect, it, vi } from "vitest";

import { DrizzleScrapeFetchStateStore } from "@/lib/scraper/infrastructure/fetch-state-store";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

vi.mock("@/lib/db", () => ({ db: {} }));

const sqlite = createSqliteTestHarness("switchy-fetch-state-");

describe("persistent scrape fetch state", () => {
  it("survives another connection and expires checkpoints without sharing query scopes", () => {
    const first = sqlite.createDatabase();
    const store = new DrizzleScrapeFetchStateStore(first.database);
    store.set("pages:india", { offsets: [0, 20] }, new Date(Date.now() + 60_000));
    const reopened = new DrizzleScrapeFetchStateStore(sqlite.connect(first.path).database);
    expect(reopened.get("pages:india")).toEqual({ offsets: [0, 20] });
    expect(reopened.get("pages:global")).toBeUndefined();
    store.set("pages:india", {}, new Date(Date.now() - 1_000));
    expect(reopened.get("pages:india")).toBeUndefined();
  });
});
