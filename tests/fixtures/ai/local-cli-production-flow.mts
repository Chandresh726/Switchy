import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";

import * as schema from "../../../lib/db/schema";

const fixtures = path.join(process.cwd(), "tests", "fixtures", "ai");
const codexExecutable = path.join(fixtures, "fake-codex-cli.mjs");
const stateDirectory = path.join(
  os.homedir(),
  ".switchy",
  "data",
  "production"
);
mkdirSync(stateDirectory, { recursive: true });

const migrationConnection = new Database(path.join(stateDirectory, "switchy.db"));
const migrationDatabase = drizzle(migrationConnection, { schema });
migrate(migrationDatabase, { migrationsFolder: path.join(process.cwd(), "drizzle") });
migrationConnection.close();

const { db } = await import("../../../lib/db/index");
const { saveStoredLocalCLICatalog } = await import("../../../lib/ai/local-cli/catalog-cache");
const { resetLocalCLIProvider } = await import("../../../lib/ai/local-cli/service");
const {
  createProvider,
  getProviderById,
} = await import("../../../lib/ai/providers/provider-service");
const { enqueueMatchWork } = await import("../../../lib/ai/work-items/repository");
const { AIWorkDispatcher } = await import("../../../lib/ai/work-items/dispatcher");
const { parseResumeWithProvenance } = await import("../../../lib/ai/resume-parser");
const { POST: streamWriting } = await import("../../../app/api/ai/content/stream/route");

const codexProvider = await getProviderById("builtin:codex-cli") ??
  await createProvider({ provider: "codex_cli" });
assert(codexProvider, "Codex provider was not initialized");

const settingValues: Record<string, string> = {
  codex_cli_executable: codexExecutable,
  matcher_provider_id: codexProvider.id,
  matcher_model: "gpt-visible",
  matcher_reasoning_effort: "medium",
  matcher_batch_size: "1",
  matcher_max_retries: "1",
  matcher_concurrency_limit: "1",
  matcher_timeout_ms: "5000",
  ai_writing_provider_id: codexProvider.id,
  ai_writing_model: "gpt-visible",
  ai_writing_reasoning_effort: "medium",
  cover_letter_length: "short",
  resume_parser_provider_id: codexProvider.id,
  resume_parser_model: "gpt-visible",
  resume_parser_reasoning_effort: "medium",
};
for (const [key, value] of Object.entries(settingValues)) {
  await db.insert(schema.settings).values({ key, value }).onConflictDoUpdate({
    target: schema.settings.key,
    set: { value, updatedAt: new Date() },
  });
}
await saveStoredLocalCLICatalog("codex_cli", [{
  modelId: "gpt-visible",
  label: "Visible GPT",
  description: "Synthetic text model",
  supportsReasoning: true,
  reasoningControl: {
    kind: "effort",
    options: ["low", "medium", "high"].map((value) => ({ value })),
    defaultValue: "medium",
  },
  supportedReasoningEfforts: ["low", "medium", "high"],
  defaultReasoningEffort: "medium",
  isDefault: true,
}]);

const candidate = await db.insert(schema.profile).values({
  name: "Alex Candidate",
  email: "alex@example.invalid",
  location: "Bengaluru, India",
  preferredCountry: "India",
  preferredCity: "Bengaluru",
  summary: "Product-minded software engineer building reliable TypeScript applications.",
}).returning({ id: schema.profile.id });
const profileId = candidate[0]!.id;
await db.insert(schema.skills).values({ profileId, name: "TypeScript", category: "frontend" });
await db.insert(schema.experience).values({
  profileId,
  company: "Synthetic Systems",
  title: "Software Engineer",
  location: "Bengaluru, India",
  startDate: "2022-01",
  endDate: "2025-01",
  description: "Built tested TypeScript applications and production APIs.",
  highlights: JSON.stringify(["Delivered reliable product features"]),
});

const company = await db.insert(schema.companies).values({
  name: "Synthetic Corp",
  careersUrl: "https://example.invalid/careers",
}).returning({ id: schema.companies.id });
const job = await db.insert(schema.jobs).values({
  companyId: company[0]!.id,
  externalId: "production-flow-role",
  title: "TypeScript Software Engineer",
  url: "https://example.invalid/jobs/production-flow-role",
  description: "Build reliable web applications with TypeScript. Two years of software engineering experience preferred.",
  location: "Bengaluru, India",
  locationType: "hybrid",
  employmentType: "full-time",
  seniorityLevel: "mid",
  status: "new",
}).returning({ id: schema.jobs.id });
const jobId = job[0]!.id;

const matchSessionId = "local-cli-production-flow";
enqueueMatchWork(db, {
  id: matchSessionId,
  jobIds: [jobId],
  triggerSource: "manual",
});
const dispatcher = new AIWorkDispatcher(db, undefined, { concurrency: 1 });
await dispatcher.runAvailable();
const matchSession = await db.select().from(schema.matchSessions)
  .where(eq(schema.matchSessions.id, matchSessionId)).limit(1);
const persistedMatches = await db.select().from(schema.matchResults)
  .where(eq(schema.matchResults.jobId, jobId));
assert.equal(matchSession[0]?.status, "completed");
assert.equal(matchSession[0]?.jobsSucceeded, 1);
assert.equal(persistedMatches.length, 1);

function writingRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/ai/content/stream", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-switchy-request": "true",
    },
    body: JSON.stringify(body),
  });
}

const writingResponse = await streamWriting(writingRequest({
  jobId,
  type: "cover_letter",
}));
assert.equal(writingResponse.status, 200);
const writingEvents = await writingResponse.text();
assert.match(writingEvents, /event: delta/);
assert.match(writingEvents, /event: complete/);
const writingHistory = await db.select().from(schema.aiGenerationHistory);
assert.equal(writingHistory.length, 1);
assert.ok(writingHistory[0]?.aiRunId);

const cancelledResponse = await streamWriting(writingRequest({
  jobId,
  type: "cover_letter",
  parentVariantId: writingHistory[0]!.id,
  userPrompt: "Please make this slow while retaining the evidence.",
}));
const cancelledReader = cancelledResponse.body!.getReader();
for (let attempt = 0; attempt < 100; attempt += 1) {
  const running = await db.select().from(schema.aiRuns).where(and(
    eq(schema.aiRuns.capability, "writing_cover_letter"),
    eq(schema.aiRuns.status, "running")
  ));
  if (running.length > 0) break;
  await new Promise((resolve) => setTimeout(resolve, 10));
}
await cancelledReader.cancel();
for (let attempt = 0; attempt < 100; attempt += 1) {
  const cancelled = await db.select().from(schema.aiRuns).where(and(
    eq(schema.aiRuns.capability, "writing_cover_letter"),
    eq(schema.aiRuns.status, "cancelled")
  ));
  if (cancelled.length > 0) break;
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.equal((await db.select().from(schema.aiGenerationHistory)).length, 1);
assert.equal((await db.select().from(schema.aiRuns).where(and(
  eq(schema.aiRuns.capability, "writing_cover_letter"),
  eq(schema.aiRuns.status, "cancelled")
))).length, 1);

const resume = await parseResumeWithProvenance(
  "Alex Candidate\nSoftware Engineer\nTypeScript\nSynthetic Systems, 2022-01 to 2025-01"
);
assert.equal(resume.parsedData.name, "Alex Candidate");
assert.equal(resume.parserVersion.length > 0, true);
const resumeRun = await db.select().from(schema.aiRuns)
  .where(eq(schema.aiRuns.id, resume.aiRunId)).limit(1);
assert.equal(resumeRun[0]?.status, "succeeded");
assert.equal(resumeRun[0]?.capability, "resume_parse");

const runs = await db.select().from(schema.aiRuns);
assert.ok(runs.some((run) =>
  run.capability === "job_analysis" && run.status === "succeeded"
));
assert.ok(runs.every((run) => run.provider === "codex_cli"));
assert.ok(runs.every((run) => !JSON.stringify(run).includes("Synthetic Systems")));

await resetLocalCLIProvider("codex_cli");
process.stdout.write(`SWITCHY_E2E_RESULT=${JSON.stringify({
  matchResults: persistedMatches.length,
  writingVariants: writingHistory.length,
  cancelledWritingRuns: runs.filter((run) => run.status === "cancelled").length,
  resumeRunId: resume.aiRunId,
})}\n`);
