import { APICallError } from "ai";
import { describe, expect, it } from "vitest";

import { logMatchFailure } from "@/lib/ai/matcher/tracking/session";
import { companies, jobs, matchLogs, matchSessions } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-match-failure-sanitization-");

describe("match failure persistence", () => {
  it("stores only sanitized provider errors", async () => {
    const { database } = harness.createDatabase();
    const company = database.insert(companies).values({
      name: "Sanitization Test",
      careersUrl: "https://example.test/careers",
    }).returning().get();
    const job = database.insert(jobs).values({
      companyId: company.id,
      title: "Private Candidate Role",
      url: "https://example.test/jobs/private",
    }).returning().get();
    database.insert(matchSessions).values({
      id: "session-1",
      triggerSource: "manual",
      status: "in_progress",
      jobsTotal: 1,
    }).run();
    const providerError = new APICallError({
      message: "Provider rejected SENTINEL_CANDIDATE_DATA",
      url: "https://provider.invalid/generate",
      requestBodyValues: { prompt: "SENTINEL_CANDIDATE_DATA" },
      statusCode: 503,
      responseHeaders: {},
      responseBody: "SENTINEL_JOB_DESCRIPTION",
      isRetryable: true,
    });

    await logMatchFailure(
      "session-1",
      job.id,
      25,
      providerError,
      1,
      "synthetic-model",
      database
    );

    const persisted = database.select().from(matchLogs).get();
    expect(persisted).toMatchObject({
      errorType: "generation_failed",
      errorMessage: "The AI provider could not complete the request.",
    });
    expect(JSON.stringify(persisted)).not.toContain("SENTINEL_CANDIDATE_DATA");
    expect(JSON.stringify(persisted)).not.toContain("SENTINEL_JOB_DESCRIPTION");
  });
});
