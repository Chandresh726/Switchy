import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies, jobs, settings, scrapeSessions, scrapingLogs } from "@/lib/db/schema";
import type { NewJob } from "@/lib/db/schema";
import type {
  IScraperRepository,
  ExistingJob,
  SessionProgressUpdate,
  ScrapeSessionCreate,
  ScrapingLogCreate,
  ScrapingLogUpdate,
  CompanyUpdate,
} from "./types";

const SCHEDULER_LOCK_KEY = "scheduler.lock";
const SCHEDULER_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

export class DrizzleScraperRepository implements IScraperRepository {
  async getCompany(id: number) {
    const [company] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, id));
    return company ?? null;
  }

  async getActiveCompanies() {
    return db
      .select()
      .from(companies)
      .where(eq(companies.isActive, true));
  }

  async getExistingJobs(companyId: number): Promise<ExistingJob[]> {
    return db
      .select({
        id: jobs.id,
        externalId: jobs.externalId,
        title: jobs.title,
        url: jobs.url,
      })
      .from(jobs)
      .where(eq(jobs.companyId, companyId));
  }

  async getSetting(key: string): Promise<string | null> {
    const [setting] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, key));
    return setting?.value ?? null;
  }

  async insertJobs(jobsToInsert: Omit<NewJob, "discoveredAt" | "updatedAt">[]): Promise<number[]> {
    if (jobsToInsert.length === 0) return [];
    
    const inserted = await db
      .insert(jobs)
      .values(jobsToInsert as NewJob[])
      .returning({ id: jobs.id });
    
    return inserted.map((j) => j.id);
  }

  async updateCompany(id: number, updates: CompanyUpdate): Promise<void> {
    await db
      .update(companies)
      .set(updates)
      .where(eq(companies.id, id));
  }

  async createSession(session: ScrapeSessionCreate): Promise<void> {
    await db.insert(scrapeSessions).values({
      id: session.id,
      triggerSource: session.triggerSource,
      status: session.status,
      companiesTotal: session.companiesTotal,
      companiesCompleted: 0,
      totalJobsFound: 0,
      totalJobsAdded: 0,
      totalJobsFiltered: 0,
    });
  }

  async updateSessionProgress(id: string, progress: SessionProgressUpdate): Promise<void> {
    await db
      .update(scrapeSessions)
      .set({
        companiesCompleted: progress.companiesCompleted,
        totalJobsFound: progress.totalJobsFound,
        totalJobsAdded: progress.totalJobsAdded,
        totalJobsFiltered: progress.totalJobsFiltered,
      })
      .where(eq(scrapeSessions.id, id));
  }

  async completeSession(id: string, hasFailures: boolean): Promise<void> {
    await db
      .update(scrapeSessions)
      .set({
        status: hasFailures ? "failed" : "completed",
        completedAt: new Date(),
      })
      .where(eq(scrapeSessions.id, id));
  }

  async createScrapingLog(log: ScrapingLogCreate): Promise<number> {
    const [inserted] = await db
      .insert(scrapingLogs)
      .values({
        companyId: log.companyId,
        sessionId: log.sessionId,
        triggerSource: log.triggerSource,
        platform: log.platform,
        status: log.status,
        jobsFound: log.jobsFound,
        jobsAdded: log.jobsAdded,
        jobsUpdated: log.jobsUpdated,
        jobsFiltered: log.jobsFiltered,
        errorMessage: log.errorMessage,
        duration: log.duration,
        completedAt: log.completedAt,
        matcherStatus: log.matcherStatus,
        matcherJobsTotal: log.matcherJobsTotal,
        matcherJobsCompleted: log.matcherJobsCompleted ?? 0,
      })
      .returning({ id: scrapingLogs.id });
    
    return inserted?.id ?? 0;
  }

  async updateScrapingLog(id: number, updates: ScrapingLogUpdate): Promise<void> {
    await db
      .update(scrapingLogs)
      .set(updates)
      .where(eq(scrapingLogs.id, id));
  }

  async acquireSchedulerLock(): Promise<boolean> {
    const existingLock = await this.getSetting(SCHEDULER_LOCK_KEY);
    
    if (existingLock) {
      const lockTime = parseInt(existingLock, 10);
      if (Date.now() - lockTime < SCHEDULER_LOCK_TIMEOUT_MS) {
        return false;
      }
    }
    
    await db
      .insert(settings)
      .values({ key: SCHEDULER_LOCK_KEY, value: Date.now().toString() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: Date.now().toString() },
      });
    
    return true;
  }

  async releaseSchedulerLock(): Promise<void> {
    await db
      .delete(settings)
      .where(eq(settings.key, SCHEDULER_LOCK_KEY));
  }
}

export function createScraperRepository(): IScraperRepository {
  return new DrizzleScraperRepository();
}
