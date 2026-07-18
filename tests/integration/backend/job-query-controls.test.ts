import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jobsResponseSchema } from "@/lib/api/contracts/jobs";
import { companies, jobs, matchResults } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-job-query-controls-");

const EMPTY_PRESENTATION = {
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
  context: { candidateFingerprint: string; scoringPolicyVersion: string } | null = null
) {
  vi.doMock("@/lib/db", () => ({ db: database }));
  vi.doMock("@/lib/ai/matcher/presentation", () => ({
    getCurrentMatchContext: vi.fn().mockResolvedValue(context),
    getMatchPresentations: vi.fn().mockImplementation(async (rows: Array<{ id: number; matchScore: number | null }>) => (
      new Map(rows.map((row) => [row.id, { ...EMPTY_PRESENTATION, matchScore: row.matchScore }]))
    )),
  }));
}

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/ai/matcher/presentation");
  vi.resetModules();
});

describe("job query date controls", () => {
  it("filters every stored activity timestamp and combines dates with status", async () => {
    const { database } = harness.createDatabase();
    mockJobDependencies(database);
    const company = database.insert(companies).values({
      name: "Date filters",
      careersUrl: "https://example.com/date-filters",
    }).returning().get();
    const old = new Date("2026-07-10T00:00:00.000Z");
    const recent = new Date("2026-07-16T00:00:00.000Z");
    database.insert(jobs).values([
      { companyId: company.id, title: "Discovered", url: "https://example.com/discovered", status: "new", discoveredAt: recent, updatedAt: old },
      { companyId: company.id, title: "Viewed", url: "https://example.com/viewed", status: "viewed", discoveredAt: old, updatedAt: recent, viewedAt: recent },
      { companyId: company.id, title: "Applied recent", url: "https://example.com/applied-recent", status: "applied", discoveredAt: old, updatedAt: old, viewedAt: old, appliedAt: recent },
      { companyId: company.id, title: "Applied old", url: "https://example.com/applied-old", status: "applied", discoveredAt: old, updatedAt: old, viewedAt: old, appliedAt: old },
    ]).run();
    const { GET } = await import("@/app/api/jobs/route");
    const cutoff = "2026-07-15T00:00:00.000Z";

    const cases = [
      [`discoveredSince=${cutoff}`, ["Discovered"]],
      [`updatedSince=${cutoff}`, ["Viewed"]],
      [`viewedSince=${cutoff}`, ["Viewed"]],
      [`appliedSince=${cutoff}`, ["Applied recent"]],
      [`status=applied&appliedSince=${cutoff}`, ["Applied recent"]],
    ] as const;
    for (const [query, expectedTitles] of cases) {
      const response = await GET(new NextRequest(`http://localhost/api/jobs?sortBy=discoveredAt&${query}`));
      const payload = jobsResponseSchema.parse(await response.json());
      expect(payload.jobs.map((job) => job.title)).toEqual(expectedTitles);
    }
  });

  it.each([
    ["discoveredSince", "not-a-date"],
    ["updatedSince", "2026-07-18"],
    ["viewedSince", "July%2018,%202026"],
    ["appliedSince", "1721260800000"],
  ])(
    "rejects an invalid %s value",
    async (field, value) => {
      const { database } = harness.createDatabase();
      mockJobDependencies(database);
      const { GET } = await import("@/app/api/jobs/route");

      const response = await GET(new NextRequest(`http://localhost/api/jobs?${field}=${value}`));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "invalid_request" });
    }
  );

  it.each(["updatedAt", "viewedAt", "appliedAt"] as const)(
    "sorts %s in both directions with nulls last and stable pagination",
    async (sortBy) => {
      const { database } = harness.createDatabase();
      mockJobDependencies(database);
      const company = database.insert(companies).values({
        name: `Sort ${sortBy}`,
        careersUrl: `https://example.com/${sortBy}`,
      }).returning().get();
      const older = new Date("2026-07-16T00:00:00.000Z");
      const newer = new Date("2026-07-18T00:00:00.000Z");
      const values = (title: string, date: Date | null) => ({
        companyId: company.id,
        title,
        url: `https://example.com/${sortBy}/${title}`,
        updatedAt: sortBy === "updatedAt" ? date : older,
        viewedAt: sortBy === "viewedAt" ? date : null,
        appliedAt: sortBy === "appliedAt" ? date : null,
      });
      database.insert(jobs).values([
        values("Newer first", newer),
        values("Older", older),
        values("Newer second", newer),
        values("Missing", null),
      ]).run();
      const { GET } = await import("@/app/api/jobs/route");
      const fetchTitles = async (sortOrder: "asc" | "desc", limit = 25, offset = 0) => {
        const response = await GET(new NextRequest(
          `http://localhost/api/jobs?sortBy=${sortBy}&sortOrder=${sortOrder}&limit=${limit}&offset=${offset}`
        ));
        return jobsResponseSchema.parse(await response.json()).jobs.map((job) => job.title);
      };

      await expect(fetchTitles("desc")).resolves.toEqual(["Newer second", "Newer first", "Older", "Missing"]);
      await expect(fetchTitles("asc")).resolves.toEqual(["Older", "Newer second", "Newer first", "Missing"]);
      const firstPage = await fetchTitles("desc", 2, 0);
      const secondPage = await fetchTitles("desc", 2, 2);
      expect([...firstPage, ...secondPage]).toEqual(["Newer second", "Newer first", "Older", "Missing"]);
    }
  );

  it("applies date ordering and filters in the legacy score-aware path", async () => {
    const { database } = harness.createDatabase();
    mockJobDependencies(database);
    const company = database.insert(companies).values({
      name: "Legacy score path",
      careersUrl: "https://example.com/legacy-score-path",
    }).returning().get();
    database.insert(jobs).values([
      { companyId: company.id, title: "Legacy older", url: "https://example.com/legacy-older", matchScore: 80, appliedAt: new Date("2026-07-16T00:00:00.000Z") },
      { companyId: company.id, title: "Legacy newer", url: "https://example.com/legacy-newer", matchScore: 90, appliedAt: new Date("2026-07-18T00:00:00.000Z") },
      { companyId: company.id, title: "Below threshold", url: "https://example.com/below", matchScore: 50, appliedAt: new Date("2026-07-19T00:00:00.000Z") },
    ]).run();
    const { GET } = await import("@/app/api/jobs/route");

    const response = await GET(new NextRequest(
      "http://localhost/api/jobs?minScore=70&appliedSince=2026-07-15T00:00:00.000Z&sortBy=appliedAt&sortOrder=desc"
    ));
    const payload = jobsResponseSchema.parse(await response.json());

    expect(payload.jobs.map((job) => job.title)).toEqual(["Legacy newer", "Legacy older"]);
  });

  it("applies date ordering and filters in the current match score-aware path", async () => {
    const { database } = harness.createDatabase();
    const candidateFingerprint = "c".repeat(64);
    mockJobDependencies(database, { candidateFingerprint, scoringPolicyVersion: "current-policy" });
    const company = database.insert(companies).values({
      name: "Current score path",
      careersUrl: "https://example.com/current-score-path",
    }).returning().get();
    const [currentHigh, currentLow] = database.insert(jobs).values([
      { companyId: company.id, title: "Current high", url: "https://example.com/current-high", matchScore: 10, viewedAt: new Date("2026-07-18T00:00:00.000Z") },
      { companyId: company.id, title: "Current low", url: "https://example.com/current-low", matchScore: 95, viewedAt: new Date("2026-07-19T00:00:00.000Z") },
    ]).returning().all();
    database.insert(matchResults).values([
      { id: "current-high", jobId: currentHigh.id, candidateFingerprint, jobFingerprint: "d".repeat(64), scoringPolicyVersion: "current-policy", score: 88, breakdownJson: "{}", evidenceJson: "{}", confidence: 0, source: "deterministic", isStale: false },
      { id: "current-low", jobId: currentLow.id, candidateFingerprint, jobFingerprint: "e".repeat(64), scoringPolicyVersion: "current-policy", score: 40, breakdownJson: "{}", evidenceJson: "{}", confidence: 0, source: "deterministic", isStale: false },
    ]).run();
    const { GET } = await import("@/app/api/jobs/route");

    const response = await GET(new NextRequest(
      "http://localhost/api/jobs?minScore=70&viewedSince=2026-07-17T00:00:00.000Z&sortBy=viewedAt&sortOrder=desc"
    ));
    const payload = jobsResponseSchema.parse(await response.json());

    expect(payload.jobs.map((job) => job.title)).toEqual(["Current high"]);
  });
});
