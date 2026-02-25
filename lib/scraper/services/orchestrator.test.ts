import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Company } from "@/lib/db/schema";
import type { ExistingJob } from "@/lib/scraper/infrastructure/types";
import type { ScraperResult } from "@/lib/scraper/types";
import { TitleBasedDeduplicationService } from "@/lib/scraper/services/deduplication-service";
import { DefaultFilterService } from "@/lib/scraper/services/filter-service";
import { ScrapeOrchestrator } from "@/lib/scraper/services/orchestrator";

const matcherMocks = vi.hoisted(() => ({
  getMatcherConfig: vi.fn(),
  matchWithTracking: vi.fn(),
}));

vi.mock("@/lib/ai/matcher", () => ({
  getMatcherConfig: matcherMocks.getMatcherConfig,
  matchWithTracking: matcherMocks.matchWithTracking,
}));

const company: Company = {
  id: 1,
  name: "Acme",
  careersUrl: "https://jobs.example.com",
  logoUrl: null,
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

interface RepositoryMockOptions {
  activeCompanies?: Company[];
  insertedJobIds?: number[];
  matchableJobIds?: number[];
  existingJobs?: ExistingJob[];
  updatedExistingJobsCount?: number;
  settingValues?: Record<string, string | null | undefined>;
}

function createRepositoryMock(options: RepositoryMockOptions = {}) {
  const activeCompanies = options.activeCompanies ?? [company];
  const insertedJobIds = options.insertedJobIds ?? [101];
  const matchableJobIds = options.matchableJobIds ?? insertedJobIds;
  const existingJobs = options.existingJobs ?? [];
  const updatedExistingJobsCount = options.updatedExistingJobsCount ?? 0;
  const settingValues = options.settingValues ?? {};

  return {
    getCompany: vi.fn(async (id: number) => activeCompanies.find((item) => item.id === id) ?? null),
    getActiveCompanies: vi.fn(async () => activeCompanies),
    getExistingJobs: vi.fn(async () => existingJobs),
    getSetting: vi.fn(async (key: string) => settingValues[key] ?? null),
    reopenScraperArchivedJobs: vi.fn(async () => 0),
    archiveMissingJobs: vi.fn(async () => 0),
    insertJobs: vi.fn(async () => insertedJobIds),
    updateExistingJobsFromScrape: vi.fn(async () => updatedExistingJobsCount),
    getMatchableJobIds: vi.fn(async () => matchableJobIds),
    updateCompany: vi.fn(async () => undefined),
    createSession: vi.fn(async () => undefined),
    isSessionInProgress: vi.fn(async () => true),
    stopSession: vi.fn(async () => true),
    updateSessionProgress: vi.fn(async () => undefined),
    completeSession: vi.fn(async () => undefined),
    createScrapingLog: vi.fn(async () => 7),
    updateScrapingLog: vi.fn(async () => undefined),
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

function createRegistryMock(
  result:
    | ScraperResult
    | ((...args: unknown[]) => Promise<ScraperResult>)
) {
  const scrape = typeof result === "function"
    ? vi.fn(result)
    : vi.fn(async () => result);

  return {
    register: vi.fn(),
    getScraperForUrl: vi.fn(),
    getScraperByPlatform: vi.fn(),
    scrape,
    getSupportedPlatforms: vi.fn(() => ["greenhouse"]),
  };
}

describe("ScrapeOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matcherMocks.getMatcherConfig.mockResolvedValue({ autoMatchAfterScrape: false });
    matcherMocks.matchWithTracking.mockResolvedValue({
      total: 0,
      succeeded: 0,
      failed: 0,
    });
  });

  it("maps partial scraper results to failed FetchResult and partial log status", async () => {
    const repository = createRepositoryMock();
    const registry = createRegistryMock({
      success: true,
      outcome: "partial",
      jobs: [
        {
          externalId: "greenhouse-acme-1",
          title: "Software Engineer",
          url: "https://jobs.example.com/1",
        },
      ],
      openExternalIds: ["greenhouse-acme-1"],
      openExternalIdsComplete: false,
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
    expect(repository.createScrapingLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: "partial" })
    );
    expect(repository.archiveMissingJobs).not.toHaveBeenCalled();
  });

  it("treats partial company outcomes as batch failures", async () => {
    const repository = createRepositoryMock();
    const registry = createRegistryMock({
      success: true,
      outcome: "partial",
      jobs: [],
      openExternalIds: [],
      openExternalIdsComplete: false,
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

  it("skips uber archiving when missing open jobs exceed conservative threshold", async () => {
    const existingJobs: ExistingJob[] = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      externalId: `uber-${index + 1}`,
      title: `Role ${index + 1}`,
      url: `https://jobs.example.com/${index + 1}`,
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
      success: true,
      outcome: "success",
      jobs: [],
      openExternalIds,
      openExternalIdsComplete: true,
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

    expect(repository.archiveMissingJobs).not.toHaveBeenCalled();
  });

  it("archives uber jobs when missing open jobs stay below conservative threshold", async () => {
    const existingJobs: ExistingJob[] = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      externalId: `uber-${index + 1}`,
      title: `Role ${index + 1}`,
      url: `https://jobs.example.com/${index + 1}`,
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
      success: true,
      outcome: "success",
      jobs: [],
      openExternalIds,
      openExternalIdsComplete: true,
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

    expect(repository.archiveMissingJobs).toHaveBeenCalledTimes(1);
  });

  it("marks standalone partial sessions as partial", async () => {
    const repository = createRepositoryMock();
    const registry = createRegistryMock({
      success: true,
      outcome: "partial",
      jobs: [],
      openExternalIds: [],
      openExternalIdsComplete: false,
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
      success: true,
      outcome: "success",
      jobs: [],
      openExternalIds: [],
      openExternalIdsComplete: true,
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
      success: false,
      outcome: "error",
      jobs: [],
      error: "Network failure",
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
          success: true,
          outcome: "success",
          jobs: [],
          openExternalIds: [],
          openExternalIdsComplete: true,
        })
        .mockResolvedValueOnce({
          success: false,
          outcome: "error",
          jobs: [],
          error: "Network failure",
        })
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
        success: true,
        outcome: "success",
        jobs: [],
        openExternalIds: [],
        openExternalIdsComplete: true,
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
        success: true,
        outcome: "success",
        jobs: [],
        openExternalIds: [],
        openExternalIdsComplete: true,
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

  it("does not trigger auto-match when inserted jobs have no descriptions", async () => {
    matcherMocks.getMatcherConfig.mockResolvedValue({ autoMatchAfterScrape: true });
    const repository = createRepositoryMock({
      insertedJobIds: [101, 102],
      matchableJobIds: [],
    });
    const registry = createRegistryMock({
      success: true,
      outcome: "success",
      jobs: [
        {
          externalId: "greenhouse-acme-1",
          title: "Software Engineer",
          url: "https://jobs.example.com/1",
          description: "",
        },
      ],
      openExternalIds: ["greenhouse-acme-1"],
      openExternalIdsComplete: true,
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

    expect(repository.createScrapingLog).toHaveBeenCalledWith(
      expect.objectContaining({
        matcherStatus: null,
        matcherJobsTotal: null,
      })
    );
    expect(matcherMocks.matchWithTracking).not.toHaveBeenCalled();
  });

  it("only auto-matches inserted jobs that have descriptions", async () => {
    matcherMocks.getMatcherConfig.mockResolvedValue({ autoMatchAfterScrape: true });
    const repository = createRepositoryMock({
      insertedJobIds: [101, 102, 103],
      matchableJobIds: [102, 103],
    });
    const registry = createRegistryMock({
      success: true,
      outcome: "success",
      jobs: [
        {
          externalId: "greenhouse-acme-1",
          title: "Software Engineer",
          url: "https://jobs.example.com/1",
          description: "Role details",
        },
      ],
      openExternalIds: ["greenhouse-acme-1"],
      openExternalIdsComplete: true,
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

    expect(repository.createScrapingLog).toHaveBeenCalledWith(
      expect.objectContaining({
        matcherStatus: "pending",
        matcherJobsTotal: 2,
      })
    );

    await vi.waitFor(() => {
      expect(matcherMocks.matchWithTracking).toHaveBeenCalledWith(
        [102, 103],
        expect.objectContaining({
          triggerSource: "auto_match",
          companyId: company.id,
        })
      );
    });
  });

  it("heals duplicate jobs when existing description is empty", async () => {
    const existingJobs: ExistingJob[] = [
      {
        id: 41,
        externalId: "greenhouse-acme-1",
        title: "Software Engineer",
        url: "https://jobs.example.com/1",
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
      success: true,
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
      openExternalIds: ["greenhouse-acme-1"],
      openExternalIdsComplete: true,
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

    expect(repository.updateExistingJobsFromScrape).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          existingJobId: 41,
          job: expect.objectContaining({
            description: "Updated role details",
          }),
        }),
      ])
    );
    expect(repository.createScrapingLog).toHaveBeenCalledWith(
      expect.objectContaining({
        jobsUpdated: 1,
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
      success: true,
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
      openExternalIds: ["greenhouse-acme-new"],
      openExternalIdsComplete: true,
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

    expect(repository.updateExistingJobsFromScrape).toHaveBeenCalledWith([]);
    expect(repository.createScrapingLog).toHaveBeenCalledWith(
      expect.objectContaining({
        jobsUpdated: 0,
      })
    );
  });
});
