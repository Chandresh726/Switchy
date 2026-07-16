import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { removeObsoleteMatchData } from "@/lib/ai/artifacts/obsolete-match-data";
import { AI_MATCH_POLICY_BASE_VERSION } from "@/lib/ai/matcher/evidence/ai-match";
import {
  companies,
  jobs,
  matchLogs,
  matchResults,
  matchSessions,
  settings,
} from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-obsolete-match-data-");

describe("obsolete match data cleanup", () => {
  it("removes old artifacts and legacy job payloads while retaining current matches", () => {
    const { database } = harness.createDatabase();
    const company = database.insert(companies).values({
      name: "Cleanup fixture",
      careersUrl: "https://example.com/careers",
    }).returning().get();
    const oldJob = database.insert(jobs).values({
      companyId: company.id,
      title: "Old match",
      url: "https://example.com/jobs/old",
      matchScore: 82,
      matchReasons: '["Old reason"]',
      matchedSkills: '["TypeScript"]',
      missingSkills: '["Rust"]',
      recommendations: '["Practice Rust"]',
    }).returning().get();
    const currentJob = database.insert(jobs).values({
      companyId: company.id,
      title: "Current match",
      url: "https://example.com/jobs/current",
    }).returning().get();
    const resultValues = {
      candidateFingerprint: "a".repeat(64),
      jobFingerprint: "b".repeat(64),
      score: 80,
      breakdownJson: JSON.stringify({ skillsAndTechnologies: 80 }),
      evidenceJson: JSON.stringify({ summary: "Match", reasoning: [], matchedSkills: [] }),
      confidence: 0,
      source: "ai",
    };
    database.insert(matchResults).values([{
      ...resultValues,
      id: "old-result",
      jobId: oldJob.id,
      scoringPolicyVersion: "ai-match-policy-v2-old",
      matchPolicyVersion: "ai-match-policy-v2-old",
    }, {
      ...resultValues,
      id: "current-result",
      jobId: currentJob.id,
      candidateFingerprint: "c".repeat(64),
      jobFingerprint: "d".repeat(64),
      scoringPolicyVersion: `${AI_MATCH_POLICY_BASE_VERSION}-current`,
      matchPolicyVersion: `${AI_MATCH_POLICY_BASE_VERSION}-current`,
    }]).run();
    database.insert(matchSessions).values({
      id: "history-session",
      triggerSource: "manual",
      status: "completed",
    }).run();
    database.insert(matchSessions).values([{
      id: "current-history-session",
      triggerSource: "manual",
      status: "completed",
    }, {
      id: "active-session",
      triggerSource: "manual",
      status: "queued",
    }]).run();
    database.insert(matchLogs).values([{
      sessionId: "history-session",
      jobId: oldJob.id,
      status: "success",
      score: 82,
      matchResultId: "old-result",
    }, {
      sessionId: "current-history-session",
      jobId: currentJob.id,
      status: "success",
      score: 80,
      matchResultId: "current-result",
    }, {
      jobId: oldJob.id,
      status: "success",
      score: 82,
      matchResultId: "old-result",
    }]).run();

    expect(removeObsoleteMatchData(database)).toEqual({
      deletedMatchResults: 1,
      deletedMatchHistorySessions: 1,
      deletedMatchHistoryLogs: 2,
      clearedLegacyJobs: 1,
    });
    expect(database.select().from(matchResults).all()).toMatchObject([{
      id: "current-result",
    }]);
    expect(database.select().from(matchSessions).all().map((row) => row.id).sort())
      .toEqual(["active-session", "current-history-session"]);
    expect(database.select().from(matchLogs).all()).toMatchObject([{
      sessionId: "current-history-session",
      matchResultId: "current-result",
      score: 80,
    }]);
    expect(database.select().from(jobs).where(eq(jobs.id, oldJob.id)).get())
      .toMatchObject({
        matchScore: null,
        matchReasons: null,
        matchedSkills: null,
        missingSkills: null,
        recommendations: null,
      });
    expect(database.select().from(settings)
      .where(eq(settings.key, "ai.match_history_v3_cleanup_completed")).get()?.value)
      .toBeTruthy();

    expect(removeObsoleteMatchData(database)).toEqual({
      deletedMatchResults: 0,
      deletedMatchHistorySessions: 0,
      deletedMatchHistoryLogs: 0,
      clearedLegacyJobs: 0,
    });
  });
});
