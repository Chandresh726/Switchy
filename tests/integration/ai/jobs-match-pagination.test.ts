import type { NextRequest } from "next/server";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildJobFingerprintFromRecord } from "@/lib/ai/artifacts/fingerprints";
import { companies, jobs, matchResults } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-jobs-match-pagination-");

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/ai/matcher/presentation");
  vi.resetModules();
});

describe("score-aware jobs pagination", () => {
  it("keeps prior-profile scores eligible for dashboard top matches", async () => {
    const { database } = harness.createDatabase();
    const context = {
      candidateFingerprint: "b".repeat(64),
      scoringPolicyVersion: "policy-current",
    };
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/matcher/presentation", () => ({
      getCurrentMatchContext: vi.fn().mockResolvedValue(context),
      getMatchPresentations: vi.fn().mockImplementation(async (
        jobRows: Array<{ id: number }>
      ) => new Map(jobRows.map((job) => [job.id, {
        matchScore: 93,
        matchReasons: [],
        matchedSkills: [],
        matchResultId: "prior-profile-result",
        matchBreakdown: null,
        matchStale: true,
        matchLegacy: false,
        matchSummary: "Strong fit based on the previous profile.",
        matchReasoning: [],
        scoringPolicyVersion: "policy-prior",
      }]))),
    }));
    const { GET } = await import("@/app/api/jobs/route");
    const company = database.insert(companies).values({
      name: "Prior profile pagination fixture",
      careersUrl: "https://example.com/prior-profile-careers",
    }).returning().get();
    const job = database.insert(jobs).values({
      companyId: company.id,
      title: "Prior profile top match",
      description: "A strong historical match",
      url: "https://example.com/jobs/prior-profile-top",
    }).returning().get();
    database.insert(matchResults).values({
      id: "prior-profile-result",
      jobId: job.id,
      candidateFingerprint: "a".repeat(64),
      jobFingerprint: "c".repeat(64),
      scoringPolicyVersion: "policy-prior",
      score: 93,
      breakdownJson: "{}",
      evidenceJson: JSON.stringify({
        summary: "Strong fit based on the previous profile.",
        reasoning: [],
        matchedSkills: [],
      }),
      confidence: 0,
      source: "deterministic",
    }).run();

    const response = await GET(new Request(
      "http://localhost/api/jobs?matchBands=high,good&sortBy=matchScore&sortOrder=desc&limit=5"
    ) as NextRequest);

    expect(await response.json()).toMatchObject({
      jobs: [{
        id: job.id,
        matchScore: 93,
        matchStale: true,
      }],
      totalCount: 1,
      hasMore: false,
    });
  });

  it("sorts and filters current-candidate results before pagination", async () => {
    const { database } = harness.createDatabase();
    const context = {
      candidateFingerprint: "a".repeat(64),
      scoringPolicyVersion: "policy-current",
    };
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/matcher/presentation", () => ({
      getCurrentMatchContext: vi.fn().mockResolvedValue(context),
      getMatchPresentations: vi.fn().mockImplementation(async (
        jobRows: Array<{ id: number; matchScore: number | null }>
      ) => new Map(jobRows.map((job) => [job.id, {
        matchScore: job.id === 1 ? 80 : job.id === 2 ? 97 : job.id === 5 ? 99 : job.matchScore,
        matchReasons: [],
        matchedSkills: [],
        matchResultId: job.id === 1
          ? "fresh-result"
          : job.id === 2
            ? "changed-job-result"
            : job.id === 5
              ? "insufficient-result"
              : null,
        matchBreakdown: null,
        matchStale: false,
        matchLegacy: job.matchScore !== null,
        scoringPolicyVersion: context.scoringPolicyVersion,
      }]))),
    }));
    const { GET } = await import("@/app/api/jobs/route");

    const company = database.insert(companies).values({
      name: "Pagination fixture",
      careersUrl: "https://example.com/careers",
    }).returning().get();
    const jobValues = [
      {
        id: 1,
        companyId: company.id,
        title: "Fresh match",
        description: "Current content",
        url: "https://example.com/jobs/fresh",
      },
      {
        id: 2,
        companyId: company.id,
        title: "Stale high score",
        description: "Changed content",
        url: "https://example.com/jobs/stale",
      },
      {
        id: 3,
        companyId: company.id,
        title: "Unmatched",
        description: "No result",
        url: "https://example.com/jobs/unmatched",
      },
      {
        id: 4,
        companyId: company.id,
        title: "Legacy match",
        description: "Matched by the previous engine",
        url: "https://example.com/jobs/legacy",
        matchScore: 91,
      },
      {
        id: 5,
        companyId: company.id,
        title: "High numeric but insufficient evidence",
        description: "Sparse evidence",
        url: "https://example.com/jobs/insufficient",
      },
    ].map((job) => ({
      ...job,
      aiFingerprint: buildJobFingerprintFromRecord({
        ...job,
        location: null,
        locationType: null,
        seniorityLevel: null,
        department: null,
        employmentType: null,
        salary: null,
      }),
    }));
    database.insert(jobs).values(jobValues).run();
    database.insert(matchResults).values([
      {
        id: "fresh-result",
        jobId: 1,
        candidateFingerprint: context.candidateFingerprint,
        jobFingerprint: jobValues[0].aiFingerprint,
        scoringPolicyVersion: context.scoringPolicyVersion,
        score: 80,
        breakdownJson: "{}",
        evidenceJson: JSON.stringify({ summary: "Good fit", reasoning: [], matchedSkills: [] }),
        confidence: 0.8,
        source: "deterministic",
      },
      {
        id: "insufficient-result",
        jobId: 5,
        candidateFingerprint: context.candidateFingerprint,
        jobFingerprint: jobValues[4].aiFingerprint,
        scoringPolicyVersion: context.scoringPolicyVersion,
        score: 99,
        breakdownJson: "{}",
        evidenceJson: JSON.stringify({ summary: "Strong numeric fit", reasoning: [], matchedSkills: [] }),
        confidence: 0.2,
        source: "deterministic",
      },
      {
        id: "stale-result",
        jobId: 2,
        candidateFingerprint: context.candidateFingerprint,
        jobFingerprint: "b".repeat(64),
        scoringPolicyVersion: context.scoringPolicyVersion,
        score: 97,
        breakdownJson: "{}",
        evidenceJson: "{}",
        confidence: 0.9,
        source: "deterministic",
      },
    ]).run();

    const firstPage = await GET(new Request(
      "http://localhost/api/jobs?sortBy=matchScore&sortOrder=desc&limit=1"
    ) as NextRequest);
    expect(await firstPage.json()).toMatchObject({
      jobs: [{ id: 5, title: "High numeric but insufficient evidence", matchScore: 99 }],
      totalCount: 5,
      hasMore: true,
    });

    const filtered = await GET(new Request(
      "http://localhost/api/jobs?minScore=75&sortBy=matchScore&limit=10"
    ) as NextRequest);
    expect(await filtered.json()).toMatchObject({
      jobs: [
        { id: 5, matchScore: 99 },
        { id: 2, matchScore: 97 },
        { id: 4, matchScore: 91 },
        { id: 1, matchScore: 80 },
      ],
      totalCount: 4,
      hasMore: false,
    });

    const promoted = await GET(new Request(
      "http://localhost/api/jobs?matchBands=high,good&sortBy=matchScore&limit=10"
    ) as NextRequest);
    expect(await promoted.json()).toMatchObject({
      jobs: [
        { id: 5, matchScore: 99 },
        { id: 2, matchScore: 97 },
        { id: 4, matchScore: 91 },
        { id: 1, matchScore: 80 },
      ],
      totalCount: 4,
      hasMore: false,
    });

    const highOnly = await GET(new Request(
      "http://localhost/api/jobs?matchBands=high&sortBy=matchScore&limit=10"
    ) as NextRequest);
    expect(await highOnly.json()).toMatchObject({
      jobs: [
        { id: 5, matchScore: 99 },
        { id: 2, matchScore: 97 },
        { id: 4, matchScore: 91 },
      ],
      totalCount: 3,
    });

    const goodOnly = await GET(new Request(
      "http://localhost/api/jobs?matchBands=good&sortBy=matchScore&limit=10"
    ) as NextRequest);
    expect(await goodOnly.json()).toMatchObject({
      jobs: [{ id: 1, matchScore: 80 }],
      totalCount: 1,
    });
  });

  it("sorts and filters legacy scores when current match context is unavailable", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/matcher/presentation", () => ({
      getCurrentMatchContext: vi.fn().mockResolvedValue(null),
      getMatchPresentations: vi.fn().mockImplementation(async (
        jobRows: Array<{ id: number; matchScore: number | null }>
      ) => new Map(jobRows.map((job) => [job.id, {
        matchScore: job.matchScore,
        matchReasons: [],
        matchedSkills: [],
        matchResultId: null,
        matchBreakdown: null,
        matchStale: false,
        matchLegacy: job.matchScore !== null,
        scoringPolicyVersion: job.matchScore !== null ? "legacy" : null,
      }]))),
    }));
    const { GET } = await import("@/app/api/jobs/route");
    const company = database.insert(companies).values({
      name: "Legacy-only pagination fixture",
      careersUrl: "https://example.com/legacy-only-careers",
    }).returning().get();
    database.insert(jobs).values([
      {
        companyId: company.id,
        title: "Legacy good match",
        url: "https://example.com/jobs/legacy-good",
        matchScore: 84,
      },
      {
        companyId: company.id,
        title: "Legacy high match",
        url: "https://example.com/jobs/legacy-high",
        matchScore: 90,
      },
      {
        companyId: company.id,
        title: "No score",
        url: "https://example.com/jobs/no-score",
      },
    ]).run();

    const response = await GET(new Request(
      "http://localhost/api/jobs?minScore=75&sortBy=matchScore&limit=10"
    ) as NextRequest);
    expect(await response.json()).toMatchObject({
      jobs: [
        { title: "Legacy high match", matchScore: 90, matchLegacy: true },
        { title: "Legacy good match", matchScore: 84, matchLegacy: true },
      ],
      totalCount: 2,
      hasMore: false,
    });

    const high = await GET(new Request(
      "http://localhost/api/jobs?matchBands=high&sortBy=matchScore&limit=10"
    ) as NextRequest);
    expect(await high.json()).toMatchObject({
      jobs: [{ title: "Legacy high match", matchScore: 90 }],
      totalCount: 1,
    });

    const good = await GET(new Request(
      "http://localhost/api/jobs?matchBands=good&sortBy=matchScore&limit=10"
    ) as NextRequest);
    expect(await good.json()).toMatchObject({
      jobs: [{ title: "Legacy good match", matchScore: 84 }],
      totalCount: 1,
    });
  });
});
