import type { NextRequest } from "next/server";

import { afterEach, describe, expect, it, vi } from "vitest";

import { companies, jobs } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-company-overview-matches-");

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/ai/matcher/presentation");
  vi.resetModules();
});

describe("company overview match projections", () => {
  it("returns authoritative top matches beyond the newest 50 display jobs", async () => {
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
        matchSummary: "",
        matchBand: job.matchScore !== null && job.matchScore >= 85
          ? "high"
          : job.matchScore !== null && job.matchScore >= 70
            ? "good"
            : null,
        matchRoleFitScore: job.matchScore,
        matchEvidenceCoverage: null,
        matchExtractionConfidence: null,
        matchConstraints: [],
        matchRequirementAssessments: [],
        scoringPolicyVersion: job.matchScore === null ? null : "legacy",
      }]))),
    }));
    const { GET } = await import("@/app/api/companies/[id]/overview/route");
    const company = database.insert(companies).values({
      name: "Overview fixture",
      careersUrl: "https://example.com/careers",
    }).returning().get();
    const oldestTopMatch = database.insert(jobs).values({
      companyId: company.id,
      title: "Oldest top match",
      url: "https://example.com/jobs/top",
      matchScore: 96,
      discoveredAt: new Date("2020-01-01T00:00:00.000Z"),
    }).returning().get();
    database.insert(jobs).values(Array.from({ length: 54 }, (_, index) => ({
      companyId: company.id,
      title: `Newer role ${index}`,
      url: `https://example.com/jobs/newer-${index}`,
      matchScore: index === 0 ? 75 : null,
      discoveredAt: new Date(`2025-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`),
    }))).run();

    const response = await GET(
      new Request(`http://localhost/api/companies/${company.id}/overview`) as NextRequest,
      { params: Promise.resolve({ id: String(company.id) }) }
    );
    const body = await response.json();

    expect(body.jobs).toHaveLength(50);
    expect(body.jobs.map((job: { id: number }) => job.id)).not.toContain(oldestTopMatch.id);
    expect(body.topMatches[0]).toMatchObject({
      id: oldestTopMatch.id,
      title: "Oldest top match",
      matchScore: 96,
    });
    expect(body.stats.highMatchJobs).toBe(2);
  });
});
