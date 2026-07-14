import { randomUUID } from "node:crypto";

import { and, eq, isNotNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { z } from "zod";

import type * as databaseSchema from "@/lib/db/schema";
import {
  aiRuns,
  candidateSnapshots,
  jobAnalyses,
  jobs,
  matchResults,
} from "@/lib/db/schema";
import { fingerprintAIInput } from "@/lib/ai/runtime/fingerprint";

import {
  buildCandidateFingerprint,
  buildJobEvidenceInput,
  buildJobFingerprint,
  canonicalizeCandidateEvidence,
  canonicalizeJobEvidenceInput,
} from "./fingerprints";
import {
  ArtifactFingerprintSchema,
  ArtifactVersionSchema,
  CandidateEvidenceSchema,
  JobAnalysisEvidenceSchema,
  MatchBreakdownSchema,
  MatchEvidenceSchema,
  MatchSourceSchema,
  type CandidateEvidence,
  type JobAnalysisEvidence,
  type JobEvidenceInput,
  type MatchBreakdown,
} from "./schemas";

type ArtifactDatabase = BetterSQLite3Database<typeof databaseSchema>;

const LEGACY_CANDIDATE_FINGERPRINT = fingerprintAIInput({ source: "legacy-match-columns" });
const LegacyStringArraySchema = z.array(z.string()).max(10_000);
const LEGACY_IMPORT_BATCH_SIZE = 500;

function parseJson<T>(value: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(value));
}

function parseLegacyStringArray(value: string | null, maxChars: number): string[] {
  if (!value) return [];
  try {
    return LegacyStringArraySchema.parse(JSON.parse(value))
      .slice(0, 500)
      .map((item) => item.slice(0, maxChars));
  } catch {
    return [];
  }
}

function buildLegacyJobFingerprint(job: typeof jobs.$inferSelect): string {
  try {
    return buildJobFingerprint(buildJobEvidenceInput(job));
  } catch {
    return fingerprintAIInput({
      legacyJobId: job.id,
      title: job.title,
      description: job.description,
      location: job.location,
      locationType: job.locationType,
      seniorityLevel: job.seniorityLevel,
      department: job.department,
      employmentType: job.employmentType,
      salary: job.salary,
    });
  }
}

export interface CreateCandidateSnapshotInput {
  sourceProfileId?: number;
  snapshotVersion: string;
  evidence: CandidateEvidence;
}

export interface CreateJobAnalysisInput {
  jobEvidence: JobEvidenceInput;
  extractorVersion: string;
  evidence: JobAnalysisEvidence;
  aiRunId?: string;
}

export interface CreateMatchResultInput {
  jobId: number;
  candidateSnapshotId?: string;
  jobAnalysisId?: string;
  candidateFingerprint: string;
  jobFingerprint: string;
  scoringPolicyVersion: string;
  score: number;
  breakdown: MatchBreakdown;
  evidence: z.input<typeof MatchEvidenceSchema>;
  confidence: number;
  source: "legacy" | "deterministic" | "adjudicated";
  adjudicationRunId?: string;
  isStale?: boolean;
}

export interface MatchFreshnessInput {
  candidateFingerprint: string;
  jobFingerprint: string;
  scoringPolicyVersion: string;
}

export function isMatchResultFresh(
  result: {
    candidateFingerprint: string;
    jobFingerprint: string;
    scoringPolicyVersion: string;
    isStale: boolean;
  },
  current: MatchFreshnessInput
): boolean {
  return !result.isStale &&
    result.candidateFingerprint === current.candidateFingerprint &&
    result.jobFingerprint === current.jobFingerprint &&
    result.scoringPolicyVersion === current.scoringPolicyVersion;
}

export function createArtifactRepository(database: ArtifactDatabase) {
  async function requireSuccessfulRun(
    runId: string,
    capability: "job_analysis" | "match_adjudication"
  ): Promise<void> {
    const runs = await database.select({
      capability: aiRuns.capability,
      status: aiRuns.status,
    }).from(aiRuns).where(eq(aiRuns.id, runId)).limit(1);
    if (runs[0]?.status !== "succeeded" || runs[0]?.capability !== capability) {
      throw new Error(`AI run must be a successful ${capability} execution`);
    }
  }

  return {
    async getOrCreateCandidateSnapshot(input: CreateCandidateSnapshotInput) {
      const snapshotVersion = ArtifactVersionSchema.parse(input.snapshotVersion);
      const evidence = canonicalizeCandidateEvidence(input.evidence);
      const fingerprint = buildCandidateFingerprint(evidence);

      await database.insert(candidateSnapshots).values({
        id: randomUUID(),
        sourceProfileId: input.sourceProfileId,
        fingerprint,
        snapshotVersion,
        evidenceJson: JSON.stringify(evidence),
      }).onConflictDoNothing();

      const rows = await database.select().from(candidateSnapshots).where(and(
        eq(candidateSnapshots.fingerprint, fingerprint),
        eq(candidateSnapshots.snapshotVersion, snapshotVersion)
      )).limit(1);
      const row = rows[0];
      if (!row) throw new Error("Failed to create candidate snapshot");
      return { ...row, evidence: parseJson(row.evidenceJson, CandidateEvidenceSchema) };
    },

    async getOrCreateJobAnalysis(input: CreateJobAnalysisInput) {
      const jobEvidence = canonicalizeJobEvidenceInput(input.jobEvidence);
      const jobFingerprint = buildJobFingerprint(jobEvidence);
      const extractorVersion = ArtifactVersionSchema.parse(input.extractorVersion);
      const evidence = JobAnalysisEvidenceSchema.parse(input.evidence);
      if (input.aiRunId) {
        await requireSuccessfulRun(input.aiRunId, "job_analysis");
      }

      await database.insert(jobAnalyses).values({
        id: randomUUID(),
        jobFingerprint,
        extractorVersion,
        evidenceJson: JSON.stringify(evidence),
        aiRunId: input.aiRunId,
      }).onConflictDoNothing();

      const rows = await database.select().from(jobAnalyses).where(and(
        eq(jobAnalyses.jobFingerprint, jobFingerprint),
        eq(jobAnalyses.extractorVersion, extractorVersion)
      )).limit(1);
      const row = rows[0];
      if (!row) throw new Error("Failed to create job analysis");
      return { ...row, evidence: parseJson(row.evidenceJson, JobAnalysisEvidenceSchema) };
    },

    async createMatchResult(input: CreateMatchResultInput) {
      const candidateFingerprint = ArtifactFingerprintSchema.parse(input.candidateFingerprint);
      const jobFingerprint = ArtifactFingerprintSchema.parse(input.jobFingerprint);
      const scoringPolicyVersion = ArtifactVersionSchema.parse(input.scoringPolicyVersion);
      const score = z.number().min(0).max(100).parse(input.score);
      const confidence = z.number().min(0).max(1).parse(input.confidence);
      const source = MatchSourceSchema.parse(input.source);
      const breakdown = MatchBreakdownSchema.parse(input.breakdown);
      const evidence = MatchEvidenceSchema.parse(input.evidence);
      if (source !== "legacy" && (!input.candidateSnapshotId || !input.jobAnalysisId)) {
        throw new Error("Versioned match results require candidate and job artifacts");
      }
      if (source === "legacy" && (
        input.candidateSnapshotId || input.jobAnalysisId || input.adjudicationRunId
      )) {
        throw new Error("Legacy results cannot reference versioned AI artifacts");
      }
      if (source === "deterministic" && input.adjudicationRunId) {
        throw new Error("Deterministic results cannot reference an adjudication run");
      }
      if (source === "adjudicated" && !input.adjudicationRunId) {
        throw new Error("Adjudicated results require an adjudication run");
      }
      if (source === "adjudicated") {
        await requireSuccessfulRun(input.adjudicationRunId!, "match_adjudication");
      }
      if (source !== "legacy") {
        const [candidateArtifact, jobArtifact] = await Promise.all([
          database.select({ fingerprint: candidateSnapshots.fingerprint })
            .from(candidateSnapshots)
            .where(eq(candidateSnapshots.id, input.candidateSnapshotId!))
            .limit(1),
          database.select({ fingerprint: jobAnalyses.jobFingerprint })
            .from(jobAnalyses)
            .where(eq(jobAnalyses.id, input.jobAnalysisId!))
            .limit(1),
        ]);
        if (candidateArtifact[0]?.fingerprint !== candidateFingerprint) {
          throw new Error("Candidate snapshot does not match the result fingerprint");
        }
        if (jobArtifact[0]?.fingerprint !== jobFingerprint) {
          throw new Error("Job analysis does not match the result fingerprint");
        }
      }

      await database.insert(matchResults).values({
        id: randomUUID(),
        jobId: input.jobId,
        candidateSnapshotId: input.candidateSnapshotId,
        jobAnalysisId: input.jobAnalysisId,
        candidateFingerprint,
        jobFingerprint,
        scoringPolicyVersion,
        score,
        breakdownJson: JSON.stringify(breakdown),
        evidenceJson: JSON.stringify(evidence),
        confidence,
        source,
        adjudicationRunId: input.adjudicationRunId,
        isStale: source === "legacy" ? true : (input.isStale ?? false),
      }).onConflictDoNothing();

      const rows = await database.select().from(matchResults).where(and(
        eq(matchResults.jobId, input.jobId),
        eq(matchResults.candidateFingerprint, candidateFingerprint),
        eq(matchResults.jobFingerprint, jobFingerprint),
        eq(matchResults.scoringPolicyVersion, scoringPolicyVersion)
      )).limit(1);
      const row = rows[0];
      if (!row) throw new Error("Failed to create match result");
      return {
        ...row,
        breakdown: parseJson(row.breakdownJson, MatchBreakdownSchema),
        evidence: parseJson(row.evidenceJson, MatchEvidenceSchema),
      };
    },

    async findFreshMatch(jobId: number, current: MatchFreshnessInput) {
      const candidateFingerprint = ArtifactFingerprintSchema.parse(current.candidateFingerprint);
      const jobFingerprint = ArtifactFingerprintSchema.parse(current.jobFingerprint);
      const scoringPolicyVersion = ArtifactVersionSchema.parse(current.scoringPolicyVersion);
      const rows = await database.select().from(matchResults).where(and(
        eq(matchResults.jobId, jobId),
        eq(matchResults.candidateFingerprint, candidateFingerprint),
        eq(matchResults.jobFingerprint, jobFingerprint),
        eq(matchResults.scoringPolicyVersion, scoringPolicyVersion),
        eq(matchResults.isStale, false)
      )).limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        ...row,
        breakdown: parseJson(row.breakdownJson, MatchBreakdownSchema),
        evidence: parseJson(row.evidenceJson, MatchEvidenceSchema),
      };
    },

    async importLegacyMatchResults(): Promise<number> {
      return database.transaction((tx) => {
        const legacyJobs = tx.select().from(jobs).where(isNotNull(jobs.matchScore)).all();
        if (legacyJobs.length === 0) return 0;
        const importedJobIds = new Set(
          tx.select({ jobId: matchResults.jobId }).from(matchResults)
            .where(eq(matchResults.source, "legacy")).all()
            .map((row) => row.jobId)
        );
        const pendingJobs = legacyJobs.filter((job) => !importedJobIds.has(job.id));
        let insertedCount = 0;

        for (let offset = 0; offset < pendingJobs.length; offset += LEGACY_IMPORT_BATCH_SIZE) {
          const batch = pendingJobs.slice(offset, offset + LEGACY_IMPORT_BATCH_SIZE);
          const inserted = tx.insert(matchResults).values(batch.map((job) => {
            const rawScore = job.matchScore ?? 0;
            const score = Number.isFinite(rawScore)
              ? Math.min(100, Math.max(0, rawScore))
              : 0;
            return {
              id: randomUUID(),
              jobId: job.id,
              candidateFingerprint: LEGACY_CANDIDATE_FINGERPRINT,
              jobFingerprint: buildLegacyJobFingerprint(job),
              scoringPolicyVersion: "legacy-import-v1",
              score,
              breakdownJson: JSON.stringify(MatchBreakdownSchema.parse({ legacy: score })),
              evidenceJson: JSON.stringify(MatchEvidenceSchema.parse({
                reasons: parseLegacyStringArray(job.matchReasons, 2_000),
                matchedSkills: parseLegacyStringArray(job.matchedSkills, 200),
                missingSkills: parseLegacyStringArray(job.missingSkills, 200),
                recommendations: parseLegacyStringArray(job.recommendations, 2_000),
                componentEvidence: {},
              })),
              confidence: 0,
              source: "legacy",
              isStale: true,
            };
          })).onConflictDoNothing().run();
          insertedCount += inserted.changes;
        }

        return insertedCount;
      }, { behavior: "immediate" });
    },
  };
}
