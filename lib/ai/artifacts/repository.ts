import { randomUUID } from "node:crypto";

import { and, eq, ne } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { z } from "zod";

import type * as databaseSchema from "@/lib/db/schema";
import {
  aiRuns,
  candidateSnapshots,
  jobAnalyses,
  matchResults,
} from "@/lib/db/schema";
import {
  buildCandidateFingerprint,
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

function parseJson<T>(value: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(value));
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
  confidence?: number | null;
  source: "legacy" | "deterministic" | "adjudicated" | "ai";
  adjudicationRunId?: string;
  matchRunId?: string;
  matchPolicyVersion?: string;
  isStale?: boolean;
  signal?: AbortSignal;
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
    capability: "job_analysis" | "match_adjudication" | "match_evaluation"
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

    async findJobAnalysis(jobFingerprintInput: string, extractorVersionInput: string) {
      const jobFingerprint = ArtifactFingerprintSchema.parse(jobFingerprintInput);
      const extractorVersion = ArtifactVersionSchema.parse(extractorVersionInput);
      const rows = await database.select().from(jobAnalyses).where(and(
        eq(jobAnalyses.jobFingerprint, jobFingerprint),
        eq(jobAnalyses.extractorVersion, extractorVersion)
      )).limit(1);
      const row = rows[0];
      if (!row) return null;
      return { ...row, evidence: parseJson(row.evidenceJson, JobAnalysisEvidenceSchema) };
    },

    async createMatchResult(input: CreateMatchResultInput) {
      input.signal?.throwIfAborted();
      const candidateFingerprint = ArtifactFingerprintSchema.parse(input.candidateFingerprint);
      const jobFingerprint = ArtifactFingerprintSchema.parse(input.jobFingerprint);
      const scoringPolicyVersion = ArtifactVersionSchema.parse(input.scoringPolicyVersion);
      const score = z.number().min(0).max(100).parse(input.score);
      const confidence = input.confidence == null
        ? 0
        : z.number().min(0).max(1).parse(input.confidence);
      const source = MatchSourceSchema.parse(input.source);
      const breakdown = MatchBreakdownSchema.parse(input.breakdown);
      const evidence = MatchEvidenceSchema.parse(input.evidence);
      if (source !== "legacy" && (!input.candidateSnapshotId || !input.jobAnalysisId)) {
        throw new Error("Versioned match results require candidate and job artifacts");
      }
      if (source === "legacy" && (
        input.candidateSnapshotId || input.jobAnalysisId || input.adjudicationRunId || input.matchRunId
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
        input.signal?.throwIfAborted();
      }
      if (source === "ai" && !input.matchRunId) {
        throw new Error("AI match results require a match evaluation run");
      }
      if (source !== "ai" && input.matchRunId) {
        throw new Error("Only AI match results may reference a match evaluation run");
      }
      if (source === "ai") {
        await requireSuccessfulRun(input.matchRunId!, "match_evaluation");
        input.signal?.throwIfAborted();
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

      input.signal?.throwIfAborted();
      await database.insert(matchResults).values({
        id: randomUUID(),
        jobId: input.jobId,
        candidateSnapshotId: input.candidateSnapshotId,
        jobAnalysisId: input.jobAnalysisId,
        candidateFingerprint,
        jobFingerprint,
        scoringPolicyVersion,
        matchPolicyVersion: input.matchPolicyVersion ?? (source === "ai" ? scoringPolicyVersion : null),
        score,
        breakdownJson: JSON.stringify(breakdown),
        evidenceJson: JSON.stringify(evidence),
        confidence,
        source,
        adjudicationRunId: input.adjudicationRunId,
        matchRunId: input.matchRunId,
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
      const resultIsStale = source === "legacy" ? true : (input.isStale ?? false);
      if (!resultIsStale) {
        await database.update(matchResults).set({ isStale: true }).where(and(
          eq(matchResults.jobId, input.jobId),
          eq(matchResults.candidateFingerprint, candidateFingerprint),
          ne(matchResults.id, row.id),
          eq(matchResults.isStale, false)
        ));
      }
      if (row.isStale !== resultIsStale) {
        await database.update(matchResults).set({ isStale: resultIsStale })
          .where(eq(matchResults.id, row.id));
      }
      return {
        ...row,
        isStale: resultIsStale,
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
  };
}
