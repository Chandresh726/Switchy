import { chmodSync, readFileSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as openCodeSDK from "@opencode-ai/sdk/v2";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ai/runtime-context", () => ({
  resolveAIContextForCapability: vi.fn(),
}));
vi.mock("@/lib/ai/runtime/default-run-repository", () => ({
  aiRunRepository: {},
}));
vi.mock("@/lib/ai/matcher/execution/work-executor", () => ({ executeMatchWork: vi.fn() }));

import { CodexCLIBackend } from "@/lib/ai/local-cli/codex-backend";
import { OpenCodeCLIBackend } from "@/lib/ai/local-cli/opencode-backend";
import { createAICapabilityRuntime } from "@/lib/ai/runtime/capability-runtime";
import { createAIRunRepository } from "@/lib/ai/runtime/run-repository";
import type { AICapability } from "@/lib/ai/runtime/types";
import { AIWorkDispatcher } from "@/lib/ai/work-items/dispatcher";
import { enqueueMatchWork } from "@/lib/ai/work-items/repository";
import { persistWritingVariant } from "@/lib/ai/writing/repository";
import {
  aiGeneratedContent,
  aiGenerationHistory,
  aiRuns,
  companies,
  jobs,
  matchSessions,
} from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-cli-capabilities-");
const fixtures = path.join(process.cwd(), "tests", "fixtures", "ai");
const codexExecutable = path.join(fixtures, "fake-codex-cli.mjs");
const openCodeExecutable = path.join(fixtures, "fake-opencode-cli.mjs");
const PRIVATE_PROMPT = "PROMPT_PRIVATE_4f9f7f0e";

beforeAll(() => {
  chmodSync(codexExecutable, 0o755);
  chmodSync(openCodeExecutable, 0o755);
});

function versions(name: string) {
  return { prompt: `${name}-p1`, schema: `${name}-s1`, policy: `${name}-e1` };
}

describe("local CLI capability integration", () => {
  it("runs matching, writing, and resume work with durable sanitized provenance", async () => {
    const { database, path: databasePath } = harness.createDatabase();
    const runRepository = createAIRunRepository(database);
    const auditPath = `${databasePath}.argv-audit`;
    vi.stubEnv("SWITCHY_FAKE_CLI_AUDIT_PATH", auditPath);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const company = database.insert(companies).values({
      name: "Synthetic Corp",
      careersUrl: "https://example.invalid/jobs",
    }).returning({ id: companies.id }).get();
    const job = database.insert(jobs).values({
      companyId: company.id,
      externalId: "synthetic-role",
      title: "Synthetic Engineer",
      url: "https://example.invalid/jobs/1",
      description: "Synthetic job description",
      status: "new",
    }).returning({ id: jobs.id }).get();

    const codex = new CodexCLIBackend(codexExecutable);
    const runtimeFor = (capability: AICapability) => createAICapabilityRuntime({
      capability,
      runRepository,
      resolved: {
        snapshot: {
          providerRecordId: "builtin:codex-cli",
          provider: "codex_cli",
          modelId: "gpt-visible",
          backendKind: "codex_cli",
          cliVersion: "9.9.9",
        },
        backend: codex,
        reasoningEffort: "medium",
      },
    });

    enqueueMatchWork(database, {
      id: "cli-match-session",
      jobIds: [job.id],
      triggerSource: "manual",
    });
    const dispatcher = new AIWorkDispatcher(database, async (jobIds, options) => {
      options.onQueued?.(0);
      await options.onStart?.();
      const runtime = await runtimeFor("job_analysis");
      await runtime.executeStructured({
        instructions: "Normalize synthetic job evidence.",
        prompt: `${PRIVATE_PROMPT}: synthetic matching input`,
        schema: z.object({ value: z.string() }),
        policy: { maxAttempts: 1, timeoutMs: 2_000, reasoningEffort: "medium" },
        subject: { type: "job", id: String(job.id) },
        versions: versions("matching"),
        inputFingerprint: "1".repeat(64),
        metadata: { jobCount: 1 },
      });
      options.onProgress?.(1, 1, 1, 0);
      return new Map(jobIds.map((jobId) => [jobId, {
        score: 82,
        reasons: ["Synthetic evidence matched"],
        matchedSkills: ["TypeScript"],
        missingSkills: [],
        recommendations: [],
      }]));
    });
    await dispatcher.runAvailable();
    expect(database.select().from(matchSessions)
      .where(eq(matchSessions.id, "cli-match-session")).get()).toMatchObject({
      status: "completed",
      jobsSucceeded: 1,
    });

    const writingRuntime = await runtimeFor("writing_cover_letter");
    const deltas: string[] = [];
    const writing = await writingRuntime.executeStreamingText({
      instructions: "Write a synthetic cover letter.",
      prompt: `${PRIVATE_PROMPT}: synthetic writing input`,
      onDelta: async (delta) => { deltas.push(delta); },
      policy: { maxAttempts: 1, timeoutMs: 2_000, reasoningEffort: "medium" },
      subject: { type: "job", id: String(job.id) },
      versions: versions("writing"),
      inputFingerprint: "2".repeat(64),
      metadata: { streamed: true },
    });
    expect(deltas.join("")).toBe("streamed text");
    const persisted = persistWritingVariant(database, {
      jobId: job.id,
      type: "cover_letter",
      text: writing.output,
      settingsSnapshot: "{}",
      userPrompt: null,
      parentVariant: null,
      aiRunId: writing.runId,
      source: "generated",
    });
    expect(persisted.history[0]?.aiRunId).toBe(writing.runId);

    const contentCountBeforeAbort = database.select().from(aiGeneratedContent).all().length;
    const historyCountBeforeAbort = database.select().from(aiGenerationHistory).all().length;
    const abortController = new AbortController();
    const abortedWriting = writingRuntime.executeStreamingText({
      instructions: "Write a synthetic cover letter.",
      prompt: `${PRIVATE_PROMPT}: slow`,
      onDelta: () => undefined,
      signal: abortController.signal,
      policy: { maxAttempts: 1, timeoutMs: 2_000, reasoningEffort: "medium" },
      subject: { type: "job", id: String(job.id) },
      versions: versions("writing-abort"),
      inputFingerprint: "3".repeat(64),
      metadata: { streamed: true },
    });
    const abortReason = new DOMException("consumer cancelled", "AbortError");
    setTimeout(() => abortController.abort(abortReason), 20);
    await expect(abortedWriting).rejects.toBe(abortReason);
    expect(database.select().from(aiGeneratedContent).all()).toHaveLength(contentCountBeforeAbort);
    expect(database.select().from(aiGenerationHistory).all()).toHaveLength(historyCountBeforeAbort);

    const resumeRuntime = await runtimeFor("resume_parse");
    const resume = await resumeRuntime.executeStructured({
      instructions: "Normalize a synthetic resume.",
      prompt: `${PRIVATE_PROMPT}: synthetic resume input`,
      schema: z.object({ value: z.string() }),
      policy: { maxAttempts: 1, timeoutMs: 2_000, reasoningEffort: "medium" },
      subject: { type: "resume", id: "a".repeat(24) },
      versions: versions("resume"),
      inputFingerprint: "4".repeat(64),
    });
    expect(resume.output).toEqual({ value: "structured" });

    const openCode = new OpenCodeCLIBackend(openCodeExecutable, async () => openCodeSDK);
    const failingRuntime = await createAICapabilityRuntime({
      capability: "resume_parse",
      runRepository,
      resolved: {
        snapshot: {
          providerRecordId: "builtin:opencode-cli",
          provider: "opencode_cli",
          modelId: "openai/text",
          backendKind: "opencode_cli",
          cliVersion: "8.8.8",
          upstreamProvider: "openai",
        },
        backend: openCode,
        reasoningEffort: "medium",
      },
    });
    const failed = failingRuntime.executeText({
      instructions: "Do not expose synthetic credentials.",
      prompt: `${PRIVATE_PROMPT}: embedded-auth-error`,
      policy: { maxAttempts: 1, timeoutMs: 2_000, reasoningEffort: "medium" },
      subject: { type: "resume", id: "b".repeat(24) },
      versions: versions("safe-error"),
      inputFingerprint: "5".repeat(64),
    });
    await expect(failed).rejects.toMatchObject({
      type: "missing_api_key",
      message: "OpenCode authentication is unavailable for the configured model",
    });

    const runs = database.select().from(aiRuns).all();
    expect(runs.map((run) => run.capability)).toEqual(expect.arrayContaining([
      "job_analysis",
      "writing_cover_letter",
      "resume_parse",
    ]));
    expect(runs.some((run) => run.status === "cancelled")).toBe(true);
    expect(runs.some((run) => run.errorCode === "missing_api_key")).toBe(true);
    const persistedRuns = JSON.stringify(runs);
    expect(persistedRuns).not.toContain(PRIVATE_PROMPT);
    expect(persistedRuns).not.toContain("synthetic secret");
    expect(persistedRuns).not.toContain("synthetic job description");

    const argvAudit = readFileSync(auditPath, "utf8");
    expect(argvAudit).toContain('"cli":"codex"');
    expect(argvAudit).toContain('"cli":"opencode"');
    expect(argvAudit).not.toContain(PRIVATE_PROMPT);
    expect(argvAudit).not.toContain("OPENCODE_SERVER_PASSWORD");
    expect(argvAudit).not.toContain("synthetic secret");
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
