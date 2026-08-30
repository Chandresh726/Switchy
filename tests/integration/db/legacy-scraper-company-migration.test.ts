import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { migrateLegacyScraperCompanies } from "@/lib/db/migrations";
import { companies, jobs, scrapingLogs } from "@/lib/db/schema";
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
});
