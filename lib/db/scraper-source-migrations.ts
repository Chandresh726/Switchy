import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type * as schema from "./schema";
import { companies } from "./schema";

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

/** Only known retired URLs are changed. Job, application and history IDs stay intact. */
export function migrateOutdatedScraperSources(
  database: BetterSQLite3Database<typeof schema>
): void {
  database.transaction((tx) => {
    const stored = tx.select().from(companies).all();
    const now = new Date();
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
