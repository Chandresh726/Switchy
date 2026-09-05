import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { companies, jobs } from "@/lib/db/schema";
import {
  DrizzleStaleJobArchiveStore,
  StaleJobArchivalService,
} from "@/lib/scraper/application/stale-job-archival-service";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

vi.mock("@/lib/db", () => ({ db: {} }));

const sqlite = createSqliteTestHarness("switchy-stale-archive-");
const createTestDatabase = () => sqlite.createDatabase().database;

const DAY_MS = 24 * 60 * 60 * 1000;

function seedCompany(database: ReturnType<typeof createTestDatabase>) {
  return database
    .insert(companies)
    .values({ name: "Acme", careersUrl: "https://example.com/jobs" })
    .returning({ id: companies.id })
    .get();
}

describe("stale job archival", () => {
  it("archives jobs with old postedDate or old discoveredAt, keeping user-intent statuses", async () => {
    const database = createTestDatabase();
    const company = seedCompany(database);
    const now = new Date("2026-07-13T00:00:00.000Z");
    const old = new Date(now.getTime() - 61 * DAY_MS);
    const recent = new Date(now.getTime() - 10 * DAY_MS);

    const [oldPosted, oldDiscovered, fresh, appliedOld, alreadyArchived] =
      database
        .insert(jobs)
        .values([
          {
            companyId: company.id,
            title: "Old posted",
            url: "https://example.com/old-posted",
            status: "new",
            postedDate: old,
            discoveredAt: recent,
          },
          {
            companyId: company.id,
            title: "Old discovered, null posted",
            url: "https://example.com/old-discovered",
            status: "viewed",
            postedDate: null,
            discoveredAt: old,
          },
          {
            companyId: company.id,
            title: "Fresh",
            url: "https://example.com/fresh",
            status: "new",
            postedDate: recent,
            discoveredAt: recent,
          },
          {
            companyId: company.id,
            title: "Applied but old",
            url: "https://example.com/applied-old",
            status: "applied",
            postedDate: old,
            discoveredAt: old,
          },
          {
            companyId: company.id,
            title: "Already archived",
            url: "https://example.com/archived",
            status: "archived",
            postedDate: old,
            discoveredAt: old,
          },
        ])
        .returning({ id: jobs.id })
        .all();
    void alreadyArchived;

    const store = new DrizzleStaleJobArchiveStore(database);
    const service = new StaleJobArchivalService(
      store,
      { getStaleJobArchiveDays: async () => 60 },
      () => now
    );

    const result = await service.archiveIfDue();
    expect(result).toMatchObject({ archived: 2, days: 60 });

    const rows = database
      .select({
        id: jobs.id,
        status: jobs.status,
        archiveSource: jobs.archiveSource,
      })
      .from(jobs)
      .all();
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(oldPosted.id)).toMatchObject({
      status: "archived",
      archiveSource: "stale",
    });
    expect(byId.get(oldDiscovered.id)).toMatchObject({
      status: "archived",
      archiveSource: "stale",
    });
    expect(byId.get(fresh.id)?.status).toBe("new");
    expect(byId.get(appliedOld.id)?.status).toBe("applied");

    const archivedAt = database
      .select({ archivedAt: jobs.archivedAt })
      .from(jobs)
      .where(eq(jobs.id, oldPosted.id))
      .get()?.archivedAt;
    expect(archivedAt?.getTime()).toBe(now.getTime());
  });
});
