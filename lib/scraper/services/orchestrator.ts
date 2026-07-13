import type { Company } from "@/lib/db/schema";
import type { ScrapePipelineStore } from "@/lib/scraper/infrastructure/types";
import type { ScrapeOptions } from "@/lib/scraper/core/types";
import {
  isPlatform,
  type BatchDeduplicationResult,
  type DeduplicationMatchReason,
  type Platform,
  type TriggerSource,
  type FetchResult,
  type BatchFetchResult,
  type ScrapeOutcome,
  type ScraperResult,
  type ScrapedJob,
} from "@/lib/scraper/types";
import { detectPlatformFromUrl } from "@/lib/scraper/platform-detection";
import { dispatchPendingScrapeMatches } from "@/lib/scraper/matching";
import {
  StoredScrapeSettingsProvider,
  type ScrapeSettingsProvider,
} from "@/lib/scraper/settings/provider";
import { ScraperLogger } from "@/lib/scraper/utils/logger";
import { getMatcherConfig } from "@/lib/ai/matcher";

import type { IScraperRegistry } from "./registry";
import type { IDeduplicationService } from "./deduplication-service";
import type { IFilterService, JobFilters } from "./filter-service";

export interface OrchestratorConfig {
  autoMatchAfterScrape: boolean;
  defaultFilters: JobFilters;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  autoMatchAfterScrape: true,
  defaultFilters: {},
};

const ARCHIVABLE_JOB_STATUSES = ["new", "viewed", "interested", "rejected"];
const UBER_ARCHIVE_MISSING_ABSOLUTE_THRESHOLD = 5;
const UBER_ARCHIVE_MISSING_RATIO_THRESHOLD = 0.05;
const SAFE_HYDRATION_MATCH_REASONS: DeduplicationMatchReason[] = ["externalId", "url"];
type ScrapeTier = "api" | "browser" | "serial";

export interface IScrapeOrchestrator {
  scrapeAllCompanies(
    trigger: TriggerSource,
    options?: ScrapeBatchOptions
  ): Promise<BatchFetchResult>;
  scrapeCompanies(
    companyIds: number[],
    trigger: TriggerSource,
    options?: ScrapeBatchOptions
  ): Promise<BatchFetchResult>;
  scrapeCompany(companyId: number, options?: ScrapeCompanyOptions): Promise<FetchResult>;
}

export interface ScrapeBatchOptions {
  signal?: AbortSignal;
}

export interface ScrapeCompanyOptions {
  sessionId?: string;
  triggerSource?: TriggerSource;
  filters?: JobFilters;
  signal?: AbortSignal;
}

interface ScrapeExecutionResult {
  outcome: ScrapeOutcome;
  jobsFound: number;
  jobsAdded: number;
  jobsUpdated: number;
  jobsFiltered: number;
  jobsArchived: number;
  logId?: number;
  error?: string;
  retryable?: boolean;
  retryAfterMs?: number;
}

interface ScrapeBatchProgress {
  companiesCompleted: number;
  totalJobsFound: number;
  totalJobsAdded: number;
  totalJobsFiltered: number;
  totalJobsArchived: number;
}

interface DuplicateHydrationCandidate {
  existingJobId: number;
  job: ScrapedJob;
}

export class ScrapeOrchestrator implements IScrapeOrchestrator {
  constructor(
    private readonly repository: ScrapePipelineStore,
    private readonly registry: IScraperRegistry,
    private readonly deduplicationService: IDeduplicationService,
    private readonly filterService: IFilterService,
    private readonly config: OrchestratorConfig,
    private readonly settingsProvider: ScrapeSettingsProvider =
      new StoredScrapeSettingsProvider(repository)
  ) {}

  async scrapeAllCompanies(
    trigger: TriggerSource,
    options?: ScrapeBatchOptions
  ): Promise<BatchFetchResult> {
    const activeCompanies = await this.repository.getActiveCompanies();
    return this.scrapeBatch(activeCompanies, trigger, options?.signal);
  }

  async scrapeCompanies(
    companyIds: number[],
    trigger: TriggerSource,
    options?: ScrapeBatchOptions
  ): Promise<BatchFetchResult> {
    const companyIdsSet = new Set(companyIds);
    const activeCompanies = await this.repository.getActiveCompanies();
    const selectedCompanies = activeCompanies.filter((company) => companyIdsSet.has(company.id));

    return this.scrapeBatch(selectedCompanies, trigger, options?.signal);
  }

  async scrapeCompany(companyId: number, options?: ScrapeCompanyOptions): Promise<FetchResult> {
    const company = await this.repository.getCompany(companyId);

    if (!company) {
      return this.createErrorResult(companyId, "Unknown", "Company not found");
    }

    const sessionId = options?.sessionId ?? crypto.randomUUID();
    const triggerSource = options?.triggerSource ?? "manual";
    const isStandaloneRefresh = !options?.sessionId;

    if (isStandaloneRefresh) {
      await this.repository.createSession({
        id: sessionId,
        triggerSource,
        status: "in_progress",
        companiesTotal: 1,
      });
    }

    const result = this.isCustomPlatform(company.platform)
      ? this.createSkippedResult(company.id, company.name, "Skipping custom platform company")
      : await this.scrapeCompanyInternal(
          company.id,
          company.name,
          company.careersUrl,
          this.resolvePlatform(company.platform),
          company.boardToken,
          { sessionId, triggerSource, filters: options?.filters, signal: options?.signal }
        );

    if (isStandaloneRefresh) {
      const shouldCompleteSession = await this.repository.isSessionInProgress(sessionId);
      if (shouldCompleteSession) {
        await this.repository.updateSessionProgress(sessionId, {
          companiesCompleted: 1,
          totalJobsFound: result.jobsFound,
          totalJobsAdded: result.jobsAdded,
          totalJobsFiltered: result.jobsFiltered,
          totalJobsArchived: result.jobsArchived,
        });
        await this.repository.completeSession(
          sessionId,
          this.resolveSessionStatusFromOutcome(result.outcome)
        );
      }
    }

    return result;
  }

  private async scrapeBatch(
    companiesToScrape: Company[],
    trigger: TriggerSource,
    externalSignal?: AbortSignal
  ): Promise<BatchFetchResult> {
    const sessionId = crypto.randomUUID();
    const sessionStartTime = Date.now();

    const logger = new ScraperLogger("", "");
    logger.batchStart(companiesToScrape.length);

    await this.repository.createSession({
      id: sessionId,
      triggerSource: trigger,
      status: "in_progress",
      companiesTotal: companiesToScrape.length,
    });

    const maxParallelScrapes = await this.loadMaxParallelScrapes();
    const queueItems = companiesToScrape.map((company, index) => ({ company, index }));
    const apiQueue: Array<{ company: Company; index: number }> = [];
    const browserQueue: Array<{ company: Company; index: number }> = [];
    const serialQueue: Array<{ company: Company; index: number }> = [];

    for (const item of queueItems) {
      const tier = this.resolveScrapeTier(item.company);
      if (tier === "api") {
        apiQueue.push(item);
      } else if (tier === "browser") {
        browserQueue.push(item);
      } else {
        serialQueue.push(item);
      }
    }

    const resultsByIndex: Array<FetchResult | undefined> = new Array(companiesToScrape.length);
    let stopRequested = false;
    let progressUpdateChain = Promise.resolve();
    const batchController = new AbortController();
    const requestStop = (message: string) => {
      stopRequested = true;
      if (!batchController.signal.aborted) {
        batchController.abort(new DOMException(message, "AbortError"));
      }
    };
    const onExternalAbort = () => requestStop("Batch scrape cancelled");
    if (externalSignal?.aborted) onExternalAbort();
    else externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

    let sessionMonitorStopped = false;
    let sessionMonitorPromise: Promise<void> | null = null;
    const checkSession = async () => {
      try {
        const isActive = await this.repository.isSessionInProgress(sessionId);
        if (!sessionMonitorStopped && !isActive) {
          requestStop("Scrape session stopped");
        }
      } catch (error) {
        console.error(`[ScrapeOrchestrator] Failed to monitor session ${sessionId}:`, error);
      }
    };
    const sessionMonitor = setInterval(() => {
      if (sessionMonitorStopped || sessionMonitorPromise || stopRequested) return;
      const currentCheck = checkSession();
      sessionMonitorPromise = currentCheck;
      void currentCheck.finally(() => {
        if (sessionMonitorPromise === currentCheck) sessionMonitorPromise = null;
      });
    }, 250);

    const runQueue = async (
      queue: Array<{ company: Company; index: number }>,
      workerLimit: number
    ): Promise<void> => {
      if (queue.length === 0 || stopRequested) return;
      const workerCount = Math.min(workerLimit, queue.length);
      if (workerCount <= 0) return;
      let nextQueueIndex = 0;

      const processNextCompany = async (): Promise<void> => {
        while (true) {
          if (stopRequested || batchController.signal.aborted) {
            return;
          }

          const queueIndex = nextQueueIndex;
          if (queueIndex >= queue.length) {
            return;
          }

          nextQueueIndex += 1;

          const isSessionActive = await this.repository.isSessionInProgress(sessionId);
          if (stopRequested || batchController.signal.aborted) {
            return;
          }
          if (!isSessionActive) {
            requestStop("Scrape session stopped");
            console.log(`[ScrapeOrchestrator] Session ${sessionId} stop requested`);
            return;
          }

          const { company, index: resultIndex } = queue[queueIndex];
          const result = this.isCustomPlatform(company.platform)
            ? this.createSkippedResult(company.id, company.name, "Skipping custom platform company")
            : await this.scrapeCompanyInternal(
                company.id,
                company.name,
                company.careersUrl,
                this.resolvePlatform(company.platform),
                company.boardToken,
                { sessionId, triggerSource: trigger, signal: batchController.signal }
              );

          resultsByIndex[resultIndex] = result;
          const completedResults = resultsByIndex.filter(
            (entry): entry is FetchResult => entry !== undefined
          );
          const progress = this.calculateBatchProgress(completedResults);

          progressUpdateChain = progressUpdateChain.then(async () => {
            await this.repository.updateSessionProgress(sessionId, progress);
          });
          await progressUpdateChain;
        }
      };

      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          await processNextCompany();
        })
      );
    };

    try {
      await runQueue(apiQueue, maxParallelScrapes);
      await runQueue(browserQueue, maxParallelScrapes);
      await runQueue(serialQueue, 1);
      await progressUpdateChain;
    } finally {
      sessionMonitorStopped = true;
      clearInterval(sessionMonitor);
      await sessionMonitorPromise;
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }

    const results = resultsByIndex.filter(
      (entry): entry is FetchResult => entry !== undefined
    );

    const shouldCompleteSession = await this.repository.isSessionInProgress(sessionId);

    if (shouldCompleteSession) {
      await this.repository.completeSession(
        sessionId,
        batchController.signal.aborted ? "failed" : this.resolveBatchSessionStatus(results)
      );
    }

    const skippedCompanies = results.filter((result) => result.skipped).length;
    const successfulCompanies = results.filter(
      (result) => result.outcome === "success" && !result.skipped
    ).length;
    const failedCompanies = results.filter((result) => result.outcome !== "success").length;
    const progress = this.calculateBatchProgress(results);

    logger.batchComplete(successfulCompanies, companiesToScrape.length, progress.totalJobsAdded);

    return {
      sessionId,
      results,
      summary: {
        totalCompanies: companiesToScrape.length,
        successfulCompanies,
        skippedCompanies,
        failedCompanies,
        totalJobsFound: progress.totalJobsFound,
        totalJobsAdded: progress.totalJobsAdded,
        totalJobsFiltered: progress.totalJobsFiltered,
        totalJobsArchived: progress.totalJobsArchived,
        totalDuration: Date.now() - sessionStartTime,
      },
    };
  }

  private resolveScrapeTier(company: Company): ScrapeTier {
    if (this.isCustomPlatform(company.platform)) {
      return "serial";
    }

    const platform = this.resolvePlatformForTier(company);
    if (!platform) {
      return "serial";
    }

    const scraper = this.registry.getScraperByPlatform(platform);
    if (!scraper) {
      return "serial";
    }

    if (scraper.capabilities.concurrency === "serial") {
      return "serial";
    }

    return scraper.capabilities.transport === "browser" ? "browser" : "api";
  }

  private resolvePlatformForTier(company: Company): Platform | null {
    const resolved = this.resolvePlatform(company.platform);
    if (resolved) {
      return resolved;
    }

    const detected = detectPlatformFromUrl(company.careersUrl);
    if (detected === "custom") {
      return null;
    }

    return detected;
  }

  private calculateBatchProgress(results: FetchResult[]): ScrapeBatchProgress {
    return {
      companiesCompleted: results.length,
      totalJobsFound: results.reduce((sum, result) => sum + result.jobsFound, 0),
      totalJobsAdded: results.reduce((sum, result) => sum + result.jobsAdded, 0),
      totalJobsFiltered: results.reduce((sum, result) => sum + result.jobsFiltered, 0),
      totalJobsArchived: results.reduce((sum, result) => sum + result.jobsArchived, 0),
    };
  }

  private resolveSessionStatusFromOutcome(
    outcome: ScrapeOutcome
  ): "completed" | "partial" | "failed" {
    if (outcome === "success") return "completed";
    if (outcome === "error") return "failed";
    return "partial";
  }

  private resolveBatchSessionStatus(
    results: FetchResult[]
  ): "completed" | "partial" | "failed" {
    if (results.length === 0 || results.every((result) => result.outcome === "success")) {
      return "completed";
    }

    if (results.every((result) => result.outcome === "error")) {
      return "failed";
    }

    return "partial";
  }

  private async scrapeCompanyInternal(
    companyId: number,
    companyName: string,
    careersUrl: string,
    platform: Platform | null,
    boardToken: string | null,
    options: {
      sessionId: string;
      triggerSource: TriggerSource;
      filters?: JobFilters;
      signal?: AbortSignal;
    }
  ): Promise<FetchResult> {
    const startTime = Date.now();
    const logger = new ScraperLogger(companyName, platform || "auto-detect");

    logger.start();

    try {
      const existingJobs = await this.repository.getExistingJobs(companyId);
      const existingExternalIds = new Set<string>(
        existingJobs
          .filter((job) => this.hasNonEmptyDescription(job.description))
          .map((job) => job.externalId)
          .filter((externalId): externalId is string => Boolean(externalId))
      );

      const filters = await this.loadFilters(options.filters);
      const scraperOptions = this.createScraperOptions(
        boardToken,
        filters,
        existingExternalIds,
        options.signal
      );

      const scraperResult = await this.registry.scrape(
        careersUrl,
        platform ?? undefined,
        scraperOptions
      );

      const executionResult = await this.processScraperResult({
        scraperResult,
        companyId,
        platform,
        boardToken,
        existingJobs,
        filters,
        sessionId: options.sessionId,
        triggerSource: options.triggerSource,
        startTime,
        logger,
      });

      return this.createFetchResult({
        companyId,
        companyName,
        platform,
        duration: Date.now() - startTime,
        ...executionResult,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error(errorMessage);

      await this.repository.createScrapingLog({
        companyId,
        sessionId: options.sessionId,
        triggerSource: options.triggerSource,
        platform,
        status: "error",
        jobsFound: 0,
        jobsAdded: 0,
        jobsUpdated: 0,
        jobsFiltered: 0,
        jobsArchived: 0,
        errorMessage,
        duration: Date.now() - startTime,
        completedAt: new Date(),
      });

      return this.createFetchResult({
        companyId,
        companyName,
        platform,
        outcome: "error",
        jobsFound: 0,
        jobsAdded: 0,
        jobsUpdated: 0,
        jobsFiltered: 0,
        jobsArchived: 0,
        error: errorMessage,
        retryable: true,
        duration: Date.now() - startTime,
      });
    }
  }

  private createScraperOptions(
    boardToken: string | null,
    filters: JobFilters,
    existingExternalIds: Set<string>,
    signal?: AbortSignal
  ): ScrapeOptions {
    return {
      boardToken: boardToken ?? undefined,
      filters,
      existingExternalIds,
      signal,
    };
  }

  private resolveScrapeOutcome(scraperResult: ScraperResult<ScrapedJob>): ScrapeOutcome {
    return scraperResult.outcome;
  }

  private async processScraperResult(params: {
    scraperResult: ScraperResult<ScrapedJob>;
    companyId: number;
    platform: Platform | null;
    boardToken: string | null;
    existingJobs: Array<{
      id: number;
      externalId: string | null;
      title: string;
      url: string;
      status: string;
      description: string | null;
    }>;
    filters: JobFilters;
    sessionId: string;
    triggerSource: TriggerSource;
    startTime: number;
    logger: ScraperLogger;
  }): Promise<ScrapeExecutionResult> {
    const {
      scraperResult,
      companyId,
      platform,
      boardToken,
      existingJobs,
      filters,
      sessionId,
      triggerSource,
      startTime,
      logger,
    } = params;

    const outcome = this.resolveScrapeOutcome(scraperResult);

    if (scraperResult.outcome === "error") {
      const errorMessage = scraperResult.error.message;
      logger.error(errorMessage);

      await this.repository.createScrapingLog({
        companyId,
        sessionId,
        triggerSource,
        platform,
        status: "error",
        jobsFound: 0,
        jobsAdded: 0,
        jobsUpdated: 0,
        jobsFiltered: 0,
        jobsArchived: 0,
        errorMessage,
        duration: Date.now() - startTime,
        completedAt: new Date(),
      });

      return {
        outcome,
        jobsFound: 0,
        jobsAdded: 0,
        jobsUpdated: 0,
        jobsFiltered: 0,
        jobsArchived: 0,
        error: errorMessage,
        retryable: scraperResult.error.retryable,
        retryAfterMs: scraperResult.error.retryAfterMs,
      };
    }

    const hasEarlyFilter = Boolean(
      scraperResult.earlyFiltered && scraperResult.earlyFiltered.total > 0
    );
    const totalFetched = scraperResult.totalListings;

    if (hasEarlyFilter) {
      logger.fetchedWithEarlyFilter(totalFetched, {
        country: scraperResult.earlyFiltered?.country,
        city: scraperResult.earlyFiltered?.city,
        title: scraperResult.earlyFiltered?.title,
      });
    } else {
      logger.fetched(totalFetched);
    }

    const openExternalIds = Array.from(
      new Set(
        (scraperResult.openExternalIds ?? scraperResult.jobs.map((job) => job.externalId)).filter(
          (externalId): externalId is string => Boolean(externalId)
        )
      )
    );

    const archiveMissing =
      scraperResult.listingCompleteness === "complete" &&
      !(
        platform === "uber" &&
        this.shouldSkipUberArchival(openExternalIds, existingJobs)
      );

    const dedupeResult = this.deduplicationService.batchDeduplicate(
      scraperResult.jobs,
      existingJobs
    );
    const filterResult = this.filterService.applyFilters(dedupeResult.newJobs, filters);
    const duplicateHydrationCandidates = this.getDuplicateHydrationCandidates(
      dedupeResult.duplicates,
      existingJobs
    );

    if (filterResult.filteredOut > 0 && !hasEarlyFilter) {
      logger.filtered({
        country: filterResult.breakdown.failedCountry > 0 ? filterResult.breakdown.failedCountry : undefined,
        city: filterResult.breakdown.failedCity > 0 ? filterResult.breakdown.failedCity : undefined,
        title: filterResult.breakdown.failedTitle > 0 ? filterResult.breakdown.failedTitle : undefined,
      });
    }

    const matcherConfig = await getMatcherConfig();
    const logStatus = outcome === "success" ? "success" : "partial";
    const jobsFiltered = filterResult.filteredOut + (scraperResult.earlyFiltered?.total || 0);
    const persistenceResult = await this.repository.persistScrapeResult({
      companyId,
      openExternalIds,
      archiveMissing,
      statusesToArchive: ARCHIVABLE_JOB_STATUSES,
      jobsToInsert: filterResult.filtered.map((job) => ({
        externalId: job.externalId,
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
        status: "new" as const,
      })),
      existingJobUpdates: duplicateHydrationCandidates,
      companyBoardToken:
        scraperResult.detectedBoardToken && !boardToken
          ? scraperResult.detectedBoardToken
          : undefined,
      startedAtMs: startTime,
      enableMatching:
        this.config.autoMatchAfterScrape && matcherConfig.autoMatchAfterScrape,
      log: {
        sessionId,
        triggerSource,
        platform,
        status: logStatus,
        jobsFound: totalFetched,
        jobsFiltered,
      },
    });

    logger.added(persistenceResult.jobsAdded, dedupeResult.duplicates.length);
    if (persistenceResult.matchOutboxId) {
      dispatchPendingScrapeMatches();
    }

    return {
      outcome,
      jobsFound: totalFetched,
      jobsAdded: persistenceResult.jobsAdded,
      jobsUpdated: persistenceResult.jobsUpdated,
      jobsFiltered,
      jobsArchived: persistenceResult.jobsArchived,
      logId: persistenceResult.logId,
    };
  }

  private shouldSkipUberArchival(
    openExternalIds: string[],
    existingJobs: Array<{
      id: number;
      externalId: string | null;
      title: string;
      url: string;
      status: string;
      description: string | null;
    }>
  ): boolean {
    const openExternalIdSet = new Set(openExternalIds);
    const archivableJobs = existingJobs.filter(
      (job) => Boolean(job.externalId) && ARCHIVABLE_JOB_STATUSES.includes(job.status)
    );

    if (archivableJobs.length === 0) {
      return false;
    }

    const missingCount = archivableJobs.reduce((total, job) => {
      if (!job.externalId) return total;
      return openExternalIdSet.has(job.externalId) ? total : total + 1;
    }, 0);

    const threshold = Math.max(
      UBER_ARCHIVE_MISSING_ABSOLUTE_THRESHOLD,
      Math.ceil(archivableJobs.length * UBER_ARCHIVE_MISSING_RATIO_THRESHOLD)
    );

    return missingCount > threshold;
  }

  private getDuplicateHydrationCandidates(
    duplicates: BatchDeduplicationResult["duplicates"],
    existingJobs: Array<{ id: number; description: string | null }>
  ): DuplicateHydrationCandidate[] {
    if (duplicates.length === 0) {
      return [];
    }

    const existingJobsById = new Map(existingJobs.map((existingJob) => [existingJob.id, existingJob]));

    const candidates: DuplicateHydrationCandidate[] = [];

    for (const duplicate of duplicates) {
      if (!SAFE_HYDRATION_MATCH_REASONS.includes(duplicate.matchReason)) {
        continue;
      }

      const existingJob = existingJobsById.get(duplicate.existingJobId);
      if (!existingJob) {
        continue;
      }

      if (!this.hasNonEmptyDescription(duplicate.job.description)) {
        continue;
      }

      const existingDescription = existingJob.description?.trim() ?? "";
      const scrapedDescription = duplicate.job.description?.trim() ?? "";

      if (existingDescription === scrapedDescription) {
        continue;
      }

      candidates.push({
        existingJobId: duplicate.existingJobId,
        job: duplicate.job,
      });
    }

    return candidates;
  }

  private hasNonEmptyDescription(description: string | null | undefined): boolean {
    return typeof description === "string" && description.trim().length > 0;
  }


  private createFetchResult(params: {
    companyId: number;
    companyName: string;
    platform: Platform | null;
    outcome: ScrapeOutcome;
    skipped?: boolean;
    skippedReason?: string;
    jobsFound: number;
    jobsAdded: number;
    jobsUpdated: number;
    jobsFiltered: number;
    jobsArchived: number;
    duration: number;
    error?: string;
    retryable?: boolean;
    retryAfterMs?: number;
    logId?: number;
  }): FetchResult {
    return {
      companyId: params.companyId,
      companyName: params.companyName,
      success: params.outcome === "success",
      outcome: params.outcome,
      skipped: params.skipped,
      skippedReason: params.skippedReason,
      jobsFound: params.jobsFound,
      jobsAdded: params.jobsAdded,
      jobsUpdated: params.jobsUpdated,
      jobsFiltered: params.jobsFiltered,
      jobsArchived: params.jobsArchived,
      platform: params.platform,
      error: params.error,
      retryable: params.retryable,
      retryAfterMs: params.retryAfterMs,
      duration: params.duration,
      logId: params.logId,
    };
  }

  private async loadFilters(overrideFilters?: JobFilters): Promise<JobFilters> {
    if (overrideFilters) {
      return { ...this.config.defaultFilters, ...overrideFilters };
    }

    return this.settingsProvider.getFilters(this.config.defaultFilters);
  }

  private async loadMaxParallelScrapes(): Promise<number> {
    return this.settingsProvider.getMaxParallelScrapes();
  }

  private createErrorResult(
    companyId: number,
    companyName: string,
    error: string
  ): FetchResult {
    const logger = new ScraperLogger(companyName, "unknown");
    logger.error(error);

    return this.createFetchResult({
      companyId,
      companyName,
      platform: null,
      outcome: "error",
      jobsFound: 0,
      jobsAdded: 0,
      jobsUpdated: 0,
      jobsFiltered: 0,
      jobsArchived: 0,
      error,
      duration: 0,
    });
  }

  private normalizePlatformValue(value: string | null | undefined): string | null {
    if (!value) return null;
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }

  private isCustomPlatform(value: string | null | undefined): boolean {
    return this.normalizePlatformValue(value) === "custom";
  }

  private resolvePlatform(value: string | null | undefined): Platform | null {
    const normalized = this.normalizePlatformValue(value);
    if (!normalized) return null;

    if (normalized === "custom") return null;

    return isPlatform(normalized) ? normalized : null;
  }

  private createSkippedResult(
    companyId: number,
    companyName: string,
    reason: string
  ): FetchResult {
    const logger = new ScraperLogger(companyName, "custom");
    logger.error(reason);

    return this.createFetchResult({
      companyId,
      companyName,
      platform: null,
      outcome: "success",
      skipped: true,
      skippedReason: reason,
      jobsFound: 0,
      jobsAdded: 0,
      jobsUpdated: 0,
      jobsFiltered: 0,
      jobsArchived: 0,
      duration: 0,
    });
  }
}

export interface CreateOrchestratorConfig {
  repository: ScrapePipelineStore;
  registry: IScraperRegistry;
  deduplicationService: IDeduplicationService;
  filterService: IFilterService;
  settingsProvider?: ScrapeSettingsProvider;
  config?: Partial<OrchestratorConfig>;
}

export function createScrapeOrchestrator(config: CreateOrchestratorConfig): IScrapeOrchestrator {
  return new ScrapeOrchestrator(
    config.repository,
    config.registry,
    config.deduplicationService,
    config.filterService,
    { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config.config },
    config.settingsProvider
  );
}
