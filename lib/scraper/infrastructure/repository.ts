import { and, eq, inArray } from "drizzle-orm";

import { buildJobFingerprintFromRecord } from "@/lib/ai/artifacts/fingerprints";
import { createAIWorkRecords } from "@/lib/ai/work-items/contracts";
import { db } from "@/lib/db";
import { chunkSqliteParameters } from "@/lib/db/sqlite-utils";
import {
  aiWorkItems,
  companies,
  jobs,
  matchSessionJobs,
  matchSessions,
  scrapeSessions,
  scrapingLogs,
  settings,
} from "@/lib/db/schema";

import type {
  IScraperRepository,
  ExistingJob,
  SessionProgressUpdate,
  ScrapingLogCreate,
  PersistScrapeResultInput,
  PersistScrapeResultOutput,
} from "./types";

const SQLITE_INSERT_CHUNK_SIZE = 50;

function buildArchivedIdentityUrl(url: string, jobId: number): string {
  const archivedUrl = new URL(url);
  archivedUrl.hash = `switchy-archived-${jobId}`;
  return archivedUrl.toString();
}

function buildScrapedJobFingerprint(job: {
  title: string;
  description?: string | null;
  location?: string | null;
  locationType?: string | null;
  seniorityLevel?: string | null;
  department?: string | null;
  employmentType?: string | null;
  salary?: string | null;
}): string | null {
  try {
    return buildJobFingerprintFromRecord({
      title: job.title,
      description: job.description ?? null,
      location: job.location ?? null,
      locationType: job.locationType ?? null,
      seniorityLevel: job.seniorityLevel ?? null,
      department: job.department ?? null,
      employmentType: job.employmentType ?? null,
      salary: job.salary ?? null,
    });
  } catch {
    return null;
  }
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
      const activeSession = tx
        .select({ status: scrapeSessions.status })
        .from(scrapeSessions)
        .where(eq(scrapeSessions.id, input.log.sessionId))
        .limit(1)
        .get();
      if (activeSession?.status !== "in_progress") {
        throw new Error(`Scrape session ${input.log.sessionId} is no longer active.`);
      }
      const openExternalIds = new Set(input.openExternalIds);
      const currentJobs = tx
        .select({
          id: jobs.id,
          externalId: jobs.externalId,
          url: jobs.url,
          status: jobs.status,
          archiveSource: jobs.archiveSource,
          title: jobs.title,
          description: jobs.description,
          location: jobs.location,
          locationType: jobs.locationType,
          seniorityLevel: jobs.seniorityLevel,
          department: jobs.department,
          employmentType: jobs.employmentType,
          salary: jobs.salary,
        })
        .from(jobs)
        .where(eq(jobs.companyId, input.companyId))
        .all();
      const currentJobsById = new Map(currentJobs.map((job) => [job.id, job]));
      const currentJobsByUrl = new Map(currentJobs.map((job) => [job.url, job]));

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

      for (const jobIdChunk of chunkSqliteParameters(jobIdsToReopen)) {
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
      for (const jobIdChunk of chunkSqliteParameters(jobIdsToArchive)) {
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
        const existingJob = currentJobsById.get(existingJobId);
        const urlOwner = currentJobsByUrl.get(job.url);
        if (existingJob && urlOwner && urlOwner.id !== existingJobId) {
          if (urlOwner.status !== "archived" || urlOwner.archiveSource !== "scraper") {
            throw new Error(
              `Cannot reconcile job ${existingJobId} with URL owned by active job ${urlOwner.id}.`
            );
          }

          const archivedIdentityUrl = buildArchivedIdentityUrl(urlOwner.url, urlOwner.id);
          tx.update(jobs)
            .set({ url: archivedIdentityUrl, updatedAt: writeStartedAt })
            .where(and(eq(jobs.id, urlOwner.id), eq(jobs.companyId, input.companyId)))
            .run();
          currentJobsByUrl.delete(urlOwner.url);
          currentJobsByUrl.set(archivedIdentityUrl, {
            ...urlOwner,
            url: archivedIdentityUrl,
          });
        }

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
            seniorityLevel: job.seniorityLevel,
            aiFingerprint: buildScrapedJobFingerprint({
              title: job.title,
              description: job.description ?? existingJob?.description,
              location: job.location ?? existingJob?.location,
              locationType: job.locationType ?? existingJob?.locationType,
              seniorityLevel: job.seniorityLevel ?? existingJob?.seniorityLevel,
              department: job.department ?? existingJob?.department,
              employmentType: job.employmentType ?? existingJob?.employmentType,
              salary: job.salary ?? existingJob?.salary,
            }),
            postedDate: job.postedDate,
            updatedAt: writeStartedAt,
          })
          .where(and(eq(jobs.id, existingJobId), eq(jobs.companyId, input.companyId)))
          .returning({ id: jobs.id })
          .all().length;
        if (existingJob) {
          currentJobsByUrl.delete(existingJob.url);
          currentJobsByUrl.set(job.url, { ...existingJob, url: job.url });
        }
      }

      const insertedJobs: Array<{ id: number; description: string | null }> = [];
      for (const jobsToInsert of chunkSqliteParameters(
        input.jobsToInsert,
        SQLITE_INSERT_CHUNK_SIZE
      )) {
        insertedJobs.push(
          ...tx
            .insert(jobs)
            .values(
              jobsToInsert.map((job) => ({
                ...job,
                companyId: input.companyId,
                aiFingerprint: buildScrapedJobFingerprint(job),
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
          startedAt: new Date(input.startedAtMs),
          duration: Math.max(0, completedAt.getTime() - input.startedAtMs),
          persistenceDuration: Math.max(
            0,
            completedAt.getTime() -
              (input.persistenceStartedAtMs ?? input.startedAtMs)
          ),
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
        const matchWork = createAIWorkRecords({
          id: matchOutboxId,
          scrapingLogId: insertedLog.id,
          companyId: input.companyId,
          jobIds: matchableJobIds,
          triggerSource: "auto_match",
          now: completedAt,
        });
        tx.insert(matchSessions).values(matchWork.session).run();
        tx.insert(aiWorkItems).values(matchWork.workItem).run();
        tx.insert(matchSessionJobs).values(matchableJobIds.map((jobId) => ({
          sessionId: matchOutboxId,
          jobId,
          createdAt: completedAt,
          updatedAt: completedAt,
        }))).run();
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
        fetchDuration: log.fetchDuration,
        processingDuration: log.processingDuration,
        persistenceDuration: log.persistenceDuration,
        completedAt: log.completedAt,
        matcherStatus: log.matcherStatus,
        matcherJobsTotal: log.matcherJobsTotal,
        matcherJobsCompleted: log.matcherJobsCompleted ?? 0,
      })
      .returning({ id: scrapingLogs.id });
    
    return inserted?.id ?? 0;
  }

}

export function createScraperRepository(): IScraperRepository {
  return new DrizzleScraperRepository();
}
