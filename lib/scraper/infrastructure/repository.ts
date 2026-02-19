import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
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

interface SchedulerLockPayload {
  ownerId: string;
  token: string;
  expiresAt: number;
}

function parseSchedulerLock(value: string | null): SchedulerLockPayload | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as SchedulerLockPayload;
    if (
      typeof parsed.ownerId !== "string" ||
      typeof parsed.token !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function createSchedulerLockValue(payload: SchedulerLockPayload): string {
  return JSON.stringify(payload);
}

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

  async reopenScraperArchivedJobs(companyId: number, openExternalIds: string[]): Promise<number> {
    if (openExternalIds.length === 0) return 0;

    const reopened = await db
      .update(jobs)
      .set({
        status: "new",
        archivedAt: null,
        archiveSource: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(jobs.companyId, companyId),
          eq(jobs.status, "archived"),
          eq(jobs.archiveSource, "scraper"),
          inArray(jobs.externalId, openExternalIds)
        )
      )
      .returning({ id: jobs.id });

    return reopened.length;
  }

  async archiveMissingJobs(
    companyId: number,
    openExternalIds: string[],
    statusesToArchive: string[]
  ): Promise<number> {
    if (statusesToArchive.length === 0) return 0;

    const baseConditions = [
      eq(jobs.companyId, companyId),
      isNotNull(jobs.externalId),
      inArray(jobs.status, statusesToArchive),
    ] as const;

    const whereClause = openExternalIds.length > 0
      ? and(...baseConditions, notInArray(jobs.externalId, openExternalIds))
      : and(...baseConditions);

    const archived = await db
      .update(jobs)
      .set({
        status: "archived",
        archivedAt: new Date(),
        archiveSource: "scraper",
        updatedAt: new Date(),
      })
      .where(whereClause)
      .returning({ id: jobs.id });

    return archived.length;
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

  async acquireSchedulerLock(ownerId: string): Promise<string | null> {
    const now = Date.now();
    const currentRaw = await this.getSetting(SCHEDULER_LOCK_KEY);
    const currentLock = parseSchedulerLock(currentRaw);
    const hasUnexpiredLock = currentLock && currentLock.expiresAt > now;

    if (hasUnexpiredLock) {
      return null;
    }

    const token = crypto.randomUUID();
    const nextLock: SchedulerLockPayload = {
      ownerId,
      token,
      expiresAt: now + SCHEDULER_LOCK_TIMEOUT_MS,
    };
    const nextRaw = createSchedulerLockValue(nextLock);

    if (!currentRaw) {
      await db
        .insert(settings)
        .values({
          key: SCHEDULER_LOCK_KEY,
          value: nextRaw,
          updatedAt: new Date(),
        })
        .onConflictDoNothing();

      const persistedRaw = await this.getSetting(SCHEDULER_LOCK_KEY);
      return persistedRaw === nextRaw ? token : null;
    }

    await db
      .update(settings)
      .set({ value: nextRaw, updatedAt: new Date() })
      .where(and(eq(settings.key, SCHEDULER_LOCK_KEY), eq(settings.value, currentRaw)));

    const persistedRaw = await this.getSetting(SCHEDULER_LOCK_KEY);
    return persistedRaw === nextRaw ? token : null;
  }

  async refreshSchedulerLock(lockToken: string): Promise<string | null> {
    const currentRaw = await this.getSetting(SCHEDULER_LOCK_KEY);
    const currentLock = parseSchedulerLock(currentRaw);

    if (!currentRaw || !currentLock || currentLock.token !== lockToken) {
      return null;
    }

    const nextLock: SchedulerLockPayload = {
      ...currentLock,
      expiresAt: Date.now() + SCHEDULER_LOCK_TIMEOUT_MS,
    };
    const nextRaw = createSchedulerLockValue(nextLock);

    await db
      .update(settings)
      .set({ value: nextRaw, updatedAt: new Date() })
      .where(and(eq(settings.key, SCHEDULER_LOCK_KEY), eq(settings.value, currentRaw)));

    const persistedRaw = await this.getSetting(SCHEDULER_LOCK_KEY);
    return persistedRaw === nextRaw ? lockToken : null;
  }

  async releaseSchedulerLock(lockToken: string): Promise<void> {
    const currentRaw = await this.getSetting(SCHEDULER_LOCK_KEY);
    const currentLock = parseSchedulerLock(currentRaw);

    if (!currentRaw || !currentLock || currentLock.token !== lockToken) {
      return;
    }

    await db
      .delete(settings)
      .where(and(eq(settings.key, SCHEDULER_LOCK_KEY), eq(settings.value, currentRaw)));
  }
}

export function createScraperRepository(): IScraperRepository {
  return new DrizzleScraperRepository();
}
