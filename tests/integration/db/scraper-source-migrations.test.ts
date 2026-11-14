import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { companies, jobs, scrapingLogs } from "@/lib/db/schema";
import { migrateOutdatedScraperSources } from "@/lib/db/scraper-source-migrations";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const sqlite = createSqliteTestHarness("switchy-source-migrations-");

describe("outdated scraper sources", () => {
  it("updates known retired sources in place and preserves linked records and disabled state", () => {
    const { database } = sqlite.createDatabase();
    const postman = database.insert(companies).values({ name: "Postman", careersUrl: "https://job-boards.greenhouse.io/postman", platform: "greenhouse", boardToken: "postman", isActive: false }).returning().get();
    const swiggy = database.insert(companies).values({ name: "Swiggy", careersUrl: "https://careers.swiggy.com/#/careers", platform: "mynexthire", boardToken: "swiggy" }).returning().get();
    const job = database.insert(jobs).values({ companyId: postman.id, title: "Saved role", url: "https://example.com/saved", externalId: "old-postman-job", status: "applied" }).returning().get();
    database.insert(scrapingLogs).values({ companyId: postman.id, status: "success", jobsFound: 1 }).run();

    migrateOutdatedScraperSources(database);
    const first = database.select().from(companies).all();
    migrateOutdatedScraperSources(database);

    expect(database.select().from(companies).all()).toEqual(first);
    expect(first.find((c) => c.id === postman.id)).toMatchObject({ platform: "workday", boardToken: "postman/careers", careersUrl: "https://postman.wd108.myworkdayjobs.com/careers", isActive: false });
    expect(first.find((c) => c.id === swiggy.id)).toMatchObject({ platform: "smartrecruiters", boardToken: "SWIGGY", isActive: true });
    expect(database.select().from(jobs).get()).toEqual(job);
    expect(database.select().from(scrapingLogs).all()).toHaveLength(1);
  });

  it("retires obsolete duplicates without changing the existing filtered replacement or its activity", () => {
    const { database } = sqlite.createDatabase();
    const replacement = database.insert(companies).values({ name: "JioStar", careersUrl: "https://jiostar.wd102.myworkdayjobs.com/JioStar?jobFamilyGroup=engineering", platform: "workday", isActive: false }).returning().get();
    const old = database.insert(companies).values({ name: "JioHotstar", careersUrl: "https://jobs.lever.co/jiostar", platform: "lever" }).returning().get();
    const job = database.insert(jobs).values({ companyId: old.id, title: "Applied role", url: "https://example.com/applied", status: "applied" }).returning().get();

    migrateOutdatedScraperSources(database);

    expect(database.select().from(companies).where(eq(companies.id, old.id)).get()?.isActive).toBe(false);
    expect(database.select().from(companies).where(eq(companies.id, replacement.id)).get()).toEqual(replacement);
    expect(database.select().from(jobs).get()).toEqual(job);
  });

  it("migrates a lone JioHotstar row and leaves custom or unrelated sources untouched", () => {
    const { database } = sqlite.createDatabase();
    const old = database.insert(companies).values({ name: "JioHotstar", careersUrl: "https://jobs.lever.co/jiostar", platform: "lever" }).returning().get();
    const other = database.insert(companies).values({ name: "Postman", careersUrl: "https://example.com/custom", platform: "custom" }).returning().get();
    migrateOutdatedScraperSources(database);
    expect(database.select().from(companies).where(eq(companies.id, old.id)).get()).toMatchObject({ platform: "workday", boardToken: "jiostar/JioStar", isActive: true });
    expect(database.select().from(companies).where(eq(companies.id, other.id)).get()).toEqual(other);
  });
});
