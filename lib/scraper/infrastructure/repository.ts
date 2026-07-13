import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  companies,
  jobs,
  matchSessions,
  scrapeMatchOutbox,
  scrapeSessions,
  scrapingLogs,
  settings,
} from "@/lib/db/schema";

import type {
  IScraperRepository,
  ExistingJob,
  SessionProgressUpdate,
  ScrapeSessionCreate,
  ScrapingLogCreate,
  PersistScrapeResultInput,
  PersistScrapeResultOutput,
} from "./types";

const SCHEDULER_LOCK_KEY = "scheduler.lock";
const SCHEDULER_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const SQLITE_WRITE_CHUNK_SIZE = 400;
const SQLITE_INSERT_CHUNK_SIZE = 50;

function chunkValues<T>(values: T[], chunkSize = SQLITE_WRITE_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

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
  constructor(private readonly database: typeof db = db) {}

  async getCompany(id: number) {
    const [company] = await this.database
      .select()
      .from(companies)
      .where(eq(companies.id, id));
    return company ?? null;
  }

  async getActiveCompanies() {
    return this.database
      .select()
      .from(companies)
      .where(eq(companies.isActive, true));
  }

  async getExistingJobs(companyId: number): Promise<ExistingJob[]> {
    return this.database
      .select({
        id: jobs.id,
        externalId: jobs.externalId,
        title: jobs.title,
        url: jobs.url,
        location: jobs.location,
        status: jobs.status,
        description: jobs.description,
      })
      .from(jobs)
      .where(eq(jobs.companyId, companyId));
  }

  async getSetting(key: string): Promise<string | null> {
    const [setting] = await this.database
      .select()
      .from(settings)
      .where(eq(settings.key, key));
    return setting?.value ?? null;
  }

  async persistScrapeResult(
    input: PersistScrapeResultInput
  ): Promise<PersistScrapeResultOutput> {
    return this.database.transaction((tx) => {
      const writeStartedAt = new Date();
      const openExternalIds = new Set(input.openExternalIds);
      const currentJobs = tx
        .select({
          id: jobs.id,
          externalId: jobs.externalId,
          status: jobs.status,
          archiveSource: jobs.archiveSource,
        })
        .from(jobs)
        .where(eq(jobs.companyId, input.companyId))
        .all();

      const jobIdsToReopen = currentJobs
        .filter(
          (job) =>
            job.status === "archived" &&
            job.archiveSource === "scraper" &&
            Boolean(job.externalId && openExternalIds.has(job.externalId))
        )
        .map((job) => job.id);
      const jobIdsToArchive = input.archiveMissing
        ? currentJobs
            .filter((job) => {
              if (!job.externalId) return false;
              return (
                input.statusesToArchive.includes(job.status) &&
                !openExternalIds.has(job.externalId)
              );
            })
            .map((job) => job.id)
        : [];

      for (const jobIdChunk of chunkValues(jobIdsToReopen)) {
        tx.update(jobs)
          .set({
            status: "new",
            archivedAt: null,
            archiveSource: null,
            updatedAt: writeStartedAt,
          })
          .where(
            and(
              eq(jobs.companyId, input.companyId),
              eq(jobs.status, "archived"),
              eq(jobs.archiveSource, "scraper"),
              inArray(jobs.id, jobIdChunk)
            )
          )
          .run();
      }

      let jobsArchived = 0;
      for (const jobIdChunk of chunkValues(jobIdsToArchive)) {
        jobsArchived += tx
          .update(jobs)
          .set({
            status: "archived",
            archivedAt: writeStartedAt,
            archiveSource: "scraper",
            updatedAt: writeStartedAt,
          })
          .where(
            and(
              eq(jobs.companyId, input.companyId),
              inArray(jobs.id, jobIdChunk),
              inArray(jobs.status, input.statusesToArchive)
            )
          )
          .returning({ id: jobs.id })
          .all().length;
      }

      let jobsUpdated = 0;
      for (const { existingJobId, job } of input.existingJobUpdates) {
        jobsUpdated += tx
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
            updatedAt: writeStartedAt,
          })
          .where(and(eq(jobs.id, existingJobId), eq(jobs.companyId, input.companyId)))
          .returning({ id: jobs.id })
          .all().length;
      }

      const insertedJobs: Array<{ id: number; description: string | null }> = [];
      for (const jobsToInsert of chunkValues(input.jobsToInsert, SQLITE_INSERT_CHUNK_SIZE)) {
        insertedJobs.push(
          ...tx
            .insert(jobs)
            .values(
              jobsToInsert.map((job) => ({
                ...job,
                companyId: input.companyId,
              }))
            )
            .onConflictDoNothing()
            .returning({ id: jobs.id, description: jobs.description })
            .all()
        );
      }
      const insertedJobIds = insertedJobs.map((job) => job.id);
      const matchableJobIds = input.enableMatching
        ? insertedJobs
            .filter(
              (job) =>
                typeof job.description === "string" && job.description.trim().length > 0
            )
            .map((job) => job.id)
        : [];

      const completedAt = new Date();
      const insertedLog = tx
        .insert(scrapingLogs)
        .values({
          ...input.log,
          companyId: input.companyId,
          jobsAdded: insertedJobIds.length,
          jobsUpdated,
          jobsArchived,
          matcherStatus: matchableJobIds.length > 0 ? "pending" : null,
          matcherJobsTotal: matchableJobIds.length > 0 ? matchableJobIds.length : null,
          matcherJobsCompleted: 0,
          duration: Math.max(0, completedAt.getTime() - input.startedAtMs),
          completedAt,
        })
        .returning({ id: scrapingLogs.id })
        .get();
      if (!insertedLog) throw new Error("Failed to persist scrape audit log.");

      tx.update(companies)
        .set({
          lastScrapedAt: completedAt,
          updatedAt: completedAt,
          ...(input.companyBoardToken ? { boardToken: input.companyBoardToken } : {}),
        })
        .where(eq(companies.id, input.companyId))
        .run();

      const matchOutboxId = matchableJobIds.length > 0 ? crypto.randomUUID() : null;
      if (matchOutboxId) {
        tx.insert(matchSessions)
          .values({
            id: matchOutboxId,
            triggerSource: "auto_match",
            companyId: input.companyId,
            status: "queued",
            jobsTotal: matchableJobIds.length,
            jobsCompleted: 0,
            jobsSucceeded: 0,
            jobsFailed: 0,
            errorCount: 0,
            startedAt: null,
          })
          .run();
        tx.insert(scrapeMatchOutbox)
          .values({
            id: matchOutboxId,
            scrapingLogId: insertedLog.id,
            companyId: input.companyId,
            jobIdsJson: JSON.stringify(matchableJobIds),
            status: "pending",
            availableAt: completedAt,
            createdAt: completedAt,
            updatedAt: completedAt,
          })
          .run();
      }

      return {
        insertedJobIds,
        matchableJobIds,
        jobsAdded: insertedJobIds.length,
        jobsUpdated,
        jobsArchived,
        logId: insertedLog.id,
        matchOutboxId,
      };
    }, { behavior: "immediate" });
  }

  async createSession(session: ScrapeSessionCreate): Promise<void> {
    await this.database.insert(scrapeSessions).values({
      id: session.id,
      triggerSource: session.triggerSource,
      status: session.status,
      companiesTotal: session.companiesTotal,
      companiesCompleted: session.companiesCompleted ?? 0,
      totalJobsFound: session.totalJobsFound ?? 0,
      totalJobsAdded: session.totalJobsAdded ?? 0,
      totalJobsFiltered: session.totalJobsFiltered ?? 0,
      totalJobsArchived: session.totalJobsArchived ?? 0,
      skipReason: session.skipReason,
      scheduledForAt: session.scheduledForAt,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
    });
  }

  async isSessionInProgress(id: string): Promise<boolean> {
    const [session] = await this.database
      .select({ status: scrapeSessions.status })
      .from(scrapeSessions)
      .where(eq(scrapeSessions.id, id));

    return session?.status === "in_progress";
  }

  async stopSession(id: string): Promise<boolean> {
    const updated = await this.database
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
    await this.database
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
    await this.database
      .update(scrapeSessions)
      .set({
        status,
        completedAt: new Date(),
      })
      .where(and(eq(scrapeSessions.id, id), eq(scrapeSessions.status, "in_progress")));
  }

  async createScrapingLog(log: ScrapingLogCreate): Promise<number> {
    const [inserted] = await this.database
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
      await this.database
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

    await this.database
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

    await this.database
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

    await this.database
      .delete(settings)
      .where(and(eq(settings.key, SCHEDULER_LOCK_KEY), eq(settings.value, currentRaw)));
  }
}

export function createScraperRepository(): IScraperRepository {
  return new DrizzleScraperRepository();
}
