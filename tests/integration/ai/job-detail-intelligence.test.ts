import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MatchPresentation } from "@/lib/ai/matcher/presentation";
import { jobSchema, jobsResponseSchema } from "@/lib/api/contracts/jobs";
import { companies, jobAnalyses, jobs, matchResults } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-job-detail-intelligence-");

const EMPTY_PRESENTATION: MatchPresentation = {
  matchScore: null,
  matchReasons: [],
  matchedSkills: [],
  matchResultId: null,
  matchBreakdown: null,
  matchStale: false,
  matchLegacy: false,
  matchSummary: "",
  matchReasoning: [],
  matchRunId: null,
  matchPolicyVersion: null,
  scoringPolicyVersion: null,
};

function mockJobDependencies(
  database: ReturnType<typeof harness.createDatabase>["database"],
  presentation: MatchPresentation
) {
  vi.doMock("@/lib/db", () => ({ db: database }));
  vi.doMock("@/lib/ai/matcher/presentation", () => ({
    getCurrentMatchContext: vi.fn().mockResolvedValue(null),
    getMatchPresentations: vi.fn().mockImplementation(async (rows: Array<{ id: number }>) => (
      new Map(rows.map((row) => [row.id, presentation]))
    )),
  }));
}

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/ai/matcher/presentation");
  vi.resetModules();
});

describe("job detail intelligence", () => {
  it.each([
    { label: "current", stale: false },
    { label: "stale selected", stale: true },
  ])("returns stored analysis and match metadata for a $label match", async ({ stale }) => {
    const { database } = harness.createDatabase();
    const matchCreatedAt = new Date("2026-07-17T10:00:00.000Z");
    const analysisCreatedAt = new Date("2026-07-16T09:00:00.000Z");
    const company = database.insert(companies).values({
      name: "Analysis fixture",
      careersUrl: `https://example.com/analysis-${stale}`,
    }).returning().get();
    const job = database.insert(jobs).values({
      companyId: company.id,
      title: "Backend Engineer",
      description: "Build TypeScript services",
      url: `https://example.com/jobs/analysis-${stale}`,
    }).returning().get();
    database.insert(jobAnalyses).values({
      id: `analysis-${stale}`,
      jobFingerprint: "a".repeat(64),
      extractorVersion: "job-analysis-v1",
      evidenceJson: JSON.stringify({
        summary: "Backend role focused on reliable TypeScript services.",
        requirements: [{
          id: "requirement-1",
          type: "technology",
          text: "Strong TypeScript experience",
          importance: "critical",
          sourceEvidence: "Build TypeScript services",
        }],
      }),
      createdAt: analysisCreatedAt,
    }).run();
    database.insert(matchResults).values({
      id: `result-${stale}`,
      jobId: job.id,
      jobAnalysisId: `analysis-${stale}`,
      candidateFingerprint: "b".repeat(64),
      jobFingerprint: "a".repeat(64),
      scoringPolicyVersion: "scoring-v1",
      score: 86,
      breakdownJson: "{}",
      evidenceJson: "{}",
      confidence: 0,
      source: "deterministic",
      isStale: stale,
      createdAt: matchCreatedAt,
    }).run();
    mockJobDependencies(database, {
      ...EMPTY_PRESENTATION,
      matchScore: stale ? null : 86,
      matchResultId: `result-${stale}`,
      matchStale: stale,
    });
    const { GET } = await import("@/app/api/jobs/[id]/route");

    const response = await GET(
      new NextRequest(`http://localhost/api/jobs/${job.id}`),
      { params: Promise.resolve({ id: String(job.id) }) }
    );
    const payload = jobSchema.parse(await response.json());

    expect(payload.matchMetadata).toEqual({
      source: "deterministic",
      createdAt: matchCreatedAt.toISOString(),
    });
    expect(payload.jobAnalysis).toEqual({
      id: `analysis-${stale}`,
      extractorVersion: "job-analysis-v1",
      createdAt: analysisCreatedAt.toISOString(),
      summary: "Backend role focused on reliable TypeScript services.",
      requirements: [{
        id: "requirement-1",
        type: "technology",
        text: "Strong TypeScript experience",
        importance: "critical",
        sourceEvidence: "Build TypeScript services",
      }],
    });
  });

  it.each([
    { label: "unmatched", presentation: EMPTY_PRESENTATION },
    { label: "legacy", presentation: { ...EMPTY_PRESENTATION, matchScore: 75, matchLegacy: true } },
  ])("returns null intelligence for a $label job", async ({ label, presentation }) => {
    const { database } = harness.createDatabase();
    const company = database.insert(companies).values({
      name: `${label} fixture`,
      careersUrl: `https://example.com/${label}`,
    }).returning().get();
    const job = database.insert(jobs).values({
      companyId: company.id,
      title: `${label} job`,
      url: `https://example.com/jobs/${label}`,
      matchScore: label === "legacy" ? 75 : null,
    }).returning().get();
    mockJobDependencies(database, presentation);
    const { GET } = await import("@/app/api/jobs/[id]/route");

    const response = await GET(
      new NextRequest(`http://localhost/api/jobs/${job.id}`),
      { params: Promise.resolve({ id: String(job.id) }) }
    );
    const payload = jobSchema.parse(await response.json());

    expect(payload.matchMetadata).toBeNull();
    expect(payload.jobAnalysis).toBeNull();
  });

  it("returns match metadata and a null analysis when the selected result has no analysis reference", async () => {
    const { database } = harness.createDatabase();
    const matchCreatedAt = new Date("2026-07-17T10:00:00.000Z");
    const company = database.insert(companies).values({
      name: "No analysis fixture",
      careersUrl: "https://example.com/no-analysis",
    }).returning().get();
    const job = database.insert(jobs).values({
      companyId: company.id,
      title: "No analysis job",
      url: "https://example.com/jobs/no-analysis",
    }).returning().get();
    database.insert(matchResults).values({
      id: "result-without-analysis",
      jobId: job.id,
      candidateFingerprint: "c".repeat(64),
      jobFingerprint: "d".repeat(64),
      scoringPolicyVersion: "scoring-v1",
      score: 70,
      breakdownJson: "{}",
      evidenceJson: "{}",
      confidence: 0,
      source: "deterministic",
      createdAt: matchCreatedAt,
    }).run();
    mockJobDependencies(database, {
      ...EMPTY_PRESENTATION,
      matchScore: 70,
      matchResultId: "result-without-analysis",
    });
    const { GET } = await import("@/app/api/jobs/[id]/route");

    const response = await GET(
      new NextRequest(`http://localhost/api/jobs/${job.id}`),
      { params: Promise.resolve({ id: String(job.id) }) }
    );
    const payload = jobSchema.parse(await response.json());

    expect(payload.matchMetadata).toEqual({
      source: "deterministic",
      createdAt: matchCreatedAt.toISOString(),
    });
    expect(payload.jobAnalysis).toBeNull();
  });

  it.each([
    { label: "malformed JSON", evidenceJson: "{" },
    { label: "schema-invalid JSON", evidenceJson: JSON.stringify({ summary: 42, requirements: [] }) },
  ])("returns metadata and a null analysis for $label", async ({ label, evidenceJson }) => {
    const { database } = harness.createDatabase();
    const matchCreatedAt = new Date("2026-07-17T10:00:00.000Z");
    const company = database.insert(companies).values({
      name: `${label} fixture`,
      careersUrl: `https://example.com/${encodeURIComponent(label)}`,
    }).returning().get();
    const job = database.insert(jobs).values({
      companyId: company.id,
      title: `${label} job`,
      url: `https://example.com/jobs/${encodeURIComponent(label)}`,
    }).returning().get();
    const analysisId = `analysis-${label.replaceAll(" ", "-")}`;
    const resultId = `result-${label.replaceAll(" ", "-")}`;
    database.insert(jobAnalyses).values({
      id: analysisId,
      jobFingerprint: "e".repeat(64),
      extractorVersion: "job-analysis-v1",
      evidenceJson,
    }).run();
    database.insert(matchResults).values({
      id: resultId,
      jobId: job.id,
      jobAnalysisId: analysisId,
      candidateFingerprint: "f".repeat(64),
      jobFingerprint: "e".repeat(64),
      scoringPolicyVersion: "scoring-v1",
      score: 82,
      breakdownJson: "{}",
      evidenceJson: "{}",
      confidence: 0,
      source: "deterministic",
      createdAt: matchCreatedAt,
    }).run();
    mockJobDependencies(database, {
      ...EMPTY_PRESENTATION,
      matchScore: 82,
      matchResultId: resultId,
    });
    const { GET } = await import("@/app/api/jobs/[id]/route");

    const response = await GET(
      new NextRequest(`http://localhost/api/jobs/${job.id}`),
      { params: Promise.resolve({ id: String(job.id) }) }
    );
    const payload = jobSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.matchMetadata).toEqual({
      source: "deterministic",
      createdAt: matchCreatedAt.toISOString(),
    });
    expect(payload.jobAnalysis).toBeNull();
  });

  it("returns null intelligence for an unrecognized stored match source", async () => {
    const { database } = harness.createDatabase();
    const company = database.insert(companies).values({
      name: "Unknown source fixture",
      careersUrl: "https://example.com/unknown-source",
    }).returning().get();
    const job = database.insert(jobs).values({
      companyId: company.id,
      title: "Unknown source job",
      url: "https://example.com/jobs/unknown-source",
    }).returning().get();
    database.insert(matchResults).values({
      id: "result-unknown-source",
      jobId: job.id,
      candidateFingerprint: "1".repeat(64),
      jobFingerprint: "2".repeat(64),
      scoringPolicyVersion: "scoring-v1",
      score: 80,
      breakdownJson: "{}",
      evidenceJson: "{}",
      confidence: 0,
      source: "future-source",
    }).run();
    mockJobDependencies(database, {
      ...EMPTY_PRESENTATION,
      matchScore: 80,
      matchResultId: "result-unknown-source",
    });
    const { GET } = await import("@/app/api/jobs/[id]/route");

    const response = await GET(
      new NextRequest(`http://localhost/api/jobs/${job.id}`),
      { params: Promise.resolve({ id: String(job.id) }) }
    );
    const payload = jobSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.matchMetadata).toBeNull();
    expect(payload.jobAnalysis).toBeNull();
  });

  it("keeps stored analysis out of job list payloads", async () => {
    const { database } = harness.createDatabase();
    const company = database.insert(companies).values({
      name: "List fixture",
      careersUrl: "https://example.com/list-fixture",
    }).returning().get();
    database.insert(jobs).values({
      companyId: company.id,
      title: "List job",
      url: "https://example.com/jobs/list",
    }).run();
    mockJobDependencies(database, EMPTY_PRESENTATION);
    const { GET } = await import("@/app/api/jobs/route");

    const response = await GET(new NextRequest("http://localhost/api/jobs?sortBy=discoveredAt"));
    const payload = jobsResponseSchema.parse(await response.json());

    expect(payload.jobs[0]).not.toHaveProperty("matchMetadata");
    expect(payload.jobs[0]).not.toHaveProperty("jobAnalysis");
  });
});
