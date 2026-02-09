import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

// Ensure data directory exists
const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "switchy.db");
const sqlite = new Database(dbPath);

// Enable WAL mode for better performance
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });

// Initialize database tables
export function initializeDatabase() {
  sqlite.exec(`
    -- Profile table
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      location TEXT,
      linkedin_url TEXT,
      github_url TEXT,
      portfolio_url TEXT,
      resume_path TEXT,
      summary TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );

    -- Skills table
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER REFERENCES profile(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT,
      proficiency INTEGER NOT NULL DEFAULT 3,
      years_of_experience REAL
    );

    -- Experience table
    CREATE TABLE IF NOT EXISTS experience (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER REFERENCES profile(id) ON DELETE CASCADE,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      location TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT,
      description TEXT,
      highlights TEXT
    );

    -- Education table
    CREATE TABLE IF NOT EXISTS education (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER REFERENCES profile(id) ON DELETE CASCADE,
      institution TEXT NOT NULL,
      degree TEXT NOT NULL,
      field TEXT,
      start_date TEXT,
      end_date TEXT,
      gpa TEXT,
      honors TEXT
    );

    -- Companies table
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      careers_url TEXT NOT NULL,
      logo_url TEXT,
      platform TEXT,
      description TEXT,
      location TEXT,
      industry TEXT,
      size TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_scraped_at INTEGER,
      scrape_frequency INTEGER DEFAULT 6,
      created_at INTEGER,
      updated_at INTEGER
    );

    -- Jobs table
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      external_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      url TEXT NOT NULL,
      location TEXT,
      location_type TEXT,
      salary TEXT,
      department TEXT,
      employment_type TEXT,
      seniority_level TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      match_score REAL,
      match_reasons TEXT,
      matched_skills TEXT,
      missing_skills TEXT,
      recommendations TEXT,
      posted_date INTEGER,
      discovered_at INTEGER,
      updated_at INTEGER,
      viewed_at INTEGER,
      applied_at INTEGER
    );

    -- Create indexes for jobs
    CREATE INDEX IF NOT EXISTS idx_jobs_company_id ON jobs(company_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_match_score ON jobs(match_score DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_posted_date ON jobs(posted_date DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_external_id ON jobs(external_id);

    -- Job requirements table
    CREATE TABLE IF NOT EXISTS job_requirements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      requirement TEXT NOT NULL,
      type TEXT,
      category TEXT
    );

    -- Scraping logs table
    CREATE TABLE IF NOT EXISTS scraping_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      jobs_found INTEGER DEFAULT 0,
      jobs_added INTEGER DEFAULT 0,
      jobs_updated INTEGER DEFAULT 0,
      error_message TEXT,
      duration INTEGER,
      started_at INTEGER,
      completed_at INTEGER
    );

    -- Settings table
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER
    );
  `);
}

// Initialize on import
initializeDatabase();

export { schema };
