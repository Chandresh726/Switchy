import type { Platform, TriggerSource, FetchResult, BatchFetchResult } from "@/lib/scraper/types";
import type { IScraperRepository } from "@/lib/scraper/infrastructure/types";
import type { IScraperRegistry } from "./registry";
import type { IDeduplicationService } from "./deduplication-service";
import type { IFilterService, JobFilters } from "./filter-service";
import { parseTitleKeywords } from "./filter-service";
import type { ScrapeOptions } from "@/lib/scraper/core/types";
import { ScraperLogger } from "@/lib/scraper/utils/logger";

import { matchWithTracking, getMatcherConfig } from "@/lib/ai/matcher";

export interface OrchestratorConfig {
  autoMatchAfterScrape: boolean;
  defaultFilters: JobFilters;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  autoMatchAfterScrape: true,
  defaultFilters: {},
};

const ARCHIVABLE_JOB_STATUSES = ["new", "viewed", "interested", "rejected"];

export interface IScrapeOrchestrator {
  scrapeAllCompanies(trigger: TriggerSource): Promise<BatchFetchResult>;
  scrapeCompany(companyId: number, options?: ScrapeCompanyOptions): Promise<FetchResult>;
}

export interface ScrapeCompanyOptions {
  sessionId?: string;
  triggerSource?: TriggerSource;
  filters?: JobFilters;
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
    const sessionId = crypto.randomUUID();
    const sessionStartTime = Date.now();

    const activeCompanies = await this.repository.getActiveCompanies();
    
    const logger = new ScraperLogger("", "");
    logger.batchStart(activeCompanies.length);

    await this.repository.createSession({
      id: sessionId,
      triggerSource: trigger,
      status: "in_progress",
      companiesTotal: activeCompanies.length,
    });

    const results: FetchResult[] = [];

    for (const company of activeCompanies) {
      const result = await this.scrapeCompanyInternal(
        company.id,
        company.name,
        company.careersUrl,
        company.platform as Platform | null,
        company.boardToken,
        { sessionId, triggerSource: trigger }
      );
      results.push(result);

      const totalJobsFound = results.reduce((sum, r) => sum + r.jobsFound, 0);
      const totalJobsAdded = results.reduce((sum, r) => sum + r.jobsAdded, 0);
      const totalJobsFiltered = results.reduce((sum, r) => sum + r.jobsFiltered, 0);

      await this.repository.updateSessionProgress(sessionId, {
        companiesCompleted: results.length,
        totalJobsFound,
        totalJobsAdded,
        totalJobsFiltered,
      });
    }

    const totalDuration = Date.now() - sessionStartTime;
    const successfulCompanies = results.filter((r) => r.success).length;
    const hasFailures = results.some((r) => !r.success);

    await this.repository.completeSession(sessionId, hasFailures);

    const totalJobsAdded = results.reduce((sum, r) => sum + r.jobsAdded, 0);
    logger.batchComplete(successfulCompanies, activeCompanies.length, totalJobsAdded);

    return {
      sessionId,
      results,
      summary: {
        totalCompanies: activeCompanies.length,
        successfulCompanies,
        failedCompanies: results.length - successfulCompanies,
        totalJobsFound: results.reduce((sum, r) => sum + r.jobsFound, 0),
        totalJobsAdded,
        totalJobsFiltered: results.reduce((sum, r) => sum + r.jobsFiltered, 0),
        totalDuration,
      },
    };
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

    const result = await this.scrapeCompanyInternal(
      company.id,
      company.name,
      company.careersUrl,
      company.platform as Platform | null,
      company.boardToken,
      { sessionId, triggerSource, filters: options?.filters }
    );

    if (isStandaloneRefresh) {
      await this.repository.updateSessionProgress(sessionId, {
        companiesCompleted: 1,
        totalJobsFound: result.jobsFound,
        totalJobsAdded: result.jobsAdded,
        totalJobsFiltered: result.jobsFiltered,
      });
      await this.repository.completeSession(sessionId, !result.success);
    }

    return result;
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
    const platformLabel = platform || "auto-detect";
    const logger = new ScraperLogger(companyName, platformLabel);

    logger.start();

    try {
      const existingJobs = await this.repository.getExistingJobs(companyId);
      const existingExternalIds = new Set<string>(
        existingJobs.map((j) => j.externalId).filter((id): id is string => Boolean(id))
      );

      const filters = await this.loadFilters(options.filters);

      const scraperOptions: ScrapeOptions = {
        boardToken: boardToken ?? undefined,
        filters,
        existingExternalIds,
      };

      const scraperResult = await this.registry.scrape(
        careersUrl,
        platform ?? undefined,
        scraperOptions
      );

      if (!scraperResult.success) {
        logger.error(scraperResult.error || "Unknown error");
        
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
          errorMessage: scraperResult.error,
          duration: Date.now() - startTime,
          completedAt: new Date(),
        });

        return {
          companyId,
          companyName,
          success: false,
          jobsFound: 0,
          jobsAdded: 0,
          jobsUpdated: 0,
          jobsFiltered: 0,
          platform,
          error: scraperResult.error,
          duration: Date.now() - startTime,
        };
      }

      const hasEarlyFilter = scraperResult.earlyFiltered && scraperResult.earlyFiltered.total > 0;
      const totalFetched = hasEarlyFilter
        ? scraperResult.jobs.length + scraperResult.earlyFiltered!.total
        : scraperResult.jobs.length;

      if (hasEarlyFilter) {
        logger.fetchedWithEarlyFilter(totalFetched, {
          country: scraperResult.earlyFiltered!.country,
          city: scraperResult.earlyFiltered!.city,
          title: scraperResult.earlyFiltered!.title,
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

      if (openExternalIds.length > 0) {
        await this.repository.reopenScraperArchivedJobs(companyId, openExternalIds);
      }

      if (scraperResult.openExternalIdsComplete !== false) {
        await this.repository.archiveMissingJobs(
          companyId,
          openExternalIds,
          ARCHIVABLE_JOB_STATUSES
        );
      }

      const { newJobs, duplicates } = this.deduplicationService.batchDeduplicate(
        scraperResult.jobs,
        existingJobs
      );

      const { filtered, filteredOut, breakdown } = this.filterService.applyFilters(newJobs, filters);

      if (filteredOut > 0 && !hasEarlyFilter) {
        logger.filtered({
          country: breakdown.failedCountry > 0 ? breakdown.failedCountry : undefined,
          city: breakdown.failedCity > 0 ? breakdown.failedCity : undefined,
          title: breakdown.failedTitle > 0 ? breakdown.failedTitle : undefined,
        });
      }

      let jobsAdded = 0;
      let insertedJobIds: number[] = [];

      if (filtered.length > 0) {
        insertedJobIds = await this.repository.insertJobs(
          filtered.map((job) => ({
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
        jobsAdded = insertedJobIds.length;
      }

      const companyUpdates: { lastScrapedAt: Date; updatedAt: Date; boardToken?: string } = {
        lastScrapedAt: new Date(),
        updatedAt: new Date(),
      };

      if (scraperResult.detectedBoardToken && !boardToken) {
        companyUpdates.boardToken = scraperResult.detectedBoardToken;
      }

      await this.repository.updateCompany(companyId, companyUpdates);

      logger.added(jobsAdded, duplicates.length);

      const matcherConfig = await getMatcherConfig();
      const shouldMatch = insertedJobIds.length > 0 && matcherConfig.autoMatchAfterScrape;

      const logId = await this.repository.createScrapingLog({
        companyId,
        sessionId: options.sessionId,
        triggerSource: options.triggerSource,
        platform,
        status: "success",
        jobsFound: scraperResult.jobs.length,
        jobsAdded,
        jobsUpdated: duplicates.length,
        jobsFiltered: filteredOut + (scraperResult.earlyFiltered?.total || 0),
        duration: Date.now() - startTime,
        completedAt: new Date(),
        matcherStatus: shouldMatch ? "pending" : null,
        matcherJobsTotal: shouldMatch ? insertedJobIds.length : null,
        matcherJobsCompleted: 0,
      });

      if (shouldMatch) {
        this.runBackgroundMatching(insertedJobIds, logId, companyId);
      }

      return {
        companyId,
        companyName,
        success: true,
        jobsFound: scraperResult.jobs.length,
        jobsAdded,
        jobsUpdated: duplicates.length,
        jobsFiltered: filteredOut + (scraperResult.earlyFiltered?.total || 0),
        platform,
        duration: Date.now() - startTime,
        logId,
      };
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
        errorMessage,
        duration: Date.now() - startTime,
        completedAt: new Date(),
      });

      return {
        companyId,
        companyName,
        success: false,
        jobsFound: 0,
        jobsAdded: 0,
        jobsUpdated: 0,
        jobsFiltered: 0,
        platform,
        error: errorMessage,
        duration: Date.now() - startTime,
      };
    }
  }

  private async loadFilters(overrideFilters?: JobFilters): Promise<JobFilters> {
    if (overrideFilters) {
      return overrideFilters;
    }

    const [country, city, titleKeywordsRaw] = await Promise.all([
      this.repository.getSetting("scraper_filter_country"),
      this.repository.getSetting("scraper_filter_city"),
      this.repository.getSetting("scraper_filter_title_keywords"),
    ]);

    const titleKeywords = parseTitleKeywords(titleKeywordsRaw);

    return {
      country: country || undefined,
      city: city || undefined,
      titleKeywords: titleKeywords.length > 0 ? titleKeywords : undefined,
    };
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
          triggerSource: "scheduler",
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
    
    return {
      companyId,
      companyName,
      success: false,
      jobsFound: 0,
      jobsAdded: 0,
      jobsUpdated: 0,
      jobsFiltered: 0,
      platform: null,
      error,
      duration: 0,
    };
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
