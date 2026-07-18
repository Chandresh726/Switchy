import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { companyOverviewResponseSchema } from "@/lib/api/contracts/companies";
import { peopleListResponseSchema } from "@/lib/api/contracts/people";
import type { MatchPresentation } from "@/lib/ai/matcher/presentation";
import { companies, jobs, people } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-company-people-insights-");

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

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/ai/matcher/presentation");
  vi.resetModules();
});

describe("company and people insights", () => {
  it("exposes existing people facts and truthful company job aggregates", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/matcher/presentation", () => ({
      getCurrentMatchContext: vi.fn().mockResolvedValue(null),
      getMatchPresentations: vi.fn().mockImplementation(async (rows: Array<{ id: number }>) => (
        new Map(rows.map((row) => [row.id, EMPTY_PRESENTATION]))
      )),
    }));
    const company = database.insert(companies).values({
      name: "Insight Company",
      careersUrl: "https://example.com/insights",
    }).returning().get();
    const emptyCompany = database.insert(companies).values({
      name: "Empty Company",
      careersUrl: "https://example.com/empty-insights",
    }).returning().get();
    const now = new Date("2026-07-18T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const sevenDaysAgo = new Date("2026-07-11T12:00:00.000Z");
    const beforeWindow = new Date(sevenDaysAgo.getTime() - 1);
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
    database.insert(jobs).values([
      { companyId: company.id, title: "New", url: "https://example.com/jobs/new", status: "new", discoveredAt: sevenDaysAgo },
      { companyId: company.id, title: "Viewed", url: "https://example.com/jobs/viewed", status: "viewed", discoveredAt: now },
      { companyId: company.id, title: "Interested", url: "https://example.com/jobs/interested", status: "interested", discoveredAt: beforeWindow },
      { companyId: company.id, title: "Applied", url: "https://example.com/jobs/applied", status: "applied", discoveredAt: beforeWindow },
      { companyId: company.id, title: "Rejected", url: "https://example.com/jobs/rejected", status: "rejected", discoveredAt: beforeWindow },
      { companyId: company.id, title: "Archived", url: "https://example.com/jobs/archived", status: "archived", discoveredAt: future },
    ]).run();
    const recruiter = database.insert(people).values({
      identityKey: "recruiter-active",
      source: "linkedin",
      sourceRecordKey: "recruiter-1",
      firstName: "Riya",
      lastName: "Recruiter",
      fullName: "Riya Recruiter",
      profileUrl: "https://linkedin.example/riya",
      profileUrlNormalized: "https://linkedin.example/riya",
      email: "riya@example.com",
      companyRaw: "Insight Company",
      companyNormalized: "insight company",
      position: "Senior Technical Recruiter",
      connectedOn: new Date("2026-06-01T00:00:00.000Z"),
      mappedCompanyId: company.id,
      isStarred: true,
      roleTag: "recruiter",
      roleTagSource: "inferred",
      notes: "Primary recruiting contact",
      lastSeenAt: new Date("2026-07-17T00:00:00.000Z"),
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-17T00:00:00.000Z"),
    }).returning().get();
    database.insert(people).values([
      {
        identityKey: "engineer-active",
        source: "apollo",
        firstName: "Evan",
        lastName: "Engineer",
        fullName: "Evan Engineer",
        profileUrl: "https://linkedin.example/evan",
        profileUrlNormalized: "https://linkedin.example/evan",
        position: "Staff Engineer",
        mappedCompanyId: company.id,
        lastSeenAt: new Date("2026-07-16T00:00:00.000Z"),
      },
      {
        identityKey: "recruiter-inactive",
        source: "linkedin",
        firstName: "Inactive",
        lastName: "Recruiter",
        fullName: "Inactive Recruiter",
        profileUrl: "https://linkedin.example/inactive",
        profileUrlNormalized: "https://linkedin.example/inactive",
        position: "Recruiter",
        mappedCompanyId: company.id,
        isActive: false,
        lastSeenAt: new Date("2026-07-15T00:00:00.000Z"),
      },
    ]).run();

    const [overviewRoute, peopleRoute] = await Promise.all([
      import("@/app/api/companies/[id]/overview/route"),
      import("@/app/api/people/route"),
    ]);
    const overviewResponse = await overviewRoute.GET(
      new NextRequest(`http://localhost/api/companies/${company.id}/overview`),
      { params: Promise.resolve({ id: String(company.id) }) }
    );
    const overview = companyOverviewResponseSchema.parse(await overviewResponse.json());
    const emptyOverviewResponse = await overviewRoute.GET(
      new NextRequest(`http://localhost/api/companies/${emptyCompany.id}/overview`),
      { params: Promise.resolve({ id: String(emptyCompany.id) }) }
    );
    const emptyOverview = companyOverviewResponseSchema.parse(await emptyOverviewResponse.json());
    const peopleResponse = await peopleRoute.GET(
      new NextRequest("http://localhost/api/people?limit=20&offset=0")
    );
    const peoplePayload = peopleListResponseSchema.parse(await peopleResponse.json());

    expect(overviewResponse.status).toBe(200);
    expect(emptyOverviewResponse.status).toBe(200);
    expect(overview.stats).toEqual({
      openJobs: 4,
      highMatchJobs: 0,
      mappedPeople: 2,
      starredPeople: 1,
      statusCounts: { new: 1, viewed: 1, interested: 1, applied: 1, rejected: 1, archived: 1 },
      jobsDiscoveredLast7Days: 2,
      lastJobDiscoveredAt: future.toISOString(),
    });
    expect(emptyOverview.stats).toEqual({
      openJobs: 0,
      highMatchJobs: 0,
      mappedPeople: 0,
      starredPeople: 0,
      statusCounts: { new: 0, viewed: 0, interested: 0, applied: 0, rejected: 0, archived: 0 },
      jobsDiscoveredLast7Days: 0,
      lastJobDiscoveredAt: null,
    });
    expect(overview.people).toHaveLength(2);
    expect(overview.people.map((person) => person.fullName)).not.toContain("Inactive Recruiter");
    expect(peoplePayload.people).toHaveLength(2);
    expect(peoplePayload.people.map((person) => person.fullName)).not.toContain("Inactive Recruiter");

    const overviewRecruiter = overview.people.find((person) => person.id === recruiter.id);
    const listedRecruiter = peoplePayload.people.find((person) => person.id === recruiter.id);
    expect(overviewRecruiter).toMatchObject({
      isRecruiter: true,
      connectedOn: "2026-06-01T00:00:00.000Z",
      roleTag: "recruiter",
      roleTagSource: "inferred",
      notes: "Primary recruiting contact",
    });
    expect(listedRecruiter).toMatchObject({
      isRecruiter: true,
      connectedOn: overviewRecruiter?.connectedOn,
      roleTag: overviewRecruiter?.roleTag,
      roleTagSource: overviewRecruiter?.roleTagSource,
      notes: overviewRecruiter?.notes,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
    expect(overview.people.find((person) => person.fullName === "Evan Engineer"))
      .toMatchObject({ isRecruiter: false, connectedOn: null, roleTag: null, notes: null });
  });
});
