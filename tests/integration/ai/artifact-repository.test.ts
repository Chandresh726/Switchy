import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import {
  buildCandidateEvidence,
  buildCandidateFingerprint,
  buildJobEvidenceInput,
  buildJobFingerprint,
} from "@/lib/ai/artifacts/fingerprints";
import {
  createArtifactRepository,
  isMatchResultFresh,
} from "@/lib/ai/artifacts/repository";
import { ensureJobFingerprintProjection } from "@/lib/ai/artifacts/job-fingerprint-projection";
import {
  aiRuns,
  companies,
  jobs,
  matchLogs,
  matchResults,
  matchSessions,
} from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-artifacts-");
const preLinkMatchLogs = sqliteTable("match_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id"),
  jobId: integer("job_id"),
  status: text("status").notNull(),
  score: real("score"),
});
const preProjectionJobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  url: text("url").notNull(),
  matchScore: real("match_score"),
  matchReasons: text("match_reasons"),
  matchedSkills: text("matched_skills"),
  missingSkills: text("missing_skills"),
  recommendations: text("recommendations"),
});

function createMigrationsFolderThrough(maxIndex: number): string {
  const source = join(process.cwd(), "drizzle");
  const destination = mkdtempSync(join(tmpdir(), "switchy-pre-artifacts-"));
  mkdirSync(join(destination, "meta"), { recursive: true });
  const journal = JSON.parse(
    readFileSync(join(source, "meta", "_journal.json"), "utf8")
  ) as { entries: Array<{ idx: number; tag: string }> };
  const entries = journal.entries.filter((entry) => entry.idx <= maxIndex);
  for (const entry of entries) {
    cpSync(join(source, `${entry.tag}.sql`), join(destination, `${entry.tag}.sql`));
  }
  writeFileSync(
    join(destination, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries })
  );
  return destination;
}

function createPreArtifactMigrationsFolder(): string {
  return createMigrationsFolderThrough(15);
}

function candidateEvidence() {
  return buildCandidateEvidence({
    profile: {
      id: 1,
      summary: "Backend engineer",
      preferredCountry: "India",
      preferredCity: "Bengaluru",
    },
    skills: [{ name: "TypeScript", category: "backend" }],
    experience: [{
      title: "Engineer",
      company: "Example",
      location: null,
      startDate: "2022-01",
      endDate: null,
      description: "Built services",
      highlights: null,
    }],
    education: [{
      institution: "University",
      degree: "B.Tech",
      field: "CS",
      startDate: null,
      endDate: null,
      gpa: null,
      honors: null,
    }],
  });
}

function jobEvidence() {
  return buildJobEvidenceInput({
    title: "Backend Engineer",
    description: "TypeScript services",
    location: "Remote",
    locationType: "remote",
    seniorityLevel: "mid",
    department: "Engineering",
    employmentType: "full-time",
    salary: null,
  });
}

function analysisEvidence() {
  return {
    mustHaveSkills: ["typescript"],
    preferredSkills: [],
    minimumExperienceYears: 2,
    seniorityLevel: "mid",
    managementTrack: false,
    educationRequirements: [],
    locationConstraints: ["remote"],
    employmentType: "full-time",
    compensationText: null,
    domainKeywords: ["services"],
    extractionConfidence: 0.9,
    ambiguities: [],
    requirements: [],
  };
}

function insertAIRun(
  database: ReturnType<typeof harness.createDatabase>["database"],
  capability: "job_analysis" | "match_adjudication" | "resume_parse",
  status: "succeeded" | "failed" = "succeeded"
): string {
  const id = crypto.randomUUID();
  database.insert(aiRuns).values({
    id,
    capability,
    providerRecordId: "11111111-1111-4111-8111-111111111111",
    provider: "openai",
    modelId: "gpt-test",
    promptVersion: "prompt-v1",
    schemaVersion: "schema-v1",
    policyVersion: "policy-v1",
    inputFingerprint: "a".repeat(64),
    status,
  }).run();
  return id;
}

function insertJob(database: ReturnType<typeof harness.createDatabase>["database"], matchScore?: number) {
  const company = database.insert(companies).values({
    name: "Example",
    careersUrl: "https://example.com/careers",
  }).returning().get();
  return database.insert(jobs).values({
    companyId: company.id,
    title: "Backend Engineer",
    description: "TypeScript services",
    url: `https://example.com/jobs/${crypto.randomUUID()}`,
    location: "Remote",
    locationType: "remote",
    seniorityLevel: "mid",
    employmentType: "full-time",
    matchScore,
    matchReasons: matchScore === undefined ? null : '["Strong skill fit"]',
    matchedSkills: matchScore === undefined ? null : '["TypeScript"]',
    missingSkills: matchScore === undefined ? null : "[]",
    recommendations: matchScore === undefined ? null : '["Apply"]',
  }).returning().get();
}

function insertPreProjectionJob(
  database: ReturnType<typeof harness.createDatabase>["database"],
  matchScore: number
) {
  const company = database.insert(companies).values({
    name: `Legacy ${crypto.randomUUID()}`,
    careersUrl: `https://legacy-${crypto.randomUUID()}.example.com/careers`,
  }).returning().get();
  return database.insert(preProjectionJobs).values({
    companyId: company.id,
    title: "Legacy Backend Engineer",
    description: "Legacy TypeScript services",
    url: `https://legacy.example.com/jobs/${crypto.randomUUID()}`,
    matchScore,
    matchReasons: '["Strong skill fit"]',
    matchedSkills: '["TypeScript"]',
    missingSkills: "[]",
    recommendations: '["Apply"]',
  }).returning().get();
}

describe("versioned AI artifact repository", () => {
  it("get-or-creates immutable candidate and job artifacts", async () => {
    const { database } = harness.createDatabase();
    const repository = createArtifactRepository(database);
    const candidate = candidateEvidence();
    const candidateFingerprint = buildCandidateFingerprint(candidate);
    const job = jobEvidence();
    const jobFingerprint = buildJobFingerprint(job);

    const firstCandidate = await repository.getOrCreateCandidateSnapshot({
      sourceProfileId: 1,
      snapshotVersion: "candidate-v1",
      evidence: candidate,
    });
    const secondCandidate = await repository.getOrCreateCandidateSnapshot({
      sourceProfileId: 1,
      snapshotVersion: "candidate-v1",
      evidence: {
        ...candidate,
        skills: [...candidate.skills].reverse().map((skill) => ({
          ...skill,
          name: ` ${skill.name.toUpperCase()} `,
        })),
        experience: [...candidate.experience].reverse(),
        education: [...candidate.education].reverse(),
      },
    });
    const firstAnalysis = await repository.getOrCreateJobAnalysis({
      jobEvidence: job,
      extractorVersion: "extractor-v1",
      evidence: analysisEvidence(),
    });
    const secondAnalysis = await repository.getOrCreateJobAnalysis({
      jobEvidence: {
        ...job,
        title: `  ${job.title}  `,
        locationType: job.locationType?.toUpperCase() ?? null,
      },
      extractorVersion: "extractor-v1",
      evidence: analysisEvidence(),
    });

    expect(secondCandidate.id).toBe(firstCandidate.id);
    expect(secondAnalysis.id).toBe(firstAnalysis.id);
    expect(firstCandidate.fingerprint).toBe(candidateFingerprint);
    expect(firstAnalysis.jobFingerprint).toBe(jobFingerprint);
    expect(firstCandidate.evidence).toEqual(candidate);
    expect(firstAnalysis.evidence).toEqual(analysisEvidence());
  });

  it("validates job-analysis and adjudication run provenance", async () => {
    const { database } = harness.createDatabase();
    const repository = createArtifactRepository(database);
    const wrongCapabilityRunId = insertAIRun(database, "resume_parse");
    const failedAnalysisRunId = insertAIRun(database, "job_analysis", "failed");

    await expect(repository.getOrCreateJobAnalysis({
      jobEvidence: jobEvidence(),
      extractorVersion: "extractor-v1",
      evidence: analysisEvidence(),
      aiRunId: wrongCapabilityRunId,
    })).rejects.toThrow("successful job_analysis");
    await expect(repository.getOrCreateJobAnalysis({
      jobEvidence: jobEvidence(),
      extractorVersion: "extractor-v1",
      evidence: analysisEvidence(),
      aiRunId: failedAnalysisRunId,
    })).rejects.toThrow("successful job_analysis");

    const persistedJob = insertJob(database);
    const candidateArtifact = await repository.getOrCreateCandidateSnapshot({
      snapshotVersion: "candidate-v1",
      evidence: candidateEvidence(),
    });
    const jobArtifact = await repository.getOrCreateJobAnalysis({
      jobEvidence: jobEvidence(),
      extractorVersion: "extractor-v1",
      evidence: analysisEvidence(),
    });
    const wrongAdjudicationRunId = insertAIRun(database, "job_analysis");
    await expect(repository.createMatchResult({
      jobId: persistedJob.id,
      candidateSnapshotId: candidateArtifact.id,
      jobAnalysisId: jobArtifact.id,
      candidateFingerprint: candidateArtifact.fingerprint,
      jobFingerprint: jobArtifact.jobFingerprint,
      scoringPolicyVersion: "scoring-v1",
      score: 80,
      breakdown: { experience: 80 },
      evidence: { reasons: [] },
      confidence: 0.8,
      source: "adjudicated",
      adjudicationRunId: wrongAdjudicationRunId,
    })).rejects.toThrow("successful match_adjudication");
  });

  it("uses exact fingerprints and policy versions for freshness", async () => {
    const { database } = harness.createDatabase();
    const repository = createArtifactRepository(database);
    const persistedJob = insertJob(database);
    const candidate = candidateEvidence();
    const candidateFingerprint = buildCandidateFingerprint(candidate);
    const jobFingerprint = buildJobFingerprint(jobEvidence());
    const candidateArtifact = await repository.getOrCreateCandidateSnapshot({
      sourceProfileId: 1,
      snapshotVersion: "candidate-v1",
      evidence: candidate,
    });
    const jobArtifact = await repository.getOrCreateJobAnalysis({
      jobEvidence: jobEvidence(),
      extractorVersion: "extractor-v1",
      evidence: analysisEvidence(),
    });
    const created = await repository.createMatchResult({
      jobId: persistedJob.id,
      candidateSnapshotId: candidateArtifact.id,
      jobAnalysisId: jobArtifact.id,
      candidateFingerprint,
      jobFingerprint,
      scoringPolicyVersion: "scoring-v1",
      score: 82,
      breakdown: { mustHaveSkills: 90, experience: 75 },
      evidence: { reasons: ["Good fit"] },
      confidence: 0.85,
      source: "deterministic",
    });

    expect(isMatchResultFresh(created, {
      candidateFingerprint,
      jobFingerprint,
      scoringPolicyVersion: "scoring-v1",
    })).toBe(true);
    expect(await repository.findFreshMatch(persistedJob.id, {
      candidateFingerprint,
      jobFingerprint,
      scoringPolicyVersion: "scoring-v1",
    })).toMatchObject({ id: created.id, score: 82 });
    expect(await repository.findFreshMatch(persistedJob.id, {
      candidateFingerprint: "b".repeat(64),
      jobFingerprint,
      scoringPolicyVersion: "scoring-v1",
    })).toBeNull();
    expect(await repository.findFreshMatch(persistedJob.id, {
      candidateFingerprint,
      jobFingerprint,
      scoringPolicyVersion: "scoring-v2",
    })).toBeNull();
  });

  it("rejects match results whose artifact references do not match their fingerprints", async () => {
    const { database } = harness.createDatabase();
    const repository = createArtifactRepository(database);
    const persistedJob = insertJob(database);
    const candidate = candidateEvidence();
    const candidateArtifact = await repository.getOrCreateCandidateSnapshot({
      snapshotVersion: "candidate-v1",
      evidence: candidate,
    });
    const jobArtifact = await repository.getOrCreateJobAnalysis({
      jobEvidence: jobEvidence(),
      extractorVersion: "extractor-v1",
      evidence: analysisEvidence(),
    });

    await expect(repository.createMatchResult({
      jobId: persistedJob.id,
      candidateSnapshotId: candidateArtifact.id,
      jobAnalysisId: jobArtifact.id,
      candidateFingerprint: "b".repeat(64),
      jobFingerprint: jobArtifact.jobFingerprint,
      scoringPolicyVersion: "scoring-v1",
      score: 80,
      breakdown: { experience: 80 },
      evidence: { reasons: [] },
      confidence: 0.8,
      source: "deterministic",
    })).rejects.toThrow("Candidate snapshot does not match");
    expect(database.select().from(matchResults).all()).toEqual([]);
  });

  it("does not persist a match result when cancellation is already requested", async () => {
    const { database } = harness.createDatabase();
    const repository = createArtifactRepository(database);
    const persistedJob = insertJob(database);
    const candidateArtifact = await repository.getOrCreateCandidateSnapshot({
      snapshotVersion: "candidate-v1",
      evidence: candidateEvidence(),
    });
    const jobArtifact = await repository.getOrCreateJobAnalysis({
      jobEvidence: jobEvidence(),
      extractorVersion: "extractor-v1",
      evidence: analysisEvidence(),
    });
    const controller = new AbortController();
    controller.abort();

    await expect(repository.createMatchResult({
      jobId: persistedJob.id,
      candidateSnapshotId: candidateArtifact.id,
      jobAnalysisId: jobArtifact.id,
      candidateFingerprint: candidateArtifact.fingerprint,
      jobFingerprint: jobArtifact.jobFingerprint,
      scoringPolicyVersion: "scoring-v1",
      score: 80,
      breakdown: { experience: 80 },
      evidence: { reasons: [] },
      confidence: 0.8,
      source: "deterministic",
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(database.select().from(matchResults).all()).toEqual([]);
  });

  it("forces legacy results to remain stale at the repository boundary", async () => {
    const { database } = harness.createDatabase();
    const repository = createArtifactRepository(database);
    const persistedJob = insertJob(database);
    const created = await repository.createMatchResult({
      jobId: persistedJob.id,
      candidateFingerprint: "a".repeat(64),
      jobFingerprint: "b".repeat(64),
      scoringPolicyVersion: "legacy-import-v1",
      score: 70,
      breakdown: { legacy: 70 },
      evidence: { reasons: [] },
      confidence: 0,
      source: "legacy",
      isStale: false,
    });

    expect(created.isStale).toBe(true);
    expect(await repository.findFreshMatch(persistedJob.id, {
      candidateFingerprint: "a".repeat(64),
      jobFingerprint: "b".repeat(64),
      scoringPolicyVersion: "legacy-import-v1",
    })).toBeNull();
  });

  it("imports legacy job columns once as explicitly stale history", async () => {
    const { database } = harness.createDatabase();
    const repository = createArtifactRepository(database);
    const persistedJob = insertJob(database, 77);

    expect(await repository.importLegacyMatchResults()).toBe(1);
    expect(await repository.importLegacyMatchResults()).toBe(0);

    const imported = database.select().from(matchResults)
      .where(eq(matchResults.jobId, persistedJob.id)).all();
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      score: 77,
      source: "legacy",
      isStale: true,
      confidence: 0,
      scoringPolicyVersion: "legacy-import-v1",
    });
    expect(JSON.parse(imported[0].evidenceJson)).toMatchObject({
      reasons: ["Strong skill fit"],
      matchedSkills: ["TypeScript"],
      recommendations: ["Apply"],
    });
    expect(database.select().from(jobs).where(eq(jobs.id, persistedJob.id)).get())
      .toMatchObject({ matchScore: 77, matchReasons: '["Strong skill fit"]' });
  });

  it("does not import a second legacy result after matched job content changes", async () => {
    const { database } = harness.createDatabase();
    const repository = createArtifactRepository(database);
    const persistedJob = insertJob(database, 77);

    expect(await repository.importLegacyMatchResults()).toBe(1);
    database.update(jobs).set({ description: "Changed legacy description" })
      .where(eq(jobs.id, persistedJob.id)).run();
    const laterJob = insertJob(database, 68);
    expect(await repository.importLegacyMatchResults()).toBe(1);
    expect(database.select().from(matchResults)
      .where(eq(matchResults.jobId, persistedJob.id)).all()).toHaveLength(1);
    expect(database.select().from(matchResults)
      .where(eq(matchResults.jobId, laterJob.id)).all()).toHaveLength(1);
  });

  it("imports legacy results in batches below SQLite's variable limit", async () => {
    const { database } = harness.createDatabase();
    const repository = createArtifactRepository(database);
    const company = database.insert(companies).values({
      name: "Scale fixture",
      careersUrl: "https://scale.example.com/careers",
    }).returning().get();
    const total = 3_100;
    const rows = Array.from({ length: total }, (_, index) => ({
      companyId: company.id,
      title: `Backend Engineer ${index}`,
      description: "TypeScript services",
      url: `https://scale.example.com/jobs/${index}`,
      matchScore: 75,
    }));
    for (let offset = 0; offset < rows.length; offset += 400) {
      database.insert(jobs).values(rows.slice(offset, offset + 400)).run();
    }

    expect(await repository.importLegacyMatchResults()).toBe(total);
    expect(database.select().from(matchResults).all()).toHaveLength(total);
  });

  it("upgrades a populated pre-artifact database and preserves legacy matches", async () => {
    const { database } = harness.createDatabase({ migrate: false });
    const legacyMigrations = createPreArtifactMigrationsFolder();
    try {
      migrate(database, { migrationsFolder: legacyMigrations });
      const persistedJob = insertPreProjectionJob(database, 91);

      migrate(database, { migrationsFolder: join(process.cwd(), "drizzle") });
      const repository = createArtifactRepository(database);
      expect(await repository.importLegacyMatchResults()).toBe(1);

      expect(database.select().from(matchResults)
        .where(eq(matchResults.jobId, persistedJob.id)).get()).toMatchObject({
        score: 91,
        source: "legacy",
        isStale: true,
      });
      expect(database.select().from(jobs).where(eq(jobs.id, persistedJob.id)).get())
        .toMatchObject({ matchScore: 91 });
    } finally {
      rmSync(legacyMigrations, { recursive: true, force: true });
    }
  });

  it("upgrades existing match logs and supports exact immutable result links", () => {
    const { database } = harness.createDatabase({ migrate: false });
    const previousMigrations = createMigrationsFolderThrough(16);
    try {
      migrate(database, { migrationsFolder: previousMigrations });
      const persistedJob = insertPreProjectionJob(database, 82);
      database.insert(matchSessions).values({
        id: "pre-link-session",
        triggerSource: "manual",
        status: "completed",
      }).run();
      database.insert(preLinkMatchLogs).values({
        sessionId: "pre-link-session",
        jobId: persistedJob.id,
        status: "success",
        score: 82,
      }).run();

      migrate(database, { migrationsFolder: join(process.cwd(), "drizzle") });
      expect(database.select().from(matchLogs).get()).toMatchObject({
        score: 82,
        matchResultId: null,
      });
      expect(database.select().from(jobs)
        .where(eq(jobs.id, persistedJob.id)).get()?.aiFingerprint).toBeNull();
      expect(ensureJobFingerprintProjection(database)).toMatchObject({ updated: 1 });
      expect(database.select().from(jobs)
        .where(eq(jobs.id, persistedJob.id)).get()?.aiFingerprint)
        .toMatch(/^[a-f0-9]{64}$/);

      database.insert(matchResults).values({
        id: "linked-result",
        jobId: persistedJob.id,
        candidateFingerprint: "a".repeat(64),
        jobFingerprint: "b".repeat(64),
        scoringPolicyVersion: "evidence-score-v1-link-test",
        score: 90,
        breakdownJson: JSON.stringify({ mustHaveSkills: 100 }),
        evidenceJson: JSON.stringify({
          reasons: ["Exact result"],
          matchedSkills: [],
          missingSkills: [],
          recommendations: [],
          componentEvidence: {},
        }),
        confidence: 0.9,
        source: "deterministic",
      }).run();
      database.insert(matchLogs).values({
        sessionId: "pre-link-session",
        jobId: persistedJob.id,
        status: "success",
        score: 90,
        matchResultId: "linked-result",
      }).run();

      expect(database.select().from(matchLogs)
        .where(eq(matchLogs.matchResultId, "linked-result")).get())
        .toMatchObject({ score: 90, matchResultId: "linked-result" });
    } finally {
      rmSync(previousMigrations, { recursive: true, force: true });
    }
  });

  it("validates JSON columns when reading artifacts", async () => {
    const { database } = harness.createDatabase();
    const repository = createArtifactRepository(database);
    const persistedJob = insertJob(database);
    const candidate = candidateEvidence();
    const candidateFingerprint = buildCandidateFingerprint(candidate);
    const jobFingerprint = buildJobFingerprint(jobEvidence());
    const candidateArtifact = await repository.getOrCreateCandidateSnapshot({
      snapshotVersion: "candidate-v1",
      evidence: candidate,
    });
    const jobArtifact = await repository.getOrCreateJobAnalysis({
      jobEvidence: jobEvidence(),
      extractorVersion: "extractor-v1",
      evidence: analysisEvidence(),
    });
    const created = await repository.createMatchResult({
      jobId: persistedJob.id,
      candidateSnapshotId: candidateArtifact.id,
      jobAnalysisId: jobArtifact.id,
      candidateFingerprint,
      jobFingerprint,
      scoringPolicyVersion: "scoring-v1",
      score: 80,
      breakdown: { experience: 80 },
      evidence: { reasons: [] },
      confidence: 0.8,
      source: "deterministic",
    });
    database.update(matchResults).set({ evidenceJson: "not-json" })
      .where(eq(matchResults.id, created.id)).run();

    await expect(repository.findFreshMatch(persistedJob.id, {
      candidateFingerprint,
      jobFingerprint,
      scoringPolicyVersion: "scoring-v1",
    })).rejects.toThrow();
  });
});
