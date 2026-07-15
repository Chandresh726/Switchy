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
  it("sorts and filters with an exact current-result join before pagination", async () => {
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
        matchScore: job.id === 1 ? 80 : job.matchScore,
        matchReasons: [],
        matchedSkills: [],
        missingSkills: [],
        recommendations: [],
        matchResultId: job.id === 1 ? "fresh-result" : null,
        matchConfidence: job.id === 1 ? 0.8 : null,
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
        evidenceJson: "{}",
        confidence: 0.8,
        source: "deterministic",
      },
      {
        id: "stale-result",
        jobId: 2,
        candidateFingerprint: context.candidateFingerprint,
        jobFingerprint: "b".repeat(64),
        scoringPolicyVersion: context.scoringPolicyVersion,
        score: 99,
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
      jobs: [{ id: 4, title: "Legacy match", matchScore: 91 }],
      totalCount: 4,
      hasMore: true,
    });

    const filtered = await GET(new Request(
      "http://localhost/api/jobs?minScore=75&sortBy=matchScore&limit=10"
    ) as NextRequest);
    expect(await filtered.json()).toMatchObject({
      jobs: [
        { id: 4, matchScore: 91 },
        { id: 1, matchScore: 80 },
      ],
      totalCount: 2,
      hasMore: false,
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
        missingSkills: [],
        recommendations: [],
        matchResultId: null,
        matchConfidence: null,
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
        title: "Legacy high match",
        url: "https://example.com/jobs/legacy-high",
        matchScore: 84,
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
      jobs: [{ title: "Legacy high match", matchScore: 84, matchLegacy: true }],
      totalCount: 1,
      hasMore: false,
    });
  });
});
