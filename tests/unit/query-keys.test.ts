import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { cacheOwnership, canonicalQueryParams, queryKeys } from "@/lib/query-keys";
import { historyPollingInterval } from "@/lib/hooks/history-polling";

function invalidatedKeys(spy: { mock: { calls: unknown[][] } }): Array<QueryKey | undefined> {
  return spy.mock.calls.map((call) => {
    const filters = call[0] as { queryKey?: QueryKey } | undefined;
    return filters?.queryKey;
  });
}

describe("query key registry", () => {
  it("canonicalizes equivalent parameter objects and unordered filters", () => {
    const first = queryKeys.jobs.list({
      matchBands: ["high", "good"],
      search: undefined,
      offset: 0,
    });
    const second = queryKeys.jobs.list({
      offset: 0,
      matchBands: ["good", "high"],
    });

    expect(first).toEqual(second);
    expect(canonicalQueryParams({ values: [3, 1, 2], omitted: undefined })).toEqual({
      values: [1, 2, 3],
    });
  });

  it("keeps distinct filters and pagination in distinct keys", () => {
    expect(queryKeys.jobs.list({ status: "new", offset: 0 })).not.toEqual(
      queryKeys.jobs.list({ status: "applied", offset: 0 })
    );
    expect(queryKeys.people.list({ limit: 25, offset: 0 })).not.toEqual(
      queryKeys.people.list({ limit: 25, offset: 25 })
    );
    expect(queryKeys.resumeHistory.list({ limit: 20, offset: 0 })).not.toEqual(
      queryKeys.resumeHistory.list({ limit: 20, offset: 20 })
    );
    expect(queryKeys.resumeHistory.detail("resume:1")).not.toEqual(
      queryKeys.resumeHistory.detail("run:resume-run-1")
    );
  });

  it("does not throw while constructing keys for invalid external filter values", () => {
    expect(() => queryKeys.jobs.list({ companyIds: [Number.NaN] })).not.toThrow();
    expect(queryKeys.jobs.list({ companyIds: [Number.NaN] })).toEqual([
      "jobs",
      "list",
      { invalid: { companyIds: [Number.NaN] } },
    ]);
  });
});

describe("history polling ownership", () => {
  it("polls only while at least one session is nonterminal", () => {
    expect(historyPollingInterval([{ status: "completed" }, { status: "failed" }])).toBe(false);
    expect(historyPollingInterval([{ status: "completed" }, { status: "queued" }])).toBe(1_000);
    expect(historyPollingInterval([{ status: "in_progress" }])).toBe(1_000);
  });
});

describe("cache ownership", () => {
  it("invalidates only job-owned families for a status mutation", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();

    await cacheOwnership.jobMutation(client, { jobId: 42, companyId: 7 });

    expect(invalidatedKeys(invalidate)).toEqual([
      queryKeys.jobs.lists(),
      queryKeys.stats.all,
      queryKeys.jobs.detail(42),
      queryKeys.companies.overview(7),
    ]);
    expect(invalidatedKeys(invalidate)).not.toContainEqual(queryKeys.people.all);
  });

  it("invalidates company, profile-child, match, and maintenance owners", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();

    await cacheOwnership.companyMutation(client, {
      companyId: 7,
      affectsMappings: true,
      affectsJobRecords: true,
    });
    expect(invalidatedKeys(invalidate)).toEqual([
      queryKeys.companies.list(),
      queryKeys.jobs.all,
      queryKeys.stats.all,
      queryKeys.companies.overview(7),
      queryKeys.people.all,
      queryKeys.matchHistory.all,
      queryKeys.scrapeHistory.all,
      queryKeys.runtime.unmatchedJobs(),
      queryKeys.ai.history(),
      queryKeys.ai.usages(),
      queryKeys.ai.contents(),
    ]);

    invalidate.mockClear();
    await cacheOwnership.companyMutation(client, {
      companyId: 7,
      affectsScrapeHistory: true,
    });
    expect(invalidatedKeys(invalidate)).toEqual([
      queryKeys.companies.list(),
      queryKeys.jobs.all,
      queryKeys.stats.all,
      queryKeys.companies.overview(7),
      queryKeys.scrapeHistory.all,
    ]);

    invalidate.mockClear();
    const skillsKey = queryKeys.profile.skills(1);
    await cacheOwnership.profileMutation(client, skillsKey);
    expect(invalidatedKeys(invalidate)).toEqual([
      queryKeys.profile.detail(),
      skillsKey,
      queryKeys.jobs.all,
      queryKeys.stats.all,
      queryKeys.companies.overviews(),
      queryKeys.matchHistory.all,
      queryKeys.runtime.unmatchedJobs(),
    ]);

    invalidate.mockClear();
    await cacheOwnership.resumeMutation(client);
    expect(invalidatedKeys(invalidate)).toEqual([
      queryKeys.profile.detail(),
      queryKeys.resumeHistory.all,
      queryKeys.ai.usages(),
    ]);

    invalidate.mockClear();
    await cacheOwnership.matchCompletion(client);
    expect(invalidatedKeys(invalidate)).toEqual([
      queryKeys.jobs.all,
      queryKeys.stats.all,
      queryKeys.companies.overviews(),
      queryKeys.matchHistory.all,
      queryKeys.runtime.unmatchedJobs(),
      queryKeys.ai.usages(),
    ]);

    invalidate.mockClear();
    await cacheOwnership.clearJobs(client);
    expect(invalidatedKeys(invalidate)).toEqual([
      queryKeys.jobs.all,
      queryKeys.companies.overviews(),
      queryKeys.stats.all,
      queryKeys.runtime.unmatchedJobs(),
      queryKeys.matchHistory.all,
      queryKeys.scrapeHistory.all,
      queryKeys.ai.history(),
      queryKeys.ai.usages(),
      queryKeys.ai.contents(),
    ]);
  });

  it("keeps people, settings, provider, match-history, and AI ownership explicit", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();

    await cacheOwnership.peopleMutation(client);
    expect(invalidatedKeys(invalidate)).toEqual([
      queryKeys.people.all,
      queryKeys.companies.overviews(),
      queryKeys.stats.all,
    ]);

    invalidate.mockClear();
    await cacheOwnership.settingsMutation(client);
    expect(invalidatedKeys(invalidate)).toEqual([
      queryKeys.settings.all,
    ]);

    invalidate.mockClear();
    await cacheOwnership.schedulerSettingsMutation(client);
    expect(invalidatedKeys(invalidate)).toEqual([
      queryKeys.settings.all,
      queryKeys.runtime.scheduler(),
    ]);

    invalidate.mockClear();
    await cacheOwnership.providerMutation(client);
    expect(invalidatedKeys(invalidate)).toEqual([
      queryKeys.providers.all,
      queryKeys.settings.all,
    ]);

    invalidate.mockClear();
    await cacheOwnership.clearMatchHistory(client);
    expect(invalidatedKeys(invalidate)).toEqual([
      queryKeys.matchHistory.all,
      queryKeys.scrapeHistory.all,
      queryKeys.companies.overviews(),
      queryKeys.ai.usages(),
    ]);

    invalidate.mockClear();
    await cacheOwnership.updateMatchHistoryStatus(client);
    expect(invalidatedKeys(invalidate)).toEqual([
      queryKeys.jobs.all,
      queryKeys.stats.all,
      queryKeys.matchHistory.all,
      queryKeys.scrapeHistory.all,
      queryKeys.companies.overviews(),
      queryKeys.runtime.unmatchedJobs(),
      queryKeys.ai.usages(),
    ]);

    invalidate.mockClear();
    await cacheOwnership.clearScrapeHistory(client);
    expect(invalidatedKeys(invalidate)).toEqual([
      queryKeys.scrapeHistory.all,
      queryKeys.matchHistory.all,
      queryKeys.companies.overviews(),
      queryKeys.stats.all,
      queryKeys.ai.usages(),
    ]);

    invalidate.mockClear();
    await cacheOwnership.updateScrapeHistoryStatus(client);
    expect(invalidatedKeys(invalidate)).toEqual([
      queryKeys.jobs.all,
      queryKeys.scrapeHistory.all,
      queryKeys.matchHistory.all,
      queryKeys.companies.overviews(),
      queryKeys.stats.all,
    ]);

    invalidate.mockClear();
    await cacheOwnership.clearMatchData(client);
    expect(invalidatedKeys(invalidate)).toEqual([
      queryKeys.jobs.all,
      queryKeys.matchHistory.all,
      queryKeys.scrapeHistory.all,
      queryKeys.stats.all,
      queryKeys.companies.overviews(),
      queryKeys.runtime.unmatchedJobs(),
      queryKeys.ai.usages(),
    ]);

    invalidate.mockClear();
    await cacheOwnership.clearAIContent(client);
    expect(invalidatedKeys(invalidate)).toEqual([
      queryKeys.ai.history(),
      queryKeys.ai.contents(),
    ]);
  });
});
