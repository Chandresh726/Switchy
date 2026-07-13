import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Company } from "@/lib/db/schema";
import type { ExistingJob } from "@/lib/scraper/infrastructure/types";
import type { Platform, ScrapeOptions, ScraperResult } from "@/lib/scraper/types";
import { TitleBasedDeduplicationService } from "@/lib/scraper/services/deduplication-service";
import { DefaultFilterService } from "@/lib/scraper/services/filter-service";
import { ScrapeCompanyPipeline } from "@/lib/scraper/application/scrape-company-pipeline";
import { StoredScrapeSettingsProvider } from "@/lib/scraper/settings/provider";

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
    createScrapingLog: vi.fn(async () => 7),
  };
}

function createRegistryMock(
  result:
    | ScraperResult
    | ((
        url: string,
        platform?: Platform | null,
        options?: ScrapeOptions
      ) => Promise<ScraperResult>)
) {
  const scrape = typeof result === "function"
    ? vi.fn(result)
    : vi.fn(async () => result);
  return {
    register: vi.fn(),
    getScraperForUrl: vi.fn(),
    getScraperByPlatform: vi.fn(),
    scrape,
    getSupportedPlatforms: vi.fn(() => []),
  };
}

describe("ScrapeCompanyPipeline", () => {
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

    const pipeline = new ScrapeCompanyPipeline(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} },
      new StoredScrapeSettingsProvider(repository)
    );

    const result = await pipeline.scrape(company.id, {
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

  it("passes the queue cancellation signal into the scraper registry", async () => {
    const repository = createRepositoryMock();
    const registry = createRegistryMock({
      outcome: "success",
      jobs: [],
      totalListings: 0,
      openExternalIds: [],
      listingCompleteness: "complete",
    });
    const pipeline = new ScrapeCompanyPipeline(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: false, defaultFilters: {} },
      new StoredScrapeSettingsProvider(repository)
    );
    const controller = new AbortController();

    await pipeline.scrape(company.id, {
      sessionId: "session-cancel",
      triggerSource: "manual",
      signal: controller.signal,
    });

    expect(registry.scrape).toHaveBeenCalledWith(
      company.careersUrl,
      company.platform,
      expect.objectContaining({ signal: controller.signal })
    );
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
    const pipeline = new ScrapeCompanyPipeline(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} },
      new StoredScrapeSettingsProvider(repository)
    );

    const result = await pipeline.scrape(company.id, {
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

    const pipeline = new ScrapeCompanyPipeline(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} },
      new StoredScrapeSettingsProvider(repository)
    );

    const result = await pipeline.scrape(customCompany.id, {
      sessionId: "session-custom",
      triggerSource: "manual",
    });

    expect(result).toMatchObject({
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

    const pipeline = new ScrapeCompanyPipeline(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} },
      new StoredScrapeSettingsProvider(repository)
    );

    const result = await pipeline.scrape(serviceNowCompany.id, {
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

    const pipeline = new ScrapeCompanyPipeline(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} },
      new StoredScrapeSettingsProvider(repository)
    );

    await pipeline.scrape(uberCompany.id, {
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

    const pipeline = new ScrapeCompanyPipeline(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} },
      new StoredScrapeSettingsProvider(repository)
    );

    await pipeline.scrape(uberCompany.id, {
      sessionId: "session-uber-archive",
      triggerSource: "manual",
    });

    expect(repository.persistScrapeResult).toHaveBeenCalledWith(
      expect.objectContaining({ archiveMissing: true })
    );
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

    const pipeline = new ScrapeCompanyPipeline(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} },
      new StoredScrapeSettingsProvider(repository)
    );

    await pipeline.scrape(company.id, {
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

    const pipeline = new ScrapeCompanyPipeline(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} },
      new StoredScrapeSettingsProvider(repository)
    );

    await pipeline.scrape(company.id, {
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

    const pipeline = new ScrapeCompanyPipeline(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} },
      new StoredScrapeSettingsProvider(repository)
    );

    await pipeline.scrape(company.id, {
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

    const pipeline = new ScrapeCompanyPipeline(
      repository,
      registry,
      new TitleBasedDeduplicationService(),
      new DefaultFilterService(),
      { autoMatchAfterScrape: true, defaultFilters: {} },
      new StoredScrapeSettingsProvider(repository)
    );

    await pipeline.scrape(company.id, {
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
