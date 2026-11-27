import type { ScrapeFetchStateStore } from "@/lib/scraper/infrastructure/fetch-state";
import { createFailureFromUnknown } from "@/lib/scraper/types/validation";
import type { ExistingJob, ScrapeCompanyStore } from "@/lib/scraper/infrastructure/types";
import type { ScrapeOptions } from "@/lib/scraper/core/types";
import {
  isPlatform,
  type BatchDeduplicationResult,
  type DeduplicationMatchReason,
  type Platform,
  type TriggerSource,
  type FetchResult,
  type ScrapeOutcome,
  type ScraperResult,
  type ScrapedJob,
} from "@/lib/scraper/types";
import type { ScrapeSettingsProvider } from "@/lib/scraper/settings/provider";
import { ScraperLogger } from "@/lib/scraper/utils/logger";

import { selectFreshJobIdentities } from "../services/job-refresh-policy";
import { DescriptionRefreshBudget } from "../services/description-refresh-budget";
import { prepareListingScope } from "../services/listing-scope";
import { canArchiveMissingJobs } from "../services/listing-reconciliation";
import type { IDeduplicationService } from "../services/deduplication-service";
import type { IFilterService, JobFilters } from "../services/filter-service";
import type { IScraperRegistry } from "../services/registry";

export interface ScrapeCompanyPipelineConfig {
  autoMatchAfterScrape: boolean;
  defaultFilters: JobFilters;
  detailsRefreshIntervalMs?: number;
  maxExistingDetailsPerRun?: number;
  maxExistingDetailsPerSession?: number;
  detailsRefreshCooldownMs?: number;
}

export const DEFAULT_SCRAPE_COMPANY_PIPELINE_CONFIG: ScrapeCompanyPipelineConfig = {
  autoMatchAfterScrape: true,
  defaultFilters: {},
};

const ARCHIVABLE_JOB_STATUSES = ["new", "viewed", "interested", "rejected"] as const;
const SAFE_HYDRATION_MATCH_REASONS: DeduplicationMatchReason[] = ["externalId", "url"];

class ScrapingLogWriteError extends Error {
  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? `Failed to persist scrape error log: ${cause.message}`
        : "Failed to persist scrape error log",
      { cause }
    );
    this.name = "ScrapingLogWriteError";
  }
}

export interface ScrapeCompanyRequest {
  sessionId: string;
  triggerSource: TriggerSource;
  signal?: AbortSignal;
  /**
   * Queue attempt tracking. When a retryable failure happens before the final
   * attempt, the error log write is skipped so each (session, company) pair
   * leaves exactly one terminal log row instead of one per attempt.
   */
  attemptCount?: number;
  maxAttempts?: number;
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
  warnings?: string[];
}

interface DuplicateHydrationCandidate {
  existingJobId: number;
  job: ScrapedJob;
  detailsFetchedAt?: Date;
}

export interface ScrapePipelineDependencies {
  fetchState?: ScrapeFetchStateStore;
  now?: () => Date;
  matchingEnabled: () => Promise<boolean>;
  dispatchMatching: () => Promise<unknown>;
}

export class ScrapeCompanyPipeline {
  private readonly refreshBudget: DescriptionRefreshBudget;
  constructor(
    private readonly repository: ScrapeCompanyStore,
    private readonly registry: IScraperRegistry,
    private readonly deduplicationService: IDeduplicationService,
    private readonly filterService: IFilterService,
    private readonly config: ScrapeCompanyPipelineConfig,
    private readonly settingsProvider: ScrapeSettingsProvider,
    private readonly dependencies: ScrapePipelineDependencies
  ) {
    this.refreshBudget = new DescriptionRefreshBudget(dependencies.fetchState);
  }

  async scrape(
    companyId: number,
    request: ScrapeCompanyRequest
  ): Promise<FetchResult> {
    const company = await this.repository.getCompany(companyId);

    if (!company) {
      return this.createErrorResult(companyId, "Unknown", "Company not found");
    }

    return this.isCustomPlatform(company.platform)
      ? this.createSkippedResult(company.id, company.name, "Skipping custom platform company")
      : await this.scrapeCompanyInternal(
          company.id,
          company.name,
          company.careersUrl,
          this.resolvePlatform(company.platform),
          company.boardToken,
          request
        );
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
      signal?: AbortSignal;
      attemptCount?: number;
      maxAttempts?: number;
    }
  ): Promise<FetchResult> {
    const startTime = Date.now();
    let fetchStartedAt: number | null = null;
    let fetchDuration: number | undefined;
    let processingStartedAt: number | null = null;
    const logger = new ScraperLogger(companyName, platform || "auto-detect");

    logger.start();

    try {
      const existingJobs = await this.repository.getExistingJobs(companyId);
      const freshIdentities = selectFreshJobIdentities(existingJobs,
        this.dependencies.now?.() ?? new Date(), this.config.detailsRefreshIntervalMs,
        this.config.maxExistingDetailsPerRun);
      const { existingExternalIds } = freshIdentities;

      const filters = await this.loadFilters();
      const scraperOptions = this.createScraperOptions(
        boardToken,
        filters,
        existingExternalIds,
        options.signal
      );
      scraperOptions.existingJobUrls = freshIdentities.existingJobUrls;
      scraperOptions.detailRefresh = freshIdentities.detailRefresh;
      scraperOptions.detailRefresh.reserve = (requested) => this.refreshBudget.reserve(
        options.sessionId, companyId, requested, this.dependencies.now?.() ?? new Date(),
        this.config.maxExistingDetailsPerSession, this.config.detailsRefreshCooldownMs
      );

      fetchStartedAt = Date.now();
      const scraperResult = await this.registry.scrape(
        careersUrl,
        platform ?? undefined,
        scraperOptions
      );
      fetchDuration = Date.now() - fetchStartedAt;
      processingStartedAt = Date.now();

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
        fetchDuration,
        processingStartedAt,
        logger,
        attemptCount: options.attemptCount,
        maxAttempts: options.maxAttempts,
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

      const { retryable, retryAfterMs } = createFailureFromUnknown(error).error;

      // The queue retries retryable failures, so only the terminal attempt
      // writes an error log. Otherwise every retry leaves its own row and a
      // single outage produces N log rows per company.
      const terminalAttempt = this.isTerminalAttempt(
        retryable,
        options.attemptCount,
        options.maxAttempts
      );
      if (terminalAttempt && !(error instanceof ScrapingLogWriteError)) {
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
          fetchDuration:
            fetchDuration ??
            (fetchStartedAt === null ? undefined : Date.now() - fetchStartedAt),
          processingDuration:
            processingStartedAt === null
              ? undefined
              : Date.now() - processingStartedAt,
          completedAt: new Date(),
        });
      }
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
        retryable,
        retryAfterMs,
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

  /**
   * Mirrors the queue runner's retry predicate (`attemptCount < maxAttempts`
   * in `LocalLeasedWorkRunner`): a retryable failure is terminal only on the
   * final attempt. Callers without attempt tracking default to terminal so
   * error logs are always written.
   */
  private isTerminalAttempt(
    retryable: boolean,
    attemptCount?: number,
    maxAttempts?: number
  ): boolean {
    if (!retryable) return true;
    return Math.max(1, attemptCount ?? 1) >= Math.max(1, maxAttempts ?? 1);
  }

  private async processScraperResult(params: {
    scraperResult: ScraperResult<ScrapedJob>;
    companyId: number;
    platform: Platform | null;
    boardToken: string | null;
    existingJobs: ExistingJob[];
    filters: JobFilters;
    sessionId: string;
    triggerSource: TriggerSource;
    startTime: number;
    fetchDuration: number;
    processingStartedAt: number;
    logger: ScraperLogger;
    attemptCount?: number;
    maxAttempts?: number;
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
      fetchDuration,
      processingStartedAt,
      logger,
      attemptCount,
      maxAttempts,
    } = params;

    const outcome = this.resolveScrapeOutcome(scraperResult);

    if (scraperResult.outcome === "error") {
      const errorMessage = scraperResult.error.code === "board_not_found"
        ? `Source needs repair: ${scraperResult.error.message}`
        : scraperResult.error.message;
      logger.error(errorMessage);

      // Mirror the catch-block policy: retryable failures before the final
      // attempt leave no log row; the terminal attempt records the outcome.
      if (
        !(scraperResult.error.code === "rate_limited" && attemptCount !== undefined) &&
        this.isTerminalAttempt(scraperResult.error.retryable, attemptCount, maxAttempts)
      ) {
        try {
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
            fetchDuration,
            processingDuration: Date.now() - processingStartedAt,
            completedAt: new Date(),
          });
        } catch (error) {
          throw new ScrapingLogWriteError(error);
        }
      }

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

    const listingJobs = scraperResult.listingJobs ?? scraperResult.jobs;
    const existingByUrl = new Map(existingJobs.map((job) => [job.url, job]));
    const openExternalIds = Array.from(new Set([
      ...(scraperResult.openExternalIds ?? listingJobs.map((job) => job.externalId)),
      // Preserve historical identities when a source changes its ID or a detail
      // failure only leaves the listing URL available.
      ...listingJobs.flatMap((job) => existingByUrl.get(job.url)?.externalId ?? []),
    ].filter(Boolean)));
    const existingByExternalId = new Map(existingJobs.map((job) => [job.externalId, job]));
    const jobsByUrl = new Map(listingJobs.filter((job) => existingByUrl.has(job.url) || existingByExternalId.has(job.externalId))
      .map((job) => [job.url, job]));
    for (const job of scraperResult.jobs) jobsByUrl.set(job.url, job);

    // Stale archival is only safe on exact listings. Tolerance-completed
    // runs (fetched < advertised) skip it: the gap may still be open, and
    // archiving it would flip live jobs to archived until the next run.
    // Unknown totals (field absent) preserve legacy behavior.
    const listingsExact =
      scraperResult.advertisedTotal == null || totalFetched >= scraperResult.advertisedTotal;
    const completeListing = scraperResult.listingCompleteness === "complete" && listingsExact;
    const scope = prepareListingScope({
      companyId, scopeKey: scraperResult.listingScopeKey, existing: existingJobs,
      openIds: openExternalIds, complete: completeListing,
      now: this.dependencies.now?.() ?? new Date(), state: this.dependencies.fetchState,
    });
    const archival = canArchiveMissingJobs({
      companyId, source: scraperResult.listingScopeKey ?? `${platform}:${boardToken}`, existing: scope.existing,
      complete: completeListing && scope.canArchive,
      openIds: openExternalIds, now: this.dependencies.now?.() ?? new Date(),
      state: this.dependencies.fetchState,
    });
    const archiveMissing = archival.allowed;

    const dedupeResult = this.deduplicationService.batchDeduplicate(
      [...jobsByUrl.values()],
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

    const matchingEnabled = this.config.autoMatchAfterScrape && await this.dependencies.matchingEnabled();
    const logStatus = outcome === "success" ? "success" : "partial";
    // Issues on a success outcome are tolerated gaps (see completeness
    // helper); surface them as warnings instead of dropping them. The
    // error branch above returns early, so only success/partial reach here.
    const scraperWarnings = [ ...(scraperResult.issues?.map((issue) => issue.message) ?? []),
      ...(archival.warning ? [archival.warning] : [])];
    const jobsFiltered = filterResult.filteredOut + (scraperResult.earlyFiltered?.total || 0);
    const persistenceStartedAtMs = Date.now();
    const persistenceResult = await this.repository.persistScrapeResult({
      companyId,
      openExternalIds,
      archiveMissing,
      archiveCandidateExternalIds: scope.candidateExternalIds,
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
        seniorityLevel: job.seniorityLevel,
        postedDate: job.postedDate,
        sourceUpdatedAt: job.sourceUpdatedAt,
        sourceLocations: job.locations,
        lastSeenAt: new Date(startTime),
        detailsFetchedAt: job.description?.trim() && job.descriptionQuality !== "teaser" ? new Date(startTime) : undefined,
        descriptionQuality: job.descriptionQuality,
        status: "new" as const,
      })),
      existingJobUpdates: duplicateHydrationCandidates,
      companyBoardToken:
        scraperResult.detectedBoardToken && !boardToken
          ? scraperResult.detectedBoardToken
          : undefined,
      startedAtMs: startTime,
      persistenceStartedAtMs,
      enableMatching:
        this.config.autoMatchAfterScrape && matchingEnabled,
      log: {
        sessionId,
        triggerSource,
        platform,
        status: logStatus,
        jobsFound: totalFetched,
        jobsFiltered,
        errorMessage: scraperWarnings?.join("; "),
        fetchDuration,
        processingDuration: persistenceStartedAtMs - processingStartedAt,
      },
    });

    scope.commit(archiveMissing);
    logger.added(persistenceResult.jobsAdded, dedupeResult.duplicates.length);
    if (persistenceResult.matchOutboxId) {
      void this.dependencies.dispatchMatching();
    }

    // Persistence-level skips (e.g. unresolvable URL collisions) are merged
    // into the scraping log by the repository and surfaced here without
    // flipping an otherwise successful scrape to partial.
    const warnings = [...(scraperWarnings ?? []), ...(persistenceResult.warnings ?? [])];

    return {
      outcome,
      jobsFound: totalFetched,
      jobsAdded: persistenceResult.jobsAdded,
      jobsUpdated: persistenceResult.jobsUpdated,
      jobsFiltered,
      jobsArchived: persistenceResult.jobsArchived,
      logId: persistenceResult.logId,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  private getDuplicateHydrationCandidates(
    duplicates: BatchDeduplicationResult["duplicates"],
    existingJobs: ExistingJob[]
  ): DuplicateHydrationCandidate[] {
    const existingById = new Map(existingJobs.map((job) => [job.id, job]));
    const fields = [
      "title", "url", "location", "locationType", "department", "salary",
      "employmentType", "seniorityLevel", "description", "descriptionFormat",
      "postedDate", "sourceUpdatedAt", "descriptionQuality",
    ] as const;
    const candidates: DuplicateHydrationCandidate[] = [];
    for (const duplicate of duplicates) {
      if (!SAFE_HYDRATION_MATCH_REASONS.includes(duplicate.matchReason)) continue;
      const existing = existingById.get(duplicate.existingJobId);
      if (!existing) continue;
      const job = { ...duplicate.job };
      if (!this.hasNonEmptyDescription(job.description) ||
          (job.descriptionQuality === "teaser" && this.hasNonEmptyDescription(existing.description))) {
        delete job.description;
        delete job.descriptionFormat;
        delete job.descriptionQuality;
      }
      const changed = fields.some((field) => {
        const value = job[field];
        if (value === undefined) return false;
        const previous = existing[field];
        return value instanceof Date ? value.getTime() !== (previous instanceof Date ? previous.getTime() : null)
          : value !== previous;
      });
      const detailsFetchedAt = job.description?.trim() && job.descriptionQuality !== "teaser"
        ? this.dependencies.now?.() ?? new Date() : undefined;
      const locationsChanged = job.locations !== undefined &&
        job.locations.join(";") !== (existing.sourceLocations ?? []).join(";");
      if (changed || detailsFetchedAt || locationsChanged) {
        candidates.push({ existingJobId: existing.id, job, ...(detailsFetchedAt ? { detailsFetchedAt } : {}) });
      }
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
    warnings?: string[];
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
      warnings: params.warnings,
      duration: params.duration,
      logId: params.logId,
    };
  }

  private async loadFilters(): Promise<JobFilters> {
    return this.settingsProvider.getFilters(this.config.defaultFilters);
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

export interface CreateScrapeCompanyPipelineConfig {
  repository: ScrapeCompanyStore;
  registry: IScraperRegistry;
  deduplicationService: IDeduplicationService;
  filterService: IFilterService;
  settingsProvider: ScrapeSettingsProvider;
  config?: Partial<ScrapeCompanyPipelineConfig>;
  dependencies: ScrapePipelineDependencies;
}

export function createScrapeCompanyPipeline(
  config: CreateScrapeCompanyPipelineConfig
): ScrapeCompanyPipeline {
  return new ScrapeCompanyPipeline(
    config.repository,
    config.registry,
    config.deduplicationService,
    config.filterService,
    { ...DEFAULT_SCRAPE_COMPANY_PIPELINE_CONFIG, ...config.config },
    config.settingsProvider,
    config.dependencies
  );
}
