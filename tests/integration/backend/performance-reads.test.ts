import { insertJobsWithMatches } from "@test/helpers/match-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jobsQuerySchema, jobsResponseSchema, jobStatusCountsSchema } from "@/lib/api/contracts/jobs";
import { companies } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-performance-reads-");

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/ai/matcher/presentation");
  vi.resetModules();
});

async function setup() {
  const { database } = harness.createDatabase();
  vi.doMock("@/lib/db", () => ({ db: database }));
  vi.doMock("@/lib/ai/matcher/presentation", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/lib/ai/matcher/presentation")>(),
    getCurrentMatchContext: vi.fn().mockResolvedValue(null),

  }));
  const company = database.insert(companies).values({ name: "Acme", careersUrl: "https://example.test/jobs" }).returning().get();
  insertJobsWithMatches(database, [
    { companyId: company.id, title: "Engineer", description: "TypeScript", url: "https://example.test/1", status: "new", matchScore: 90 },
    { companyId: company.id, title: "Engineer", description: "TypeScript", url: "https://example.test/2", status: "applied", matchScore: 80 },
    { companyId: company.id, title: "Designer", description: "Design", url: "https://example.test/3", status: "archived", matchScore: 50 },
  ]);
  return { database, company };
}

describe("optimized resource reads", () => {
  it("shares match context across dashboard sections and skips preview totals", async () => {
    await setup();
    const { getDashboard } = await import("@/lib/application/dashboard-service");
    const { getCurrentMatchContext } = await import("@/lib/ai/matcher/presentation");
    const response = await getDashboard({ requestId: "dashboard-test" });
    expect(response.errors).toEqual({});
    expect(response.stats?.totalJobs).toBe(3);
    expect(response.recentJobs?.totalCount).toBeNull();
    expect(response.recentJobs?.jobs).toHaveLength(1);
    expect(getCurrentMatchContext).toHaveBeenCalledTimes(1);
  });

  it("returns current status counts, including zero buckets, after a job mutation", async () => {
    await setup();
    const { GET } = await import("@/app/api/jobs/counts/route");
    const { updateJob } = await import("@/lib/application/jobs-service");
    const response = await GET(new Request("http://localhost/api/jobs/counts"));
    expect(jobStatusCountsSchema.parse(await response.json())).toEqual({
      new: 1, viewed: 0, interested: 0, applied: 1, rejected: 0, archived: 1,
    });
    await updateJob(1, { status: "interested" });
    const updated = await GET(new Request("http://localhost/api/jobs/counts"));
    expect(await updated.json()).toMatchObject({ new: 0, interested: 1 });
  });

  it.each(["discoveredAt", "matchScore"] as const)("keeps search totals correct for %s, empty pages, and score filters", async (sortBy) => {
    await setup();
    const { listJobs } = await import("@/lib/application/jobs-service");
    const first = await listJobs(jobsQuerySchema.parse({ search: "TypeScript", sortBy, limit: 1 }));
    expect(first).toMatchObject({ totalCount: 2, hasMore: true });
    expect(jobsResponseSchema.parse(JSON.parse(JSON.stringify(first))).jobs).toHaveLength(1);
    expect(first.jobs[0]).not.toHaveProperty("matchReasoning");
    expect(first.jobs[0]).not.toHaveProperty("matchReasons");
    const emptyPage = await listJobs(jobsQuerySchema.parse({ search: "TypeScript", sortBy, limit: 1, offset: 10 }));
    expect(emptyPage).toEqual({ jobs: [], totalCount: 2, hasMore: false });
    const filtered = await listJobs(jobsQuerySchema.parse({ search: "TypeScript", sortBy, minScore: 85 }));
    expect(filtered.totalCount).toBe(1);
    const missing = await listJobs(jobsQuerySchema.parse({ search: "absent", sortBy }));
    expect(missing).toEqual({ jobs: [], totalCount: 0, hasMore: false });
  });

  it("loads only the requested company section while preserving shared statistics", async () => {
    const { company } = await setup();
    const { getCompanyOverview } = await import("@/lib/application/companies-service");
    const all = await getCompanyOverview(company.id);
    const notes = await getCompanyOverview(company.id, new Date(), "notes");
    expect(all.jobs).toHaveLength(3);
    expect(all.jobs[0]).not.toHaveProperty("matchBreakdown");
    expect(all.jobs[0]).not.toHaveProperty("matchReasons");
    expect(notes.jobs).toEqual([]);
    expect(notes.topMatches).toEqual([]);
    expect(notes.people).toEqual([]);
    expect(notes.activity).toEqual({ scrapeLogs: [], matchSessions: [] });
    expect(notes.stats).toEqual(all.stats);
  });
});
