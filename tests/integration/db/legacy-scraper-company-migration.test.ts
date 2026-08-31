import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { migrateLegacyScraperCompanies } from "@/lib/db/migrations";
import {
  companies,
  jobs,
  matchResults,
  matchSessionJobs,
  matchSessions,
  people,
  scrapeSessions,
  scrapingLogs,
} from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const sqlite = createSqliteTestHarness("switchy-scraper-company-migration-");
const canonicalUrl =
  "https://flipkart.turbohire.co/careerpage/4d757ba0-3d57-448a-b82c-238ed87ac90f";

describe("legacy scraper company migration", () => {
  it("migrates Flipkart in place idempotently without changing job or history counts", () => {
    const database = sqlite.createDatabase().database;
    const flipkart = database
      .insert(companies)
      .values({
        name: "Flipkart",
        careersUrl: "https://www.flipkartcareers.com/flipkart/jobslist",
        platform: "zwayam",
        boardToken: "flipkart",
      })
      .returning({ id: companies.id })
      .get();
    database.insert(jobs).values({
      companyId: flipkart.id,
      externalId: "legacy-job",
      title: "Legacy role",
      url: "https://www.flipkartcareers.com/job/legacy-job",
    }).run();
    database.insert(scrapingLogs).values({
      companyId: flipkart.id,
      status: "success",
      platform: "zwayam",
      jobsFound: 1,
    }).run();

    migrateLegacyScraperCompanies(database);
    migrateLegacyScraperCompanies(database);

    expect(database.select().from(companies).where(eq(companies.id, flipkart.id)).get()).toMatchObject({
      id: flipkart.id,
      careersUrl: canonicalUrl,
      platform: "turbohire",
      boardToken: "4d757ba0-3d57-448a-b82c-238ed87ac90f",
      isActive: true,
    });
    expect(database.select().from(jobs).where(eq(jobs.companyId, flipkart.id)).all()).toHaveLength(1);
    expect(
      database.select().from(scrapingLogs).where(eq(scrapingLogs.companyId, flipkart.id)).all()
    ).toHaveLength(1);
  });

  it("keeps an existing canonical row and deactivates all legacy rows as custom", () => {
    const database = sqlite.createDatabase().database;
    const canonical = database.insert(companies).values({
      name: "Flipkart canonical",
      careersUrl: canonicalUrl,
      platform: "custom",
    }).returning({ id: companies.id }).get();
    const legacy = database.insert(companies).values({
      name: "Flipkart",
      careersUrl: "https://www.flipkartcareers.com/flipkart/jobslist",
      platform: "zwayam",
    }).returning({ id: companies.id }).get();
    const residual = database.insert(companies).values({
      name: "Old tenant",
      careersUrl: "https://legacy.example.com/jobs",
      platform: "zwayam",
    }).returning({ id: companies.id }).get();

    migrateLegacyScraperCompanies(database);

    expect(database.select().from(companies).where(eq(companies.id, canonical.id)).get()).toMatchObject({
      platform: "turbohire",
      boardToken: "4d757ba0-3d57-448a-b82c-238ed87ac90f",
      isActive: true,
    });
    for (const id of [legacy.id, residual.id]) {
      expect(database.select().from(companies).where(eq(companies.id, id)).get()).toMatchObject({
        platform: "custom",
        isActive: false,
      });
    }
  });

  it("maps reusable ATS companies in place and preserves Nutanix job history idempotently", () => {
    const database = sqlite.createDatabase().database;
    const inputs = [
      ["Nutanix", "https://careers.nutanix.com/en/jobs/", "nutanix"],
      ["LegalZoom", "https://www.legalzoom.com/careers#open-positions", "custom"],
      ["Intuit", "https://careers.intuit.com/", "custom"],
      [
        "Goldman Sach",
        "https://higher.gs.com/results?DIVISION=Engineering%20Division",
        "custom",
      ],
      [
        "eBay",
        "https://jobs.ebayinc.com/us/en/jobs-in-india?from=40&s=1",
        "custom",
      ],
    ] as const;
    const inserted = inputs.map(([name, careersUrl, platform]) =>
      database.insert(companies).values({ name, careersUrl, platform }).returning().get()
    );
    const nutanix = inserted[0];
    if (!nutanix) throw new Error("Expected Nutanix fixture");
    const nutanixJob = database.insert(jobs).values({
      companyId: nutanix.id,
      externalId: "nutanix-nutanix-31130",
      title: "Member of Technical Staff",
      url: "https://careers.nutanix.com/en/jobs/31130",
      status: "applied",
    }).returning().get();
    database.insert(scrapeSessions).values({
      id: "scrape-session",
      triggerSource: "manual",
      status: "completed",
      companiesTotal: 1,
      companiesCompleted: 1,
    }).run();
    database.insert(scrapingLogs).values({
      companyId: nutanix.id,
      sessionId: "scrape-session",
      status: "success",
      platform: "nutanix",
      jobsFound: 1,
    }).run();
    database.insert(matchSessions).values({
      id: "match-session",
      triggerSource: "manual",
      companyId: nutanix.id,
      status: "completed",
      jobsTotal: 1,
      jobsCompleted: 1,
    }).run();
    database.insert(matchResults).values({
      id: "match-result",
      jobId: nutanixJob.id,
      candidateFingerprint: "candidate",
      jobFingerprint: "job",
      scoringPolicyVersion: "test-v1",
      score: 91,
      breakdownJson: "{}",
      evidenceJson: "{}",
      confidence: 0,
      source: "test",
    }).run();
    database.insert(matchSessionJobs).values({
      sessionId: "match-session",
      jobId: nutanixJob.id,
      analysisStatus: "ready",
      matchStatus: "completed",
      matchResultId: "match-result",
    }).run();
    database.insert(people).values({
      identityKey: "linkedin:person",
      firstName: "Test",
      lastName: "Person",
      fullName: "Test Person",
      profileUrl: "https://www.linkedin.com/in/test-person",
      profileUrlNormalized: "linkedin.com/in/test-person",
      mappedCompanyId: nutanix.id,
    }).run();

    migrateLegacyScraperCompanies(database);
    const afterFirstRun = database.select().from(companies).all();
    const updatedAtAfterFirstRun = afterFirstRun.map((company) => company.updatedAt?.getTime());
    migrateLegacyScraperCompanies(database);

    expect(database.select().from(companies).all()).toMatchObject([
      {
        id: nutanix.id,
        name: "Nutanix",
        careersUrl: "https://jobs.jobvite.com/nutanix/jobs",
        platform: "jobvite",
        boardToken: "nutanix",
      },
      {
        name: "LegalZoom",
        careersUrl: "https://jobs.jobvite.com/legalzoom/jobs",
        platform: "jobvite",
        boardToken: "legalzoom",
      },
      {
        name: "Intuit",
        careersUrl: "https://jobs.intuit.com/search-jobs",
        platform: "talentbrew",
        boardToken: "27595",
      },
      {
        name: "Goldman Sachs",
        careersUrl:
          "https://hdpc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LateralHiring/jobs",
        platform: "oracle",
        boardToken: "hdpc.fa.us2.oraclecloud.com/CX_3002",
      },
      {
        name: "eBay",
        careersUrl: "https://jobs.ebayinc.com/us/en/search-results",
        platform: "phenom",
        boardToken: "EBAEBAUS",
      },
    ]);
    expect(
      database.select().from(companies).all().map((company) => company.updatedAt?.getTime())
    ).toEqual(updatedAtAfterFirstRun);
    expect(database.select().from(jobs).where(eq(jobs.id, nutanixJob.id)).get()).toMatchObject({
      id: nutanixJob.id,
      externalId: "jobvite-nutanix-31130",
      status: "applied",
    });
    expect(database.select().from(jobs).all()).toHaveLength(1);
    expect(database.select().from(scrapingLogs).all()).toMatchObject([
      {
        companyId: nutanix.id,
        sessionId: "scrape-session",
        platform: "nutanix",
        jobsFound: 1,
      },
    ]);
    expect(database.select().from(scrapeSessions).all()).toHaveLength(1);
    expect(database.select().from(matchSessions).all()).toMatchObject([
      { id: "match-session", companyId: nutanix.id, jobsTotal: 1 },
    ]);
    expect(database.select().from(matchResults).all()).toMatchObject([
      { id: "match-result", jobId: nutanixJob.id, score: 91 },
    ]);
    expect(database.select().from(matchSessionJobs).all()).toMatchObject([
      {
        sessionId: "match-session",
        jobId: nutanixJob.id,
        matchResultId: "match-result",
      },
    ]);
    expect(database.select().from(people).all()).toMatchObject([
      { identityKey: "linkedin:person", mappedCompanyId: nutanix.id },
    ]);
  });

  it("refuses an ambiguous reusable-scraper migration", () => {
    const database = sqlite.createDatabase().database;
    database.insert(companies).values([
      {
        name: "Nutanix",
        careersUrl: "https://careers.nutanix.com/en/jobs/",
        platform: "nutanix",
      },
      {
        name: "Nutanix duplicate",
        careersUrl: "https://jobs.jobvite.com/nutanix/jobs",
        platform: "custom",
      },
    ]).run();

    expect(() => migrateLegacyScraperCompanies(database)).toThrow(
      "found 2 company rows for Nutanix"
    );
  });

  it("rejects a Nutanix identity collision before changing company data", () => {
    const database = sqlite.createDatabase().database;
    const nutanix = database.insert(companies).values({
      name: "Nutanix",
      careersUrl: "https://careers.nutanix.com/en/jobs/",
      platform: "nutanix",
    }).returning().get();
    database.insert(jobs).values([
      {
        companyId: nutanix.id,
        externalId: "nutanix-nutanix-31130",
        title: "Legacy job",
        url: "https://careers.nutanix.com/en/jobs/31130",
      },
      {
        companyId: nutanix.id,
        externalId: "jobvite-nutanix-31130",
        title: "Existing Jobvite job",
        url: "https://jobs.jobvite.com/nutanix/job/opaque",
      },
    ]).run();

    expect(() => migrateLegacyScraperCompanies(database)).toThrow(
      "jobvite-nutanix-31130 already exists"
    );
    expect(database.select().from(companies).where(eq(companies.id, nutanix.id)).get())
      .toMatchObject({
        careersUrl: "https://careers.nutanix.com/en/jobs/",
        platform: "nutanix",
      });
  });

  it("preserves an inactive company's scheduling state", () => {
    const database = sqlite.createDatabase().database;
    const ebay = database.insert(companies).values({
      name: "eBay",
      careersUrl: "https://jobs.ebayinc.com/us/en/jobs-in-india",
      platform: "custom",
      isActive: false,
    }).returning().get();

    migrateLegacyScraperCompanies(database);

    expect(database.select().from(companies).where(eq(companies.id, ebay.id)).get()).toMatchObject({
      id: ebay.id,
      careersUrl: "https://jobs.ebayinc.com/us/en/search-results",
      platform: "phenom",
      boardToken: "EBAEBAUS",
      isActive: false,
    });
  });
});
