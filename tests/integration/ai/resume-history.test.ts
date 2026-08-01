import { describe, expect, it } from "vitest";

import {
  getResumeParseHistory,
  getResumeParseHistoryDetail,
} from "@/lib/ai/observability";
import {
  resumeHistoryDetailResponseSchema,
  resumeHistoryListResponseSchema,
} from "@/lib/api/contracts/history";
import { aiRuns, profile, resumes } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-resume-history-");

function resumeRun(
  id: string,
  status: "succeeded" | "failed" | "cancelled",
  createdAt: Date,
  overrides: Partial<typeof aiRuns.$inferInsert> = {}
) {
  return {
    id,
    capability: "resume_parse",
    providerRecordId: "provider-1",
    provider: "openai",
    modelId: "synthetic-model",
    promptVersion: "resume-normalization-prompt-v2",
    schemaVersion: "resume-data-v2",
    policyVersion: "resume-normalization-policy-v2",
    inputFingerprint: id.padEnd(64, "a").slice(0, 64),
    status,
    attemptCount: 1,
    totalTokens: 10,
    durationMs: 100,
    startedAt: createdAt,
    completedAt: new Date(createdAt.getTime() + 100),
    createdAt,
    ...overrides,
  };
}

describe("resume parse history", () => {
  it("merges stored uploads with orphan runs and paginates newest-first", async () => {
    const { database } = harness.createDatabase();
    const candidate = database.insert(profile).values({ name: "Alex Rivera" })
      .returning().get();
    const parsedAt = new Date("2026-07-01T10:00:00.000Z");
    const uploadOnlyAt = new Date("2026-07-02T10:00:00.000Z");

    database.insert(aiRuns).values([
      resumeRun("parsed-run", "succeeded", parsedAt, {
        metadataJson: JSON.stringify({
          fileName: "alex-resume.pdf",
          fileType: "pdf",
          fileSizeBytes: 2_048,
          parserVersion: "resume-normalizer-v2",
        }),
      }),
      resumeRun("failed-run", "failed", new Date("2026-07-03T10:00:00.000Z"), {
        totalTokens: 20,
        durationMs: 200,
        errorCode: "invalid_output",
        metadataJson: JSON.stringify({
          fileName: "broken.txt",
          fileType: "txt",
          fileSizeBytes: 512,
          parserVersion: "resume-normalizer-v2",
        }),
      }),
      resumeRun("detached-run", "succeeded", new Date("2026-07-04T10:00:00.000Z"), {
        totalTokens: 30,
        durationMs: 300,
        metadataJson: JSON.stringify({
          fileName: "removed.docx",
          fileType: "docx",
          fileSizeBytes: 4_096,
          parserVersion: "resume-normalizer-v2",
        }),
      }),
      resumeRun("cancelled-run", "cancelled", new Date("2026-07-05T10:00:00.000Z"), {
        totalTokens: 40,
        durationMs: 400,
        errorCode: "aborted",
        metadataJson: JSON.stringify({ fileName: "cancelled.pdf" }),
      }),
    ]).run();

    database.insert(resumes).values([
      {
        profileId: candidate.id,
        fileName: "alex-resume.pdf",
        filePath: "resumes/alex-resume.pdf",
        parsedData: JSON.stringify({
          name: "Alex Rivera",
          summary: "Staff engineer",
          skills: [{ name: "TypeScript" }],
          experience: [{
            company: "Acme",
            title: "Staff Engineer",
            startDate: "2024-01",
          }],
          education: [{ institution: "State University", degree: "BS" }],
        }),
        aiRunId: "parsed-run",
        parserVersion: "resume-normalizer-v2",
        validationWarnings: JSON.stringify([{
          code: "malformed_date",
          path: "experience.0.endDate",
          message: "Date should use YYYY-MM format.",
        }]),
        version: 1,
        isCurrent: false,
        storageState: "ready",
        createdAt: parsedAt,
      },
      {
        profileId: candidate.id,
        fileName: "manual.docx",
        filePath: "resumes/manual.docx",
        parsedData: "null",
        aiRunId: null,
        parserVersion: null,
        validationWarnings: "[]",
        version: 2,
        isCurrent: true,
        storageState: "ready",
        createdAt: uploadOnlyAt,
      },
    ]).run();

    const firstPage = await getResumeParseHistory(
      { limit: 3, offset: 0 },
      database
    );
    const secondPage = await getResumeParseHistory(
      { limit: 3, offset: 3 },
      database
    );

    expect(() => resumeHistoryListResponseSchema.parse(firstPage)).not.toThrow();

    expect(firstPage.entries.map((entry) => [entry.fileName, entry.parseState]))
      .toEqual([
        ["cancelled.pdf", "failed"],
        ["removed.docx", "detached"],
        ["broken.txt", "failed"],
      ]);
    expect(firstPage.pagination).toEqual({
      total: 5,
      limit: 3,
      offset: 0,
      hasMore: true,
    });
    expect(firstPage.stats).toEqual({
      totalUploads: 2,
      uploadOnly: 1,
      failedParses: 2,
      successRate: 50,
      avgDuration: 250,
      lastUploadAt: uploadOnlyAt.toISOString(),
    });
    expect(secondPage.entries.map((entry) => entry.fileName))
      .toEqual(["manual.docx", "alex-resume.pdf"]);
    expect(secondPage.pagination.hasMore).toBe(false);
    expect(secondPage.entries[1]).toMatchObject({
      fileType: "pdf",
      fileSizeBytes: 2_048,
      parserVersion: "resume-normalizer-v2",
      parsedSummary: {
        skillCount: 1,
        experienceCount: 1,
        educationCount: 1,
      },
      warnings: [{ code: "malformed_date" }],
    });

    const storedDetail = await getResumeParseHistoryDetail(
      secondPage.entries[1]!.id,
      database
    );
    const failedDetail = await getResumeParseHistoryDetail("run:failed-run", database);

    expect(() => resumeHistoryDetailResponseSchema.parse(storedDetail)).not.toThrow();
    expect(storedDetail?.parsedData).toMatchObject({
      name: "Alex Rivera",
      summary: "Staff engineer",
      experience: [{ company: "Acme", title: "Staff Engineer" }],
    });
    expect(failedDetail).toMatchObject({
      entry: { id: "run:failed-run", parseState: "failed" },
      parsedData: null,
    });
    expect(await getResumeParseHistoryDetail("run:parsed-run", database)).toBeNull();
    expect(await getResumeParseHistoryDetail("invalid", database)).toBeNull();
  });
});
