import { describe, expect, it } from "vitest";

import {
  jobSchema,
  jobResourceUpdateBodySchema,
  jobsQuerySchema,
} from "@/lib/api/contracts/jobs";
import { positiveIntegerIdSchema } from "@/lib/api/contracts/common";
import { aiUsageQuerySchema } from "@/lib/api/contracts/ai";
import {
  companyCreateBodySchema,
  companyIdParamsSchema,
  companyIdsBodySchema,
} from "@/lib/api/contracts/companies";
import {
  historyIdParamsSchema,
  historyDetailQuerySchema,
  historyQuerySchema,
  matchHistoryDetailResponseSchema,
} from "@/lib/api/contracts/history";
import { matchCompanyIdsBodySchema } from "@/lib/api/contracts/matching";
import {
  peopleListQuerySchema,
  peopleImportSessionsQuerySchema,
  personIdParamsSchema,
  unmatchedCompanyPatchBodySchema,
} from "@/lib/api/contracts/people";
import {
  childIdParamsSchema,
  profileWriteBodySchema,
} from "@/lib/api/contracts/profile";
import {
  localCLIStatusQuerySchema,
  providerCreateBodySchema,
  providerModelsQuerySchema,
} from "@/lib/api/contracts/providers";
import {
  matchSessionParamsSchema,
  matchSessionProgressResponseSchema,
  schedulerRecoveryResponseSchema,
} from "@/lib/api/contracts/runtime";
import {
  settingsResponseSchema,
  settingsUpdateBodySchema,
} from "@/lib/api/contracts/settings";
import { statsResponseSchema } from "@/lib/api/contracts/stats";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings-service";

describe("shared API contracts", () => {
  it.each(["0", "-1", "abc", "1.5"])("rejects invalid path id %s", (id) => {
    expect(positiveIntegerIdSchema.safeParse(id).success).toBe(false);
  });

  it("rejects invalid pagination, enums, and score bounds", () => {
    expect(jobsQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(jobsQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(jobsQuerySchema.safeParse({ offset: "-1" }).success).toBe(false);
    expect(jobsQuerySchema.safeParse({ status: "unknown" }).success).toBe(false);
    expect(
      jobsQuerySchema.safeParse({ minScore: "80", maxScore: "20" }).success
    ).toBe(false);
  });

  it("rejects invalid mutation dates and statuses", () => {
    expect(
      jobResourceUpdateBodySchema.safeParse({ status: "unknown" }).success
    ).toBe(false);
    expect(
      jobResourceUpdateBodySchema.safeParse({ appliedAt: "not-a-date" }).success
    ).toBe(false);
  });

  it("rejects partial and malformed resource IDs", () => {
    for (const value of ["1junk", "0", "-2", "1.5"]) {
      expect(companyIdParamsSchema.safeParse({ id: value }).success).toBe(false);
      expect(personIdParamsSchema.safeParse({ id: value }).success).toBe(false);
      expect(childIdParamsSchema.safeParse({ id: value }).success).toBe(false);
    }
  });

  it("bounds history and people pagination", () => {
    expect(historyQuerySchema.safeParse({ limit: "-1" }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ offset: "not-a-number" }).success).toBe(false);
    expect(peopleListQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
    expect(peopleListQuerySchema.safeParse({ offset: "-1" }).success).toBe(false);
    expect(historyDetailQuerySchema.safeParse({ logLimit: "101" }).success).toBe(false);
    expect(historyDetailQuerySchema.safeParse({ logOffset: "-1" }).success).toBe(false);
    expect(peopleImportSessionsQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
    expect(peopleImportSessionsQuerySchema.safeParse({ offset: "-1" }).success).toBe(false);
  });

  it("validates company and matching commands before execution", () => {
    expect(companyCreateBodySchema.safeParse({ name: "A", careersUrl: "not-a-url" }).success).toBe(false);
    expect(companyIdsBodySchema.safeParse({ companyIds: [] }).success).toBe(false);
    expect(matchCompanyIdsBodySchema.safeParse({ companyIds: ["invalid"] }).success).toBe(false);
    expect(matchCompanyIdsBodySchema.safeParse({ companyIds: [1, 2] }).success).toBe(true);
  });

  it("validates profile, provider, and people mutation bodies", () => {
    expect(profileWriteBodySchema.safeParse({ name: "", email: "bad" }).success).toBe(false);
    expect(providerCreateBodySchema.safeParse({ provider: "" }).success).toBe(false);
    expect(unmatchedCompanyPatchBodySchema.safeParse({ action: "map", companyNormalized: "A" }).success).toBe(false);
  });

  it("rejects malformed runtime and stats responses", () => {
    expect(matchSessionProgressResponseSchema.safeParse({ sessionId: "x" }).success).toBe(false);
    expect(statsResponseSchema.safeParse({ totalJobs: -1 }).success).toBe(false);
    expect(settingsUpdateBodySchema.safeParse({ theme: "dark" }).success).toBe(false);
  });

  it("validates remaining diagnostic and history query boundaries", () => {
    expect(matchSessionParamsSchema.safeParse({ id: "" }).success).toBe(false);
    expect(providerModelsQuerySchema.safeParse({ refresh: "yes" }).success).toBe(false);
    expect(localCLIStatusQuerySchema.safeParse({ provider: "openai" }).success).toBe(false);
    expect(aiUsageQuerySchema.safeParse({ days: "365" }).success).toBe(false);
    expect(aiUsageQuerySchema.parse({})).toEqual({ days: 7 });
    expect(historyIdParamsSchema.safeParse({ id: "" }).success).toBe(false);
  });

  it("accepts real nullable job persistence and complete runtime responses", () => {
    const job = {
      id: 1,
      companyId: 1,
      externalId: null,
      title: "Engineer",
      description: null,
      descriptionFormat: "plain",
      url: "https://example.com/job/1",
      location: null,
      locationType: null,
      salary: null,
      department: null,
      employmentType: null,
      seniorityLevel: null,
      status: "new",
      postedDate: null,
      discoveredAt: null,
      updatedAt: null,
      archivedAt: null,
      archiveSource: null,
      viewedAt: null,
      appliedAt: null,
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
      company: { id: 1, name: "Example", logoUrl: null, platform: null },
    };
    expect(jobSchema.safeParse(job).success).toBe(true);
    expect(jobSchema.safeParse({ ...job, matchReasons: "[]" }).success).toBe(false);
    expect(jobSchema.safeParse({ ...job, matchedSkills: "[]" }).success).toBe(false);
    expect(settingsResponseSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(schedulerRecoveryResponseSchema.safeParse({
      status: "not_needed",
      pendingMissedCount: 0,
      oldestMissedRun: null,
      latestMissedRun: null,
    }).success).toBe(true);
    expect(schedulerRecoveryResponseSchema.safeParse({}).success).toBe(false);
  });

  it("rejects malformed nested match-history provenance and pipeline objects", () => {
    const base = {
      session: {
        id: "session-1",
        triggerSource: "manual",
        companyId: null,
        companyName: null,
        status: "completed",
        jobsTotal: 1,
        jobsCompleted: 1,
        jobsSucceeded: 1,
        jobsFailed: 0,
        errorCount: 0,
        startedAt: null,
        completedAt: null,
      },
      logs: [],
      pipeline: {
        analysis: {},
        matching: {},
        jobs: [{}],
      },
    };
    expect(matchHistoryDetailResponseSchema.safeParse(base).success).toBe(false);
    expect(matchHistoryDetailResponseSchema.safeParse({
      ...base,
      logs: [{
        id: 1,
        sessionId: "session-1",
        jobId: 1,
        jobTitle: "Engineer",
        companyName: "Example",
        status: "success",
        score: 90,
        attemptCount: 1,
        errorType: null,
        errorMessage: null,
        duration: 100,
        modelUsed: "model",
        completedAt: null,
        analysisRun: {},
      }],
    }).success).toBe(false);
  });
});
