import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildJobEvidenceInput,
  buildJobFingerprint,
} from "@/lib/ai/artifacts/fingerprints";
import { companies, jobs, matchResults } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-match-presentation-");

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.resetModules();
});

describe("authoritative match presentation queries", () => {
  it("loads the exact current result and at most the latest stale fallback", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    const { getMatchPresentations } = await import(
      "@/lib/ai/matcher/presentation"
    );
    const company = database.insert(companies).values({
      name: "Presentation fixture",
      careersUrl: "https://example.com/careers",
    }).returning().get();
    const job = database.insert(jobs).values({
      companyId: company.id,
      title: "Backend Engineer",
      description: "Build TypeScript services",
      url: "https://example.com/jobs/backend",
      location: "Remote",
      locationType: "remote",
      seniorityLevel: "mid",
      department: "Engineering",
      employmentType: "full-time",
    }).returning().get();
    const jobFingerprint = buildJobFingerprint(buildJobEvidenceInput(job));
    const evidenceJson = JSON.stringify({
      reasons: [],
      matchedSkills: [],
      missingSkills: [],
      recommendations: [],
      componentEvidence: {},
    });
    database.insert(matchResults).values([
      {
        id: "current-result",
        jobId: job.id,
        candidateFingerprint: "a".repeat(64),
        jobFingerprint,
        scoringPolicyVersion: "policy-current",
        score: 86,
        breakdownJson: JSON.stringify({ mustHaveSkills: 90 }),
        evidenceJson,
        confidence: 0.85,
        source: "deterministic",
        createdAt: new Date("2026-07-14T00:00:00.000Z"),
      },
      {
        id: "older-history",
        jobId: job.id,
        candidateFingerprint: "b".repeat(64),
        jobFingerprint,
        scoringPolicyVersion: "policy-old",
        score: 70,
        breakdownJson: JSON.stringify({ mustHaveSkills: 70 }),
        evidenceJson,
        confidence: 0.7,
        source: "deterministic",
        createdAt: new Date("2026-07-13T00:00:00.000Z"),
      },
      {
        id: "latest-history",
        jobId: job.id,
        candidateFingerprint: "c".repeat(64),
        jobFingerprint,
        scoringPolicyVersion: "policy-latest",
        score: 74,
        breakdownJson: JSON.stringify({ mustHaveSkills: 75 }),
        evidenceJson,
        confidence: 0.72,
        source: "deterministic",
        createdAt: new Date("2026-07-15T00:00:00.000Z"),
      },
    ]).run();

    const current = await getMatchPresentations([job], {
      candidateFingerprint: "a".repeat(64),
      scoringPolicyVersion: "policy-current",
    });
    expect(current.get(job.id)).toMatchObject({
      matchResultId: "current-result",
      matchScore: 86,
      matchStale: false,
    });

    const changedCandidate = await getMatchPresentations([job], {
      candidateFingerprint: "d".repeat(64),
      scoringPolicyVersion: "policy-current",
    });
    expect(changedCandidate.get(job.id)).toMatchObject({
      matchResultId: "latest-history",
      matchScore: null,
      matchStale: true,
    });

    const freshOnly = await getMatchPresentations(
      [job],
      {
        candidateFingerprint: "d".repeat(64),
        scoringPolicyVersion: "policy-current",
      },
      { includeStale: false }
    );
    expect(freshOnly.get(job.id)).toMatchObject({
      matchResultId: null,
      matchScore: null,
      matchStale: false,
    });
  });
});
