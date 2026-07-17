import { afterEach, describe, expect, it, vi } from "vitest";

import { companies, jobs } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-stats-match-projection-");

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/ai/matcher/presentation");
  vi.resetModules();
});

describe("dashboard match statistics", () => {
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
      jobsWithScore: 1,
    });
  });
});
