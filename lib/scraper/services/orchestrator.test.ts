import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Company } from "@/lib/db/schema";
import type { ExistingJob } from "@/lib/scraper/infrastructure/types";
import type { IScraper } from "@/lib/scraper/core/types";
import type { Platform, ScrapeOptions, ScraperResult } from "@/lib/scraper/types";
import { TitleBasedDeduplicationService } from "@/lib/scraper/services/deduplication-service";
import { DefaultFilterService } from "@/lib/scraper/services/filter-service";
import { ScrapeOrchestrator } from "@/lib/scraper/services/orchestrator";

const matcherMocks = vi.hoisted(() => ({
  getMatcherConfig: vi.fn(),
}));

const outboxMocks = vi.hoisted(() => ({
  dispatchPendingScrapeMatches: vi.fn(),
}));

vi.mock("@/lib/ai/matcher", () => ({
  getMatcherConfig: matcherMocks.getMatcherConfig,
}));

vi.mock("@/lib/scraper/matching", () => ({
  dispatchPendingScrapeMatches: outboxMocks.dispatchPendingScrapeMatches,
}));

const company: Company = {
  id: 1,
  name: "Acme",
  careersUrl: "https://jobs.example.com",
  logoUrl: null,
  notes: null,
  platform: "greenhouse",
  boardToken: null,
  isActive: true,
  lastScrapedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const companyTwo = {
  ...company,
  id: 2,
  name: "Globex",
} as Company;

const uberCompany = {
  ...company,
  id: 3,
  name: "Uber",
  platform: "uber",
} as Company;

const customCompany = {
  ...company,
  id: 4,
  name: "Custom Co",
  careersUrl: "https://careers.example.com",
  platform: "custom",
} as Company;

interface RepositoryMockOptions {
  activeCompanies?: Company[];
  insertedJobIds?: number[];
  matchableJobIds?: number[];
  existingJobs?: ExistingJob[];
  updatedExistingJobsCount?: number;
  jobsArchived?: number;
  settingValues?: Record<string, string | null | undefined>;
}

function createRepositoryMock(options: RepositoryMockOptions = {}) {
  const activeCompanies = options.activeCompanies ?? [company];
  const insertedJobIds = options.insertedJobIds ?? [101];
  const matchableJobIds = options.matchableJobIds ?? insertedJobIds;
  const existingJobs = options.existingJobs ?? [];
  const updatedExistingJobsCount = options.updatedExistingJobsCount ?? 0;
  const jobsArchived = options.jobsArchived ?? 0;
  const settingValues = options.settingValues ?? {};

  return {
    getCompany: vi.fn(async (id: number) => activeCompanies.find((item) => item.id === id) ?? null),
    getActiveCompanies: vi.fn(async () => activeCompanies),
    getExistingJobs: vi.fn(async () => existingJobs),
    getSetting: vi.fn(async (key: string) => settingValues[key] ?? null),
    persistScrapeResult: vi.fn(async (input: { enableMatching: boolean }) => {
      const persistedMatchableJobIds = input.enableMatching ? matchableJobIds : [];
      return {
        insertedJobIds,
        matchableJobIds: persistedMatchableJobIds,
        jobsAdded: insertedJobIds.length,
        jobsUpdated: updatedExistingJobsCount,
        jobsArchived,
        logId: 7,
        matchOutboxId: persistedMatchableJobIds.length > 0 ? "outbox-1" : null,
      };
    }),
    createSession: vi.fn(async () => undefined),
    isSessionInProgress: vi.fn(async () => true),
    stopSession: vi.fn(async () => true),
    updateSessionProgress: vi.fn(async () => undefined),
    completeSession: vi.fn(async () => undefined),
    createScrapingLog: vi.fn(async () => 7),
    acquireSchedulerLock: vi.fn(async () => null),
    refreshSchedulerLock: vi.fn(async () => null),
    releaseSchedulerLock: vi.fn(async () => undefined),
  };
}

function createActiveCompanies(count: number): Company[] {
  return Array.from({ length: count }, (_, index) => ({
    ...company,
    id: index + 1,
    name: `Company ${index + 1}`,
    careersUrl: `https://jobs.example.com/${index + 1}`,
  }));
}

interface RegistryMockOptions {
  scrapersByPlatform?: Partial<Record<Platform, { requiresBrowser: boolean }>>;
}

const DEFAULT_SCRAPER_MAP: Partial<Record<Platform, { requiresBrowser: boolean }>> = {
  greenhouse: { requiresBrowser: false },
  servicenow: { requiresBrowser: true },
  zwayam: { requiresBrowser: false },
  mynexthire: { requiresBrowser: false },
  visa: { requiresBrowser: false },
};

function createRegistryMock(
  result:
    | ScraperResult
    | ((
        url: string,
        platform?: Platform | null,
        options?: ScrapeOptions
      ) => Promise<ScraperResult>),
  options: RegistryMockOptions = {}
) {
  const scrape = typeof result === "function"
    ? vi.fn(result)
    : vi.fn(async () => result);

  const scraperMap = { ...DEFAULT_SCRAPER_MAP, ...options.scrapersByPlatform };
  const getScraperByPlatform = vi.fn((platform: Platform) => {
    const config = scraperMap[platform];
    if (!config) return null;
    return {
      platform,
      requiresBrowser: config.requiresBrowser,
      capabilities: {
        transport: config.requiresBrowser ? "browser" : "http",
        concurrency:
          platform === "workday" || platform === "eightfold" ? "serial" : "parallel",
        supportsCancellation: true,
      },
      validate: vi.fn(),
      scrape: vi.fn(),
      extractIdentifier: vi.fn(),
    } satisfies IScraper;
  });

  return {
    register: vi.fn(),
    getScraperForUrl: vi.fn(),
    getScraperByPlatform,
    scrape,
    getSupportedPlatforms: vi.fn(() => Object.keys(scraperMap) as Platform[]),
  };
}

describe("ScrapeOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matcherMocks.getMatcherConfig.mockResolvedValue({ autoMatchAfterScrape: false });
  });

  it("maps partial scraper results to failed FetchResult and partial log status", async () => {
    const repository = createRepositoryMock();
    const registry = createRegistryMock({
      outcome: "partial",
      jobs: [
        {
          externalId: "greenhouse-acme-1",
          title: "Software Engineer",
          url: "https://jobs.example.com/1",
        },
      ],
      totalListings: 1,
      openExternalIds: ["greenhouse-acme-1"],
      listingCompleteness: "partial",
    });

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    const result = await orchestrator.scrapeCompany(company.id, {
      sessionId: "session-1",
      triggerSource: "manual",
    });

    expect(result.outcome).toBe("partial");
    expect(result.success).toBe(false);
    expect(repository.persistScrapeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        archiveMissing: false,
        log: expect.objectContaining({ status: "partial" }),
      })
    );
  });

  it("passes a standalone cancellation signal into the scraper registry", async () => {
    const repository = createRepositoryMock();
    const registry = createRegistryMock({
      outcome: "success",
      jobs: [],
      totalListings: 0,
      openExternalIds: [],
      listingCompleteness: "complete",
    });
    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: false, defaultFilters: {} }
    );
    const controller = new AbortController();

    await orchestrator.scrapeCompany(company.id, { signal: controller.signal });

    expect(registry.scrape).toHaveBeenCalledWith(
      company.careersUrl,
      company.platform,
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it("aborts an in-flight batch scrape and does not start the next company", async () => {
    const repository = createRepositoryMock({
      activeCompanies: createActiveCompanies(2),
      insertedJobIds: [],
      settingValues: { scraper_max_parallel_scrapes: "1" },
    });
    const registry = createRegistryMock(async (_url, _platform, options) => {
      const signal = options?.signal;
      return new Promise<ScraperResult>((resolve) => {
        const finish = () => resolve({
          outcome: "error",
          jobs: [],
          listingCompleteness: "unknown",
          error: {
            code: "cancelled",
            message: "Batch scrape cancelled",
            retryable: false,
          },
        });
        if (signal?.aborted) finish();
        else signal?.addEventListener("abort", finish, { once: true });
      });
    });
    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: false, defaultFilters: {} }
    );
    const controller = new AbortController();
    const batch = orchestrator.scrapeAllCompanies("manual", {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(registry.scrape).toHaveBeenCalledTimes(1));

    controller.abort(new DOMException("Batch scrape cancelled", "AbortError"));
    await batch;

    expect(registry.scrape).toHaveBeenCalledTimes(1);
    expect(repository.completeSession).toHaveBeenCalledWith(expect.any(String), "failed");
  });

  it("rechecks cancellation after the persisted session lookup", async () => {
    const repository = createRepositoryMock({
      activeCompanies: [company],
      insertedJobIds: [],
    });
    let finishSessionLookup: ((active: boolean) => void) | undefined;
    repository.isSessionInProgress.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => {
        finishSessionLookup = resolve;
      })
    );
    const registry = createRegistryMock({
      outcome: "success",
      jobs: [],
      totalListings: 0,
      openExternalIds: [],
      listingCompleteness: "complete",
    });
    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: false, defaultFilters: {} }
    );
    const controller = new AbortController();
    const batch = orchestrator.scrapeAllCompanies("manual", {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(repository.isSessionInProgress).toHaveBeenCalled());

    controller.abort(new DOMException("Batch scrape cancelled", "AbortError"));
    finishSessionLookup?.(true);
    await batch;

    expect(registry.scrape).not.toHaveBeenCalled();
  });

  it("aborts an active company when the persisted batch session is stopped", async () => {
    const repository = createRepositoryMock({
      activeCompanies: createActiveCompanies(2),
      insertedJobIds: [],
      settingValues: { scraper_max_parallel_scrapes: "1" },
    });
    repository.isSessionInProgress
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    let activeSignal: AbortSignal | undefined;
    const registry = createRegistryMock(async (_url, _platform, options) => {
      activeSignal = options?.signal;
      return new Promise<ScraperResult>((resolve) => {
        const finish = () => resolve({
          outcome: "error",
          jobs: [],
          listingCompleteness: "unknown",
          error: {
            code: "cancelled",
            message: "Scrape session stopped",
            retryable: false,
          },
        });
        if (activeSignal?.aborted) finish();
        else activeSignal?.addEventListener("abort", finish, { once: true });
      });
    });
    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: false, defaultFilters: {} }
    );

    await orchestrator.scrapeAllCompanies("manual");

    expect(activeSignal?.aborted).toBe(true);
    expect(registry.scrape).toHaveBeenCalledTimes(1);
    expect(repository.completeSession).not.toHaveBeenCalled();
  });

  it("includes early-filtered listings in persisted and returned jobsFound totals", async () => {
    const repository = createRepositoryMock();
    const registry = createRegistryMock({
      outcome: "success",
      jobs: [
        {
          externalId: "greenhouse-acme-1",
          title: "Software Engineer",
          url: "https://jobs.example.com/1",
        },
      ],
      earlyFiltered: { total: 4, country: 4 },
      totalListings: 9,
      openExternalIds: Array.from(
        { length: 9 },
        (_, index) => `greenhouse-acme-${index + 1}`
      ),
      listingCompleteness: "complete",
    });
    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    const result = await orchestrator.scrapeCompany(company.id, {
      sessionId: "session-early-filter",
      triggerSource: "manual",
    });

    expect(result.jobsFound).toBe(9);
    expect(repository.persistScrapeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        log: expect.objectContaining({ jobsFound: 9, jobsFiltered: 4 }),
      })
    );
  });

  it("treats partial company outcomes as batch failures", async () => {
    const repository = createRepositoryMock();
    const registry = createRegistryMock({
      outcome: "partial",
      jobs: [],
      totalListings: 0,
      openExternalIds: [],
      listingCompleteness: "partial",
    });

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    const result = await orchestrator.scrapeCompanies([company.id], "manual");

    expect(result.summary.totalCompanies).toBe(1);
    expect(result.summary.failedCompanies).toBe(1);
    expect(repository.completeSession).toHaveBeenCalledWith(result.sessionId, "partial");
  });

  it("reports unsupported custom companies as skipped without scraping", async () => {
    const repository = createRepositoryMock({
      activeCompanies: [customCompany],
    });
    const registry = createRegistryMock({
      outcome: "success",
      jobs: [],
      totalListings: 0,
      openExternalIds: [],
      listingCompleteness: "complete",
    });

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    const result = await orchestrator.scrapeCompanies([customCompany.id], "manual");

    expect(result.summary.totalCompanies).toBe(1);
    expect(result.summary.successfulCompanies).toBe(0);
    expect(result.summary.skippedCompanies).toBe(1);
    expect(result.summary.failedCompanies).toBe(0);
    expect(result.results[0]).toMatchObject({
      companyId: customCompany.id,
      skipped: true,
      skippedReason: "Skipping custom platform company",
    });
    expect(registry.scrape).not.toHaveBeenCalled();
    expect(repository.createScrapingLog).not.toHaveBeenCalled();
  });

  it("passes new supported platforms through to the registry", async () => {
    const serviceNowCompany = {
      ...company,
      id: 5,
      name: "ServiceNow",
      careersUrl: "https://careers.servicenow.com/jobs",
      platform: "servicenow",
    } as Company;
    const repository = createRepositoryMock({
      activeCompanies: [serviceNowCompany],
    });
    const registry = createRegistryMock({
      outcome: "success",
      jobs: [
        {
          externalId: "servicenow-1",
          title: "Software Engineer",
          url: "https://careers.servicenow.com/jobs/1/software-engineer/",
        },
      ],
      totalListings: 1,
      openExternalIds: ["servicenow-1"],
      listingCompleteness: "complete",
    });

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    const result = await orchestrator.scrapeCompany(serviceNowCompany.id, {
      sessionId: "session-servicenow",
      triggerSource: "manual",
    });

    expect(result.outcome).not.toBe("error");
    expect(registry.scrape).toHaveBeenCalledWith(
      serviceNowCompany.careersUrl,
      "servicenow",
      expect.objectContaining({
        boardToken: undefined,
        existingExternalIds: expect.any(Set),
        filters: expect.objectContaining({
          city: undefined,
          country: undefined,
          titleKeywords: undefined,
        }),
      })
    );
  });

  it("skips uber archiving when missing open jobs exceed conservative threshold", async () => {
    const existingJobs: ExistingJob[] = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      externalId: `uber-${index + 1}`,
      title: `Role ${index + 1}`,
      url: `https://jobs.example.com/${index + 1}`,
      location: null,
      status: "new",
      description: "Existing description",
    }));
    const openExternalIds = existingJobs.slice(0, 90).map((job) => job.externalId as string);
    const repository = createRepositoryMock({
      activeCompanies: [uberCompany],
      existingJobs,
      insertedJobIds: [],
    });
    const registry = createRegistryMock({
      outcome: "success",
      jobs: [],
      totalListings: openExternalIds.length,
      openExternalIds,
      listingCompleteness: "complete",
    });

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    await orchestrator.scrapeCompany(uberCompany.id, {
      sessionId: "session-uber-guard",
      triggerSource: "manual",
    });

    expect(repository.persistScrapeResult).toHaveBeenCalledWith(
      expect.objectContaining({ archiveMissing: false })
    );
  });

  it("archives uber jobs when missing open jobs stay below conservative threshold", async () => {
    const existingJobs: ExistingJob[] = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      externalId: `uber-${index + 1}`,
      title: `Role ${index + 1}`,
      url: `https://jobs.example.com/${index + 1}`,
      location: null,
      status: "new",
      description: "Existing description",
    }));
    const openExternalIds = existingJobs.slice(0, 96).map((job) => job.externalId as string);
    const repository = createRepositoryMock({
      activeCompanies: [uberCompany],
      existingJobs,
      insertedJobIds: [],
    });
    const registry = createRegistryMock({
      outcome: "success",
      jobs: [],
      totalListings: openExternalIds.length,
      openExternalIds,
      listingCompleteness: "complete",
    });

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    await orchestrator.scrapeCompany(uberCompany.id, {
      sessionId: "session-uber-archive",
      triggerSource: "manual",
    });

    expect(repository.persistScrapeResult).toHaveBeenCalledWith(
      expect.objectContaining({ archiveMissing: true })
    );
  });

  it("marks standalone partial sessions as partial", async () => {
    const repository = createRepositoryMock();
    const registry = createRegistryMock({
      outcome: "partial",
      jobs: [],
      totalListings: 0,
      openExternalIds: [],
      listingCompleteness: "partial",
    });

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    await orchestrator.scrapeCompany(company.id);

    expect(repository.completeSession).toHaveBeenCalledWith(expect.any(String), "partial");
  });

  it("marks fully successful batch sessions as completed", async () => {
    const repository = createRepositoryMock();
    const registry = createRegistryMock({
      outcome: "success",
      jobs: [],
      totalListings: 0,
      openExternalIds: [],
      listingCompleteness: "complete",
    });

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    const result = await orchestrator.scrapeCompanies([company.id], "manual");

    expect(repository.completeSession).toHaveBeenCalledWith(result.sessionId, "completed");
  });

  it("marks fully failed batch sessions as failed", async () => {
    const repository = createRepositoryMock();
    const registry = createRegistryMock({
      outcome: "error",
      jobs: [],
      listingCompleteness: "unknown",
      error: {
        code: "network_error",
        message: "Network failure",
        retryable: true,
      },
    });

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    const result = await orchestrator.scrapeCompanies([company.id], "manual");

    expect(repository.completeSession).toHaveBeenCalledWith(result.sessionId, "failed");
  });

  it("marks mixed success and error batch sessions as partial", async () => {
    const repository = createRepositoryMock({
      activeCompanies: [company, companyTwo],
    });
    const registry = createRegistryMock(
      vi
        .fn()
        .mockResolvedValueOnce({
          outcome: "success",
          jobs: [],
          totalListings: 0,
          openExternalIds: [],
          listingCompleteness: "complete",
        } satisfies ScraperResult)
        .mockResolvedValueOnce({
          outcome: "error",
          jobs: [],
          listingCompleteness: "unknown",
          error: {
            code: "network_error",
            message: "Network failure",
            retryable: true,
          },
        } satisfies ScraperResult)
    );

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    const result = await orchestrator.scrapeAllCompanies("manual");

    expect(result.summary.failedCompanies).toBe(1);
    expect(repository.completeSession).toHaveBeenCalledWith(result.sessionId, "partial");
  });

  it("respects configured max parallel scrapes for batch runs", async () => {
    const activeCompanies = createActiveCompanies(6);
    const repository = createRepositoryMock({
      activeCompanies,
      insertedJobIds: [],
      settingValues: {
        scraper_max_parallel_scrapes: "2",
      },
    });

    let inFlight = 0;
    let maxInFlight = 0;

    const registry = createRegistryMock(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      return {
        outcome: "success",
        jobs: [],
        totalListings: 0,
        openExternalIds: [],
        listingCompleteness: "complete",
      };
    });

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    const result = await orchestrator.scrapeAllCompanies("manual");

    expect(result.summary.totalCompanies).toBe(6);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("falls back to default parallel scrapes when setting is invalid", async () => {
    const activeCompanies = createActiveCompanies(8);
    const repository = createRepositoryMock({
      activeCompanies,
      insertedJobIds: [],
      settingValues: {
        scraper_max_parallel_scrapes: "100",
      },
    });

    let inFlight = 0;
    let maxInFlight = 0;

    const registry = createRegistryMock(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      return {
        outcome: "success",
        jobs: [],
        totalListings: 0,
        openExternalIds: [],
        listingCompleteness: "complete",
      };
    });

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    const result = await orchestrator.scrapeAllCompanies("manual");

    expect(result.summary.totalCompanies).toBe(8);
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("runs api tier before browser and serial tiers", async () => {
    const activeCompanies: Company[] = [
      {
        ...company,
        id: 1,
        name: "ApiOne",
        platform: "greenhouse",
        careersUrl: "https://boards.greenhouse.io/acme",
      },
      {
        ...company,
        id: 2,
        name: "ApiTwo",
        platform: "lever",
        careersUrl: "https://jobs.lever.co/globex",
      },
      {
        ...company,
        id: 3,
        name: "Browser",
        platform: "atlassian",
        careersUrl: "https://www.atlassian.com/company/careers",
      },
      {
        ...company,
        id: 4,
        name: "Serial",
        platform: "workday",
        careersUrl: "https://acme.wd1.myworkdayjobs.com/en-US/careers",
      },
    ];
    const repository = createRepositoryMock({
      activeCompanies,
      insertedJobIds: [],
      settingValues: {
        scraper_max_parallel_scrapes: "3",
      },
    });

    const starts: Record<string, number[]> = {};
    const ends: Record<string, number[]> = {};

    const recordTime = (bucket: Record<string, number[]>, key: string) => {
      if (!bucket[key]) {
        bucket[key] = [];
      }
      bucket[key].push(Date.now());
    };

    const registry = createRegistryMock(
      async (_url, platform) => {
        const key = platform ?? "unknown";
        recordTime(starts, key);
        const delay = platform === "greenhouse" || platform === "lever" ? 20 : 5;
        await new Promise((resolve) => setTimeout(resolve, delay));
        recordTime(ends, key);
        return {
          outcome: "success",
          jobs: [],
          totalListings: 0,
          openExternalIds: [],
          listingCompleteness: "complete",
        };
      },
      {
        scrapersByPlatform: {
          greenhouse: { requiresBrowser: false },
          lever: { requiresBrowser: false },
          atlassian: { requiresBrowser: true },
          workday: { requiresBrowser: true },
        },
      }
    );

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    await orchestrator.scrapeAllCompanies("manual");

    const apiEnd = Math.max(
      Math.max(...(ends.greenhouse ?? [0])),
      Math.max(...(ends.lever ?? [0]))
    );
    const browserStart = Math.min(...(starts.atlassian ?? [Number.POSITIVE_INFINITY]));
    const browserEnd = Math.max(...(ends.atlassian ?? [0]));
    const serialStart = Math.min(...(starts.workday ?? [Number.POSITIVE_INFINITY]));

    expect(browserStart).toBeGreaterThanOrEqual(apiEnd);
    expect(serialStart).toBeGreaterThanOrEqual(browserEnd);
  });

  it("runs workday and eightfold serially regardless of max parallel", async () => {
    const activeCompanies: Company[] = [
      {
        ...company,
        id: 1,
        name: "WorkdayCo",
        platform: "workday",
        careersUrl: "https://acme.wd1.myworkdayjobs.com/en-US/careers",
      },
      {
        ...company,
        id: 2,
        name: "EightfoldCo",
        platform: "eightfold",
        careersUrl: "https://jobs.eightfold.ai/careers",
      },
    ];
    const repository = createRepositoryMock({
      activeCompanies,
      insertedJobIds: [],
      settingValues: {
        scraper_max_parallel_scrapes: "4",
      },
    });

    let serialInFlight = 0;
    let maxSerialInFlight = 0;

    const registry = createRegistryMock(
      async (_url, platform) => {
        if (platform === "workday" || platform === "eightfold") {
          serialInFlight += 1;
          maxSerialInFlight = Math.max(maxSerialInFlight, serialInFlight);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (platform === "workday" || platform === "eightfold") {
          serialInFlight -= 1;
        }
        return {
          outcome: "success",
          jobs: [],
          totalListings: 0,
          openExternalIds: [],
          listingCompleteness: "complete",
        };
      },
      {
        scrapersByPlatform: {
          workday: { requiresBrowser: true },
          eightfold: { requiresBrowser: true },
        },
      }
    );

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    await orchestrator.scrapeAllCompanies("manual");

    expect(maxSerialInFlight).toBeLessThanOrEqual(1);
  });

  it("classifies missing platforms by URL and queues unknowns last", async () => {
    const detectedUrl = "https://boards.greenhouse.io/acme";
    const apiUrl = "https://jobs.lever.co/globex";
    const unknownUrl = "https://careers.example.com";

    const activeCompanies: Company[] = [
      {
        ...company,
        id: 1,
        name: "Detected",
        platform: null,
        careersUrl: detectedUrl,
      },
      {
        ...company,
        id: 2,
        name: "Lever",
        platform: "lever",
        careersUrl: apiUrl,
      },
      {
        ...company,
        id: 3,
        name: "Unknown",
        platform: null,
        careersUrl: unknownUrl,
      },
    ];
    const repository = createRepositoryMock({
      activeCompanies,
      insertedJobIds: [],
      settingValues: {
        scraper_max_parallel_scrapes: "2",
      },
    });

    const starts: Record<string, number> = {};
    const ends: Record<string, number> = {};

    const registry = createRegistryMock(
      async (url) => {
        starts[url] = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 15));
        ends[url] = Date.now();
        return {
          outcome: "success",
          jobs: [],
          totalListings: 0,
          openExternalIds: [],
          listingCompleteness: "complete",
        };
      },
      {
        scrapersByPlatform: {
          greenhouse: { requiresBrowser: false },
          lever: { requiresBrowser: false },
        },
      }
    );

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    await orchestrator.scrapeAllCompanies("manual");

    const maxApiEnd = Math.max(ends[detectedUrl], ends[apiUrl]);

    expect(starts[detectedUrl]).toBeLessThanOrEqual(ends[apiUrl]);
    expect(starts[unknownUrl]).toBeGreaterThanOrEqual(maxApiEnd);
  });

  it("does not trigger auto-match when inserted jobs have no descriptions", async () => {
    matcherMocks.getMatcherConfig.mockResolvedValue({ autoMatchAfterScrape: true });
    const repository = createRepositoryMock({
      insertedJobIds: [101, 102],
      matchableJobIds: [],
    });
    const registry = createRegistryMock({
      outcome: "success",
      jobs: [
        {
          externalId: "greenhouse-acme-1",
          title: "Software Engineer",
          url: "https://jobs.example.com/1",
          description: "",
        },
      ],
      totalListings: 1,
      openExternalIds: ["greenhouse-acme-1"],
      listingCompleteness: "complete",
    });

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    await orchestrator.scrapeCompany(company.id, {
      sessionId: "session-1",
      triggerSource: "manual",
    });

    expect(repository.persistScrapeResult).toHaveBeenCalledWith(
      expect.objectContaining({ enableMatching: true })
    );
    expect(outboxMocks.dispatchPendingScrapeMatches).not.toHaveBeenCalled();
  });

  it("only auto-matches inserted jobs that have descriptions", async () => {
    matcherMocks.getMatcherConfig.mockResolvedValue({ autoMatchAfterScrape: true });
    const repository = createRepositoryMock({
      insertedJobIds: [101, 102, 103],
      matchableJobIds: [102, 103],
    });
    const registry = createRegistryMock({
      outcome: "success",
      jobs: [
        {
          externalId: "greenhouse-acme-1",
          title: "Software Engineer",
          url: "https://jobs.example.com/1",
          description: "Role details",
        },
      ],
      totalListings: 1,
      openExternalIds: ["greenhouse-acme-1"],
      listingCompleteness: "complete",
    });

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    await orchestrator.scrapeCompany(company.id, {
      sessionId: "session-1",
      triggerSource: "manual",
    });

    expect(repository.persistScrapeResult).toHaveBeenCalledWith(
      expect.objectContaining({ enableMatching: true })
    );

    expect(outboxMocks.dispatchPendingScrapeMatches).toHaveBeenCalledOnce();
  });

  it("heals duplicate jobs when existing description is empty", async () => {
    const existingJobs: ExistingJob[] = [
      {
        id: 41,
        externalId: "greenhouse-acme-1",
        title: "Software Engineer",
        url: "https://jobs.example.com/1",
        location: null,
        status: "new",
        description: null,
      },
    ];
    const repository = createRepositoryMock({
      existingJobs,
      insertedJobIds: [],
      updatedExistingJobsCount: 1,
    });
    const registry = createRegistryMock({
      outcome: "success",
      jobs: [
        {
          externalId: "greenhouse-acme-1",
          title: "Software Engineer",
          url: "https://jobs.example.com/1",
          description: "Updated role details",
          descriptionFormat: "plain",
        },
      ],
      totalListings: 1,
      openExternalIds: ["greenhouse-acme-1"],
      listingCompleteness: "complete",
    });

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    await orchestrator.scrapeCompany(company.id, {
      sessionId: "session-heal-duplicate",
      triggerSource: "manual",
    });

    expect(registry.scrape).toHaveBeenCalledWith(
      company.careersUrl,
      company.platform,
      expect.objectContaining({
        existingExternalIds: new Set<string>(),
      })
    );

    expect(repository.persistScrapeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        existingJobUpdates: expect.arrayContaining([
          expect.objectContaining({
            existingJobId: 41,
            job: expect.objectContaining({
              description: "Updated role details",
            }),
          }),
        ]),
      })
    );
  });

  it("does not heal duplicates matched by title similarity only", async () => {
    const existingJobs: ExistingJob[] = [
      {
        id: 52,
        externalId: "greenhouse-acme-existing",
        title: "Software Engineer",
        url: "https://jobs.example.com/existing",
        location: null,
        status: "new",
        description: "Existing description",
      },
    ];
    const repository = createRepositoryMock({
      existingJobs,
      insertedJobIds: [],
      updatedExistingJobsCount: 0,
    });
    const registry = createRegistryMock({
      outcome: "success",
      jobs: [
        {
          externalId: "greenhouse-acme-new",
          title: "Software Engineer",
          url: "https://jobs.example.com/new",
          description: "New role details",
          descriptionFormat: "plain",
        },
      ],
      totalListings: 1,
      openExternalIds: ["greenhouse-acme-new"],
      listingCompleteness: "complete",
    });

    const orchestrator = new ScrapeOrchestrator(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} }
    );

    await orchestrator.scrapeCompany(company.id, {
      sessionId: "session-no-heal-similarity",
      triggerSource: "manual",
    });

    expect(repository.persistScrapeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        existingJobUpdates: [],
      })
    );
  });
});
