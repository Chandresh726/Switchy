import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const preCanonicalCompanies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  careersUrl: text("careers_url").notNull(),
});

export const preMatchColumnsJobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  status: text("status").notNull(),
  matchScore: integer("match_score"),
  matchReasons: text("match_reasons"),
});

/** Minimal job shape for seeding historical databases before scraper timestamps. */
export const preScraperFreshnessJobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  url: text("url").notNull(),
  status: text("status").notNull().default("new"),
});
