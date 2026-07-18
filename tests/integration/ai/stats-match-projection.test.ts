import { afterEach, describe, expect, it, vi } from "vitest";

import { statsResponseSchema } from "@/lib/api/contracts/stats";
import { companies, jobs, matchResults } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-stats-match-projection-");

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/ai/matcher/presentation");
  vi.resetModules();
});

describe("dashboard match statistics", () => {
  it("returns contract-valid empty statistics for explicit 30 and 90 day periods", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/matcher/presentation", () => ({
      getCurrentMatchContext: vi.fn().mockResolvedValue(null),
    }));
    const { GET } = await import("@/app/api/stats/route");

    for (const days of [30, 90] as const) {
      const response = await GET(new Request(`http://localhost/api/stats?days=${days}`));
      const payload = statsResponseSchema.parse(await response.json());

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        totalJobs: 0,
        activeJobs: 0,
        activeHighMatchJobs: 0,
        period: { days },
        statusCounts: { new: 0, viewed: 0, interested: 0, applied: 0, rejected: 0, archived: 0 },
        recentActivity: { discovered: 0, viewed: 0, applied: 0 },
      });
      expect(new Date(payload.period.end).getTime() - new Date(payload.period.start).getTime())
        .toBe(days * 24 * 60 * 60 * 1_000);
    }
  });

  it("counts explicit legacy matches when a current matcher context exists", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/matcher/presentation", () => ({
      getCurrentMatchContext: vi.fn().mockResolvedValue({
        candidateFingerprint: "a".repeat(64),
        scoringPolicyVersion: "current-policy",
      }),
    }));
    const { GET } = await import("@/app/api/stats/route");
    const company = database.insert(companies).values({
      name: "Stats fixture",
      careersUrl: "https://example.com/careers",
    }).returning().get();
    database.insert(jobs).values([{
      companyId: company.id,
      title: "Legacy good match",
      url: "https://example.com/jobs/legacy-good",
      matchScore: 80,
    }, {
      companyId: company.id,
      title: "Unmatched role",
      url: "https://example.com/jobs/unmatched",
    }]).run();

    const response = await GET(new Request("http://localhost/api/stats"));

    expect(await response.json()).toMatchObject({
      totalJobs: 2,
      highMatchJobs: 1,
      activeHighMatchJobs: 1,
      jobsWithScore: 1,
      period: { days: 7 },
    });
  });

  it("reports current status counts and bounded recent activity without changing legacy counters", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/matcher/presentation", () => ({
      getCurrentMatchContext: vi.fn().mockResolvedValue(null),
    }));
    const company = database.insert(companies).values({
      name: "Period fixture",
      careersUrl: "https://example.com/period",
    }).returning().get();
    const now = new Date("2026-07-18T12:00:00.000Z");
    const periodStart = new Date("2026-07-11T12:00:00.000Z");
    const beforePeriod = new Date(periodStart.getTime() - 1);
    database.insert(jobs).values([
      { companyId: company.id, title: "New", url: "https://example.com/new", status: "new", discoveredAt: periodStart },
      { companyId: company.id, title: "Viewed", url: "https://example.com/viewed", status: "viewed", discoveredAt: now, viewedAt: periodStart },
      { companyId: company.id, title: "Interested", url: "https://example.com/interested", status: "interested", discoveredAt: beforePeriod },
      { companyId: company.id, title: "Applied", url: "https://example.com/applied", status: "applied", discoveredAt: beforePeriod, appliedAt: now },
      { companyId: company.id, title: "Rejected", url: "https://example.com/rejected", status: "rejected", discoveredAt: beforePeriod },
      { companyId: company.id, title: "Archived", url: "https://example.com/archived", status: "archived", discoveredAt: beforePeriod, matchScore: 90 },
    ]).run();

    const { getDashboardStats } = await import("@/lib/application/stats-service");
    const stats = await getDashboardStats(7, now);

    expect(stats).toMatchObject({
      newJobs: 1,
      activeJobs: 4,
      activeHighMatchJobs: 0,
      statusCounts: {
        new: 1,
        viewed: 1,
        interested: 1,
        applied: 1,
        rejected: 1,
        archived: 1,
      },
      recentActivity: { discovered: 2, viewed: 1, applied: 1 },
      period: {
        days: 7,
        start: periodStart.toISOString(),
        end: now.toISOString(),
      },
    });
  });

  it("uses the selected current match result for active high-match totals", async () => {
    const { database } = harness.createDatabase();
    const candidateFingerprint = "a".repeat(64);
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/matcher/presentation", () => ({
      getCurrentMatchContext: vi.fn().mockResolvedValue({
        candidateFingerprint,
        scoringPolicyVersion: "current-policy",
      }),
    }));
    const company = database.insert(companies).values({
      name: "Current score fixture",
      careersUrl: "https://example.com/current-score",
    }).returning().get();
    const job = database.insert(jobs).values({
      companyId: company.id,
      title: "Current high match",
      url: "https://example.com/current-high",
      status: "new",
      matchScore: 40,
    }).returning().get();
    database.insert(matchResults).values({
      id: "current-result",
      jobId: job.id,
      candidateFingerprint,
      jobFingerprint: "b".repeat(64),
      scoringPolicyVersion: "current-policy",
      score: 91,
      breakdownJson: "{}",
      evidenceJson: "{}",
      confidence: 0,
      source: "deterministic",
      isStale: false,
    }).run();

    const { getDashboardStats } = await import("@/lib/application/stats-service");

    await expect(getDashboardStats()).resolves.toMatchObject({
      highMatchJobs: 1,
      activeHighMatchJobs: 1,
      jobsWithScore: 1,
    });
  });

  it("rejects unsupported stats periods", async () => {
    const { GET } = await import("@/app/api/stats/route");
    const response = await GET(new Request("http://localhost/api/stats?days=365"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_request" });
  });
});
