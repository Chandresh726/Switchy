import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies, jobs, settings, scrapeSessions, scrapingLogs } from "@/lib/db/schema";
import type { NewJob } from "@/lib/db/schema";
import type { ScrapedJob } from "@/lib/scraper/types";
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
        status: jobs.status,
        description: jobs.description,
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
      .onConflictDoNothing()
      .returning({ id: jobs.id });
    
    return inserted.map((j) => j.id);
  }

  async updateExistingJobsFromScrape(
    updates: Array<{ existingJobId: number; job: ScrapedJob }>
  ): Promise<number> {
    if (updates.length === 0) return 0;

    let updatedCount = 0;

    for (const { existingJobId, job } of updates) {
      const updated = await db
        .update(jobs)
        .set({
          title: job.title,
          url: job.url,
          location: job.location,
          locationType: job.locationType,
          department: job.department,
          description: job.description,
          descriptionFormat: job.descriptionFormat ?? "plain",
          salary: job.salary,
          employmentType: job.employmentType,
          postedDate: job.postedDate,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, existingJobId))
        .returning({ id: jobs.id });

      updatedCount += updated.length;
    }

    return updatedCount;
  }

  async getMatchableJobIds(jobIds: number[]): Promise<number[]> {
    if (jobIds.length === 0) return [];

    const existingJobs = await db
      .select({ id: jobs.id, description: jobs.description })
      .from(jobs)
      .where(inArray(jobs.id, jobIds));

    const matchableJobIds = new Set(
      existingJobs
        .filter((job) => typeof job.description === "string" && job.description.trim().length > 0)
        .map((job) => job.id)
    );

    return jobIds.filter((jobId) => matchableJobIds.has(jobId));
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
      totalJobsArchived: 0,
    });
  }

  async isSessionInProgress(id: string): Promise<boolean> {
    const [session] = await db
      .select({ status: scrapeSessions.status })
      .from(scrapeSessions)
      .where(eq(scrapeSessions.id, id));

    return session?.status === "in_progress";
  }

  async stopSession(id: string): Promise<boolean> {
    const updated = await db
      .update(scrapeSessions)
      .set({
        status: "failed",
        completedAt: new Date(),
      })
      .where(and(eq(scrapeSessions.id, id), eq(scrapeSessions.status, "in_progress")))
      .returning({ id: scrapeSessions.id });

    return updated.length > 0;
  }

  async updateSessionProgress(id: string, progress: SessionProgressUpdate): Promise<void> {
    await db
      .update(scrapeSessions)
      .set({
        companiesCompleted: progress.companiesCompleted,
        totalJobsFound: progress.totalJobsFound,
        totalJobsAdded: progress.totalJobsAdded,
        totalJobsFiltered: progress.totalJobsFiltered,
        totalJobsArchived: progress.totalJobsArchived,
      })
      .where(and(eq(scrapeSessions.id, id), eq(scrapeSessions.status, "in_progress")));
  }

  async completeSession(id: string, status: "completed" | "partial" | "failed"): Promise<void> {
    await db
      .update(scrapeSessions)
      .set({
        status,
        completedAt: new Date(),
      })
      .where(and(eq(scrapeSessions.id, id), eq(scrapeSessions.status, "in_progress")));
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
        jobsArchived: log.jobsArchived,
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
