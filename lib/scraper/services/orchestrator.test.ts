import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScraperResult } from "@/lib/scraper/types";
import { TitleBasedDeduplicationService } from "@/lib/scraper/services/deduplication-service";
import { DefaultFilterService } from "@/lib/scraper/services/filter-service";
import { ScrapeOrchestrator } from "@/lib/scraper/services/orchestrator";

vi.mock("@/lib/ai/matcher", () => ({
  getMatcherConfig: vi.fn(async () => ({ autoMatchAfterScrape: false })),
  matchWithTracking: vi.fn(async () => ({ total: 0, succeeded: 0, failed: 0 })),
}));

const company = {
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
} as const;

function createRepositoryMock() {
  return {
    getCompany: vi.fn(async () => company),
    getActiveCompanies: vi.fn(async () => [company]),
    getExistingJobs: vi.fn(async () => []),
    getSetting: vi.fn(async () => null),
    reopenScraperArchivedJobs: vi.fn(async () => 0),
    archiveMissingJobs: vi.fn(async () => 0),
    insertJobs: vi.fn(async () => [101]),
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

function createRegistryMock(result: ScraperResult) {
  return {
    register: vi.fn(),
    getScraperForUrl: vi.fn(),
    getScraperByPlatform: vi.fn(),
    scrape: vi.fn(async () => result),
    getSupportedPlatforms: vi.fn(() => ["greenhouse"]),
  };
}

describe("ScrapeOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(repository.completeSession).toHaveBeenCalledWith(result.sessionId, true);
  });
});
