import type { Company } from "@/lib/db/schema";
import type { IScraperRepository } from "@/lib/scraper/infrastructure/types";
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
import { ScraperLogger } from "@/lib/scraper/utils/logger";
import { getMatcherConfig, matchWithTracking } from "@/lib/ai/matcher";

import { parseTitleKeywords } from "./filter-service";
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
const SCRAPER_MAX_PARALLEL_SCRAPES_KEY = "scraper_max_parallel_scrapes";
const DEFAULT_MAX_PARALLEL_SCRAPES = 3;
const MIN_PARALLEL_SCRAPES = 1;
const MAX_PARALLEL_SCRAPES = 10;

export interface IScrapeOrchestrator {
  scrapeAllCompanies(trigger: TriggerSource): Promise<BatchFetchResult>;
  scrapeCompanies(companyIds: number[], trigger: TriggerSource): Promise<BatchFetchResult>;
  scrapeCompany(companyId: number, options?: ScrapeCompanyOptions): Promise<FetchResult>;
}

export interface ScrapeCompanyOptions {
  sessionId?: string;
  triggerSource?: TriggerSource;
  filters?: JobFilters;
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
    private readonly repository: IScraperRepository,
    private readonly registry: IScraperRegistry,
    private readonly deduplicationService: IDeduplicationService,
    private readonly filterService: IFilterService,
    private readonly config: OrchestratorConfig
  ) {}

  async scrapeAllCompanies(trigger: TriggerSource): Promise<BatchFetchResult> {
    const activeCompanies = await this.repository.getActiveCompanies();
    const scrapeableCompanies = activeCompanies.filter(
      (company) => !this.isCustomPlatform(company.platform)
    );

    return this.scrapeBatch(scrapeableCompanies, trigger);
  }

  async scrapeCompanies(companyIds: number[], trigger: TriggerSource): Promise<BatchFetchResult> {
    const companyIdsSet = new Set(companyIds);
    const activeCompanies = await this.repository.getActiveCompanies();
    const selectedCompanies = activeCompanies.filter((company) => companyIdsSet.has(company.id));

    return this.scrapeBatch(selectedCompanies, trigger);
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
          { sessionId, triggerSource, filters: options?.filters }
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

  private async scrapeBatch(companiesToScrape: Company[], trigger: TriggerSource): Promise<BatchFetchResult> {
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
    const workerCount = Math.min(maxParallelScrapes, companiesToScrape.length);
    const resultsByIndex: Array<FetchResult | undefined> = new Array(companiesToScrape.length);
    let nextCompanyIndex = 0;
    let stopRequested = false;
    let progressUpdateChain = Promise.resolve();

    const processNextCompany = async (): Promise<void> => {
      while (true) {
        if (stopRequested) {
          return;
        }

        const companyIndex = nextCompanyIndex;
        if (companyIndex >= companiesToScrape.length) {
          return;
        }

        nextCompanyIndex += 1;

        const isSessionActive = await this.repository.isSessionInProgress(sessionId);
        if (!isSessionActive) {
          stopRequested = true;
          console.log(`[ScrapeOrchestrator] Session ${sessionId} stop requested`);
          return;
        }

        const company = companiesToScrape[companyIndex];
        const result = this.isCustomPlatform(company.platform)
          ? this.createSkippedResult(company.id, company.name, "Skipping custom platform company")
          : await this.scrapeCompanyInternal(
              company.id,
              company.name,
              company.careersUrl,
              this.resolvePlatform(company.platform),
              company.boardToken,
              { sessionId, triggerSource: trigger }
            );

        resultsByIndex[companyIndex] = result;
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
    await progressUpdateChain;

    const results = resultsByIndex.filter(
      (entry): entry is FetchResult => entry !== undefined
    );

    const shouldCompleteSession = await this.repository.isSessionInProgress(sessionId);

    if (shouldCompleteSession) {
      await this.repository.completeSession(
        sessionId,
        this.resolveBatchSessionStatus(results)
      );
    }

    const successfulCompanies = results.filter((result) => result.outcome === "success").length;
    const failedCompanies = results.length - successfulCompanies;
    const progress = this.calculateBatchProgress(results);

    logger.batchComplete(successfulCompanies, companiesToScrape.length, progress.totalJobsAdded);

    return {
      sessionId,
      results,
      summary: {
        totalCompanies: companiesToScrape.length,
        successfulCompanies,
        failedCompanies,
        totalJobsFound: progress.totalJobsFound,
        totalJobsAdded: progress.totalJobsAdded,
        totalJobsFiltered: progress.totalJobsFiltered,
        totalJobsArchived: progress.totalJobsArchived,
        totalDuration: Date.now() - sessionStartTime,
      },
    };
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
    options: { sessionId: string; triggerSource: TriggerSource; filters?: JobFilters }
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
      const scraperOptions = this.createScraperOptions(boardToken, filters, existingExternalIds);

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
        duration: Date.now() - startTime,
      });
    }
  }

  private createScraperOptions(
    boardToken: string | null,
    filters: JobFilters,
    existingExternalIds: Set<string>
  ): ScrapeOptions {
    return {
      boardToken: boardToken ?? undefined,
      filters,
      existingExternalIds,
    };
  }

  private resolveScrapeOutcome(scraperResult: ScraperResult<ScrapedJob>): ScrapeOutcome {
    if (scraperResult.outcome) {
      return scraperResult.outcome;
    }
    return scraperResult.success ? "success" : "error";
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

    if (outcome === "error") {
      const errorMessage = scraperResult.error || "Unknown error";
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
      };
    }

    const hasEarlyFilter = Boolean(
      scraperResult.earlyFiltered && scraperResult.earlyFiltered.total > 0
    );
    const totalFetched = hasEarlyFilter
      ? scraperResult.jobs.length + (scraperResult.earlyFiltered?.total || 0)
      : scraperResult.jobs.length;

    if (hasEarlyFilter) {
      logger.fetchedWithEarlyFilter(totalFetched, {
        country: scraperResult.earlyFiltered?.country,
        city: scraperResult.earlyFiltered?.city,
        title: scraperResult.earlyFiltered?.title,
      });
    } else {
      logger.fetched(scraperResult.jobs.length);
    }

    const openExternalIds = Array.from(
      new Set(
        (scraperResult.openExternalIds ?? scraperResult.jobs.map((job) => job.externalId)).filter(
          (externalId): externalId is string => Boolean(externalId)
        )
      )
    );

    const jobsArchived = await this.syncArchivedJobs(
      companyId,
      openExternalIds,
      scraperResult.openExternalIdsComplete,
      platform,
      existingJobs
    );

    const dedupeResult = this.deduplicationService.batchDeduplicate(scraperResult.jobs, existingJobs);
    const filterResult = this.filterService.applyFilters(dedupeResult.newJobs, filters);
    const duplicateHydrationCandidates = this.getDuplicateHydrationCandidates(
      dedupeResult.duplicates,
      existingJobs
    );
    const jobsUpdated = await this.repository.updateExistingJobsFromScrape(duplicateHydrationCandidates);

    if (filterResult.filteredOut > 0 && !hasEarlyFilter) {
      logger.filtered({
        country: filterResult.breakdown.failedCountry > 0 ? filterResult.breakdown.failedCountry : undefined,
        city: filterResult.breakdown.failedCity > 0 ? filterResult.breakdown.failedCity : undefined,
        title: filterResult.breakdown.failedTitle > 0 ? filterResult.breakdown.failedTitle : undefined,
      });
    }

    const insertedJobIds = await this.insertFilteredJobs(companyId, filterResult.filtered);
    const jobsAdded = insertedJobIds.length;

    await this.updateCompanyScrapeMetadata(companyId, boardToken, scraperResult.detectedBoardToken);

    logger.added(jobsAdded, dedupeResult.duplicates.length);

    const matcherConfig = await getMatcherConfig();
    let matchableJobIds: number[] = [];

    if (
      insertedJobIds.length > 0 &&
      this.config.autoMatchAfterScrape &&
      matcherConfig.autoMatchAfterScrape
    ) {
      matchableJobIds = await this.repository.getMatchableJobIds(insertedJobIds);
    }

    const shouldMatch = matchableJobIds.length > 0;

    const logStatus = outcome === "success" ? "success" : "partial";
    const jobsFiltered = filterResult.filteredOut + (scraperResult.earlyFiltered?.total || 0);

    const logId = await this.repository.createScrapingLog({
      companyId,
      sessionId,
      triggerSource,
      platform,
      status: logStatus,
      jobsFound: scraperResult.jobs.length,
      jobsAdded,
      jobsUpdated,
      jobsFiltered,
      jobsArchived,
      duration: Date.now() - startTime,
      completedAt: new Date(),
      matcherStatus: shouldMatch ? "pending" : null,
      matcherJobsTotal: shouldMatch ? matchableJobIds.length : null,
      matcherJobsCompleted: 0,
    });

    if (shouldMatch) {
      this.runBackgroundMatching(matchableJobIds, logId, companyId);
    }

    return {
      outcome,
      jobsFound: scraperResult.jobs.length,
      jobsAdded,
      jobsUpdated,
      jobsFiltered,
      jobsArchived,
      logId,
    };
  }

  private async syncArchivedJobs(
    companyId: number,
    openExternalIds: string[],
    openExternalIdsComplete: boolean | undefined,
    platform: Platform | null,
    existingJobs: Array<{
      id: number;
      externalId: string | null;
      title: string;
      url: string;
      status: string;
      description: string | null;
    }>
  ): Promise<number> {
    let archivedCount = 0;

    if (openExternalIds.length > 0) {
      await this.repository.reopenScraperArchivedJobs(companyId, openExternalIds);
    }

    if (openExternalIdsComplete !== false) {
      if (platform === "uber" && this.shouldSkipUberArchival(openExternalIds, existingJobs)) {
        return 0;
      }

      archivedCount = await this.repository.archiveMissingJobs(
        companyId,
        openExternalIds,
        ARCHIVABLE_JOB_STATUSES
      );
    }

    return archivedCount;
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

  private async insertFilteredJobs(companyId: number, jobs: ScrapedJob[]): Promise<number[]> {
    if (jobs.length === 0) {
      return [];
    }

    return this.repository.insertJobs(
      jobs.map((job) => ({
        companyId,
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
      }))
    );
  }

  private async updateCompanyScrapeMetadata(
    companyId: number,
    boardToken: string | null,
    detectedBoardToken?: string
  ): Promise<void> {
    const companyUpdates: { lastScrapedAt: Date; updatedAt: Date; boardToken?: string } = {
      lastScrapedAt: new Date(),
      updatedAt: new Date(),
    };

    if (detectedBoardToken && !boardToken) {
      companyUpdates.boardToken = detectedBoardToken;
    }

    await this.repository.updateCompany(companyId, companyUpdates);
  }

  private createFetchResult(params: {
    companyId: number;
    companyName: string;
    platform: Platform | null;
    outcome: ScrapeOutcome;
    jobsFound: number;
    jobsAdded: number;
    jobsUpdated: number;
    jobsFiltered: number;
    jobsArchived: number;
    duration: number;
    error?: string;
    logId?: number;
  }): FetchResult {
    return {
      companyId: params.companyId,
      companyName: params.companyName,
      success: params.outcome === "success",
      outcome: params.outcome,
      jobsFound: params.jobsFound,
      jobsAdded: params.jobsAdded,
      jobsUpdated: params.jobsUpdated,
      jobsFiltered: params.jobsFiltered,
      jobsArchived: params.jobsArchived,
      platform: params.platform,
      error: params.error,
      duration: params.duration,
      logId: params.logId,
    };
  }

  private async loadFilters(overrideFilters?: JobFilters): Promise<JobFilters> {
    if (overrideFilters) {
      return { ...this.config.defaultFilters, ...overrideFilters };
    }

    const [country, city, titleKeywordsRaw] = await Promise.all([
      this.repository.getSetting("scraper_filter_country"),
      this.repository.getSetting("scraper_filter_city"),
      this.repository.getSetting("scraper_filter_title_keywords"),
    ]);

    const titleKeywords = parseTitleKeywords(titleKeywordsRaw);

    return {
      ...this.config.defaultFilters,
      country: country || this.config.defaultFilters.country,
      city: city || this.config.defaultFilters.city,
      titleKeywords:
        titleKeywords.length > 0
          ? titleKeywords
          : this.config.defaultFilters.titleKeywords,
    };
  }

  private async loadMaxParallelScrapes(): Promise<number> {
    const configuredValue = await this.repository.getSetting(SCRAPER_MAX_PARALLEL_SCRAPES_KEY);
    const parsed = parseInt(configuredValue ?? "", 10);

    if (
      Number.isNaN(parsed) ||
      parsed < MIN_PARALLEL_SCRAPES ||
      parsed > MAX_PARALLEL_SCRAPES
    ) {
      return DEFAULT_MAX_PARALLEL_SCRAPES;
    }

    return parsed;
  }

  private runBackgroundMatching(
    jobIds: number[],
    logId: number,
    companyId: number
  ): void {
    void (async () => {
      try {
        await this.repository.updateScrapingLog(logId, { matcherStatus: "in_progress" });

        const matcherStartTime = Date.now();

        const result = await matchWithTracking(jobIds, {
          triggerSource: "auto_match",
          companyId,
          onProgress: (progress) => {
            void this.repository
              .updateScrapingLog(logId, { matcherJobsCompleted: progress.completed })
              .catch((e) => console.error("[Matcher] Failed to persist progress:", e));
          },
        });

        await this.repository.updateScrapingLog(logId, {
          matcherStatus: result.failed === result.total ? "failed" : "completed",
          matcherJobsCompleted: result.total,
          matcherErrorCount: result.failed,
          matcherDuration: Date.now() - matcherStartTime,
        });

        console.log(`[Matcher] Completed: ${result.succeeded}/${result.total} jobs matched`);
      } catch (err) {
        console.error("[Matcher] Background matching failed:", err);
        await this.repository.updateScrapingLog(logId, {
          matcherStatus: "failed",
        });
      }
    })();
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
  repository: IScraperRepository;
  registry: IScraperRegistry;
  deduplicationService: IDeduplicationService;
  filterService: IFilterService;
  config?: Partial<OrchestratorConfig>;
}

export function createScrapeOrchestrator(config: CreateOrchestratorConfig): IScrapeOrchestrator {
  return new ScrapeOrchestrator(
    config.repository,
    config.registry,
    config.deduplicationService,
    config.filterService,
    { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config.config }
  );
}
