import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { migrateLocalDatabase } from "@/lib/db/migrations";
import { aiGeneratedContent, aiWorkItems, companies, jobs, matchResults, matchSessions, scrapeMatchOutbox, scrapingLogs } from "@/lib/db/schema";
import { migrateOutdatedScraperSources } from "@/lib/db/scraper-source-migrations";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const sqlite = createSqliteTestHarness("switchy-source-migrations-");

describe("outdated scraper sources", () => {
  it("replaces legacy Visa and deletes its artifacts with cascades during a full upgrade", () => {
    const { database, connection } = sqlite.createDatabase();
    const old = database.insert(companies).values({ name: "Visa", platform: "visa",
      careersUrl: "https://www.visa.co.uk/en_gb/jobs/?cities=Bangalore" }).returning().get();
    const other = database.insert(companies).values({ name: "Other", platform: "custom",
      careersUrl: "https://example.com/jobs" }).returning().get();
    const saved = database.insert(jobs).values({ companyId: old.id, title: "Old Visa role",
      url: "https://www.visa.co.uk/en_gb/jobs/REF97308A", externalId: "visa-REF97308A", status: "applied" }).returning().get();
    const retained = database.insert(jobs).values({ companyId: other.id, title: "Keep this role",
      url: "https://example.com/job", status: "applied" }).returning().get();
    database.insert(matchResults).values({ id: "visa-match", jobId: saved.id,
      candidateFingerprint: "candidate", jobFingerprint: "job", scoringPolicyVersion: "v1",
      score: 90, breakdownJson: "{}", evidenceJson: "{}", confidence: 1, source: "test" }).run();
    database.insert(aiGeneratedContent).values({ jobId: saved.id, type: "cover_letter", content: "Old Visa letter" }).run();
    const log = database.insert(scrapingLogs).values({ companyId: old.id, status: "success" }).returning().get();
    database.insert(matchSessions).values({ id: "visa-session", companyId: old.id, triggerSource: "manual" }).run();
    database.insert(scrapeMatchOutbox).values({ id: "visa-session", scrapingLogId: log.id, companyId: old.id,
      jobIdsJson: JSON.stringify([saved.id]) }).run();
    database.insert(aiWorkItems).values({ id: "visa-work", workType: "matching", matchSessionId: "visa-session",
      companyId: old.id, scrapingLogId: log.id, payloadJson: "{}" }).run();

    migrateLocalDatabase(database, `${process.cwd()}/drizzle`);
    const first = database.select().from(companies).all();
    migrateLocalDatabase(database, `${process.cwd()}/drizzle`);

    expect(database.select().from(companies).all()).toEqual(first);
    expect(first).toHaveLength(2);
    expect(first.find((company) => company.name === "Visa")).toMatchObject({ platform: "workday",
      careersUrl: "https://visa.wd5.myworkdayjobs.com/Visa", boardToken: "visa/Visa", isActive: true });
    expect(first.some((company) => company.id === old.id)).toBe(false);
    expect(database.select().from(jobs).all()).toEqual([retained]);
    for (const table of [matchResults, aiGeneratedContent, matchSessions, scrapingLogs, scrapeMatchOutbox, aiWorkItems]) {
      expect(database.select().from(table).all()).toEqual([]);
    }
    expect(connection.pragma("foreign_key_check")).toEqual([]);
  });

  it("removes obsolete Visa rows while keeping an existing Workday configuration and its jobs", () => {
    const { database } = sqlite.createDatabase();
    const current = database.insert(companies).values({ name: "Visa", platform: "workday", isActive: false,
      careersUrl: "https://visa.wd5.myworkdayjobs.com/en-US/Visa?locationCountry=india" }).returning().get();
    database.insert(companies).values({ name: "Old Visa", platform: "visa",
      careersUrl: "https://corporate.visa.com/en/jobs/" }).run();
    const saved = database.insert(jobs).values({ companyId: current.id, title: "Current Visa role",
      url: "https://visa.wd5.myworkdayjobs.com/Visa/job/current", status: "applied" }).returning().get();
    migrateOutdatedScraperSources(database);
    migrateOutdatedScraperSources(database);
    expect(database.select().from(companies).all()).toEqual([current]);
    expect(database.select().from(jobs).all()).toEqual([saved]);
  });

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
