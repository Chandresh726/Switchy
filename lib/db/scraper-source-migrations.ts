import { eq, inArray, or } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { VISA_WORKDAY_BOARD_TOKEN, VISA_WORKDAY_URL } from "@/lib/companies/visa-source";

import type * as schema from "./schema";
import { aiWorkItems, companies, matchSessions, scrapeMatchOutbox, scrapingLogs } from "./schema";

interface ScraperSourceMigration {
  previousPlatform: string;
  previousUrls: string[];
  careersUrl: string;
  platform: string;
  boardToken: string;
}

const SOURCE_MIGRATIONS: ScraperSourceMigration[] = [
  {
    previousPlatform: "greenhouse",
    previousUrls: ["https://job-boards.greenhouse.io/postman", "https://boards.greenhouse.io/postman"],
    careersUrl: "https://postman.wd108.myworkdayjobs.com/careers",
    platform: "workday",
    boardToken: "postman/careers",
  },
  {
    previousPlatform: "mynexthire",
    previousUrls: ["https://careers.swiggy.com/", "https://swiggy.mynexthire.com/employer/jobs"],
    careersUrl: "https://jobs.smartrecruiters.com/SWIGGY",
    platform: "smartrecruiters",
    boardToken: "SWIGGY",
  },
  {
    previousPlatform: "lever",
    previousUrls: ["https://jobs.lever.co/jiostar"],
    careersUrl: "https://jiostar.wd102.myworkdayjobs.com/en-US/JioStar",
    platform: "workday",
    boardToken: "jiostar/JioStar",
  },
];

function sourceIdentity(value: string): string {
  try {
    const url = new URL(value);
    // Locale and query facets do not change the identity of a Workday board.
    const path = url.pathname.replace(/^\/[a-z]{2}-[a-z]{2}(?=\/)/i, "").replace(/\/+$/, "");
    return `${url.hostname}${path}`.toLowerCase();
  } catch {
    return value;
  }
}

/** Replace retired sources; legacy Visa is intentionally reset as a new company. */
export function migrateOutdatedScraperSources(
  database: BetterSQLite3Database<typeof schema>
): void {
  database.transaction((tx) => {
    const stored = tx.select({ id: companies.id, careersUrl: companies.careersUrl, platform: companies.platform, isActive: companies.isActive }).from(companies).all();
    const now = new Date();
    const retiredVisa = stored.filter((company) => company.platform === "visa");
    if (retiredVisa.length) {
      const ids = retiredVisa.map((company) => company.id);
      const legacyLogs = tx.select({ id: scrapingLogs.id }).from(scrapingLogs)
        .where(inArray(scrapingLogs.companyId, ids));
      // Remove restrictive work references before company/job cascades. Run with
      // foreign keys enabled so all job artifacts are deleted with their owner.
      tx.delete(aiWorkItems).where(or(inArray(aiWorkItems.companyId, ids),
        inArray(aiWorkItems.scrapingLogId, legacyLogs))).run();
      tx.delete(scrapeMatchOutbox).where(or(inArray(scrapeMatchOutbox.companyId, ids),
        inArray(scrapeMatchOutbox.scrapingLogId, legacyLogs))).run();
      tx.delete(matchSessions).where(inArray(matchSessions.companyId, ids)).run();
      tx.delete(companies).where(inArray(companies.id, ids)).run();
      const replacement = stored.find((company) => company.platform !== "visa" &&
        sourceIdentity(company.careersUrl) === sourceIdentity(VISA_WORKDAY_URL));
      if (!replacement) tx.insert(companies).values({ name: "Visa", careersUrl: VISA_WORKDAY_URL,
        platform: "workday", boardToken: VISA_WORKDAY_BOARD_TOKEN,
        logoUrl: "https://cdn-icons-png.flaticon.com/512/5968/5968397.png" }).run();
    }
    for (const migration of SOURCE_MIGRATIONS) {
      const retired = stored.filter((company) =>
        company.platform === migration.previousPlatform &&
        migration.previousUrls.some((url) => sourceIdentity(url) === sourceIdentity(company.careersUrl))
      );
      let replacement = stored.find((company) =>
        sourceIdentity(company.careersUrl) === sourceIdentity(migration.careersUrl)
      );
      for (const company of retired) {
        if (replacement) {
          // Keep both histories rather than merging or deleting linked records.
          if (company.isActive) {
            tx.update(companies).set({ isActive: false, updatedAt: now })
              .where(eq(companies.id, company.id)).run();
          }
        } else {
          tx.update(companies).set({
            careersUrl: migration.careersUrl,
            platform: migration.platform,
            boardToken: migration.boardToken,
            updatedAt: now,
          }).where(eq(companies.id, company.id)).run();
          replacement = company;
        }
      }
    }
  }, { behavior: "immediate" });
}
