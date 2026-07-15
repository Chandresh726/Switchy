import PQueue from "p-queue";

import {
  artifactRepository,
  buildCandidateEvidence,
  type MatchEvidence,
} from "@/lib/ai/artifacts";
import { createAICapabilityRuntime } from "@/lib/ai/runtime";
import { AIError, sanitizeAIError } from "@/lib/ai/shared/errors";

import {
  fetchJobsData,
  fetchMatchingPreferences,
  logMatchFailure,
  persistMatchSuccess,
} from "../tracking";
import type {
  JobData,
  MatcherConfig,
  MatchResult,
  MatchResultMap,
  ProfileData,
  StrategyProgressCallback,
} from "../types";
import {
  adjudicateMatch,
  buildScoringPolicyVersion,
  shouldAdjudicate,
} from "../evidence/adjudication";
import {
  buildScoringCandidate,
  enrichCandidateEvidence,
} from "../evidence/candidate";
import { analyzeJobsForMatching } from "../evidence/job-analysis";
import { scoreDeterministically } from "../evidence/scoring";

const CANDIDATE_SNAPSHOT_VERSION = "candidate-evidence-v2";

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

export interface ExecuteMatchOptions {
  config: MatcherConfig & { providerId?: string };
  jobIds: number[];
  sessionId?: string;
  onProgress?: StrategyProgressCallback;
  shouldStop?: () => Promise<boolean>;
  signal?: AbortSignal;
}

function toPublicMatchResult(score: number, evidence: MatchEvidence): MatchResult {
  return {
    score,
    reasons: evidence.reasons,
    matchedSkills: evidence.matchedSkills,
    missingSkills: evidence.missingSkills,
    recommendations: evidence.recommendations,
  };
}

async function fetchProfileDataForMatch(): Promise<ProfileData | null> {
  const { fetchProfileData } = await import("../tracking");
  return fetchProfileData();
}

async function persistPublicResult(input: {
  jobId: number;
  matchResultId: string;
  result: MatchResult;
  sessionId?: string;
  attemptCount: number;
  duration: number;
  modelUsed: string;
}): Promise<void> {
  if (input.sessionId) {
    await persistMatchSuccess(
      input.sessionId,
      input.jobId,
      input.matchResultId,
      input.result,
      input.attemptCount,
      input.duration,
      input.modelUsed
    );
  }
}

async function persistFailure(input: {
  jobId: number;
  error: Error;
  sessionId?: string;
  duration: number;
  modelUsed: string;
  attemptCount?: number;
}): Promise<void> {
  if (!input.sessionId) return;
  await logMatchFailure(
    input.sessionId,
    input.jobId,
    input.duration,
    input.error,
    input.attemptCount
      ?? (input.error as Error & { attemptCount?: number }).attemptCount
      ?? 1,
    input.modelUsed
  );
}

function warnWithSanitizedError(message: string, error: unknown): void {
  const sanitized = sanitizeAIError(error);
  console.warn(`${message} [${sanitized.code}] ${sanitized.message}`);
}

export async function executeMatch(options: ExecuteMatchOptions): Promise<MatchResultMap> {
  const { config, jobIds, sessionId, onProgress, shouldStop, signal } = options;
  throwIfAborted(signal);
  if (jobIds.length === 0) return new Map();

  const [jobsMap, profileData, preferences] = await Promise.all([
    fetchJobsData(jobIds),
    fetchProfileDataForMatch(),
    fetchMatchingPreferences(),
  ]);
  throwIfAborted(signal);

  if (!profileData) {
    const missingProfileError = new AIError({
      type: "missing_profile",
      message: "Create a candidate profile before matching jobs.",
      retryable: false,
    });
    const missingProfileResults: MatchResultMap = new Map();
    let completed = 0;
    for (const jobId of jobIds) {
      throwIfAborted(signal);
      missingProfileResults.set(jobId, missingProfileError);
      await persistFailure({
        jobId,
        error: missingProfileError,
        sessionId,
        duration: 0,
        modelUsed: "deterministic",
        attemptCount: 0,
      });
      completed += 1;
      onProgress?.(completed, jobIds.length, 0, completed);
    }
    return missingProfileResults;
  }

  const candidateEvidence = enrichCandidateEvidence(buildCandidateEvidence({
    ...profileData,
    preferences,
  }));
  const candidateArtifact = await artifactRepository.getOrCreateCandidateSnapshot({
    sourceProfileId: profileData.profile.id,
    snapshotVersion: CANDIDATE_SNAPSHOT_VERSION,
    evidence: candidateEvidence,
  });
  const candidate = buildScoringCandidate(candidateArtifact.evidence);
  const availableJobs = jobIds
    .map((jobId) => jobsMap.get(jobId))
    .filter((job): job is JobData => job !== undefined);
  if (shouldStop && await shouldStop()) return new Map();
  let modelRuntime: Awaited<ReturnType<typeof createAICapabilityRuntime>> | null = null;
  try {
    modelRuntime = await createAICapabilityRuntime({
      capability: "job_analysis",
      model: {
        providerId: config.providerId,
        modelId: config.model,
        reasoningEffort: config.reasoningEffort,
      },
      providerConcurrencyLimit: config.concurrencyLimit,
    });
  } catch (error) {
    if (error instanceof AIError && !error.retryable) {
      throw error;
    }
    warnWithSanitizedError(
      "[EvidenceMatcher] Model policy unavailable; using retryable deterministic results.",
      error
    );
  }
  const concreteConfig = modelRuntime
    ? {
        ...config,
        providerId: modelRuntime.snapshot.providerRecordId,
        model: modelRuntime.snapshot.modelId,
        reasoningEffort: modelRuntime.reasoningEffort,
      }
    : config;
  const analyses = await analyzeJobsForMatching(
    availableJobs,
    concreteConfig,
    signal,
    shouldStop,
    modelRuntime
  );
  const scoringPolicyVersion = buildScoringPolicyVersion(concreteConfig);
  const modelPolicyResolved = modelRuntime !== null;
  const results: MatchResultMap = new Map();
  let completed = 0;
  let succeeded = 0;
  let failed = 0;
  type CapabilityRuntime = Awaited<ReturnType<typeof createAICapabilityRuntime>>;
  let adjudicationRuntimePromise: Promise<CapabilityRuntime | null> | null = null;
  let adjudicationUnavailable = !modelPolicyResolved;

  const resolveAdjudicationRuntime = (): Promise<CapabilityRuntime | null> => {
    if (adjudicationUnavailable) return Promise.resolve(null);
    adjudicationRuntimePromise ??= createAICapabilityRuntime({
      capability: "match_adjudication",
      resolved: {
        snapshot: modelRuntime!.snapshot,
        backend: modelRuntime!.backend,
        reasoningEffort: modelRuntime!.reasoningEffort,
      },
      providerConcurrencyLimit: config.concurrencyLimit,
    }).catch((error) => {
      adjudicationUnavailable = true;
      warnWithSanitizedError(
        "[EvidenceMatcher] Adjudication unavailable; using deterministic score.",
        error
      );
      return null;
    });
    return adjudicationRuntimePromise;
  };
  const matchQueue = new PQueue({ concurrency: Math.max(1, config.concurrencyLimit) });

  await Promise.all(jobIds.map((jobId) => matchQueue.add(async () => {
    throwIfAborted(signal);
    if (shouldStop && await shouldStop()) return;
    const startedAt = performance.now();
    const analyzed = analyses.get(jobId);
    let adjudicationRuntime: CapabilityRuntime | null = null;

    try {
      if (!analyzed) throw new Error(`Job with ID ${jobId} not found`);

      const cached = modelPolicyResolved
        ? await artifactRepository.findFreshMatch(jobId, {
            candidateFingerprint: candidateArtifact.fingerprint,
            jobFingerprint: analyzed.jobFingerprint,
            scoringPolicyVersion,
          })
        : null;
      if (cached) {
        const publicResult = toPublicMatchResult(cached.score, cached.evidence);
        throwIfAborted(signal);
        await persistPublicResult({
          jobId,
          matchResultId: cached.id,
          result: publicResult,
          sessionId,
          attemptCount: 0,
          duration: Math.round(performance.now() - startedAt),
          modelUsed: "cache",
        });
        results.set(jobId, publicResult);
        succeeded++;
        return;
      }

      const deterministic = scoreDeterministically(
        candidate,
        analyzed.jobEvidence,
        analyzed.analysis
      );
      let scored = deterministic;
      let source: "deterministic" | "adjudicated" = "deterministic";
      let adjudicationRunId: string | undefined;
      let attempts = 0;
      const adjudicationRequired = shouldAdjudicate(
        deterministic
      );

      if (adjudicationRequired && !adjudicationUnavailable) {
        adjudicationRuntime = await resolveAdjudicationRuntime();
        if (adjudicationRuntime) {
          try {
            const adjudicated = await adjudicateMatch(
              adjudicationRuntime,
              candidate,
              analyzed,
              deterministic,
              concreteConfig,
              signal
            );
            scored = scoreDeterministically(
              candidate,
              analyzed.jobEvidence,
              analyzed.analysis,
              adjudicated.assessments,
              adjudicated.summary
            );
            source = "adjudicated";
            adjudicationRunId = adjudicated.runId;
            attempts = adjudicated.attempts;
          } catch (error) {
            throwIfAborted(signal);
            warnWithSanitizedError(
              `[EvidenceMatcher] Adjudication failed for job ${jobId}; using deterministic score.`,
              error
            );
          }
        }
      }

      const resultPolicyVersion = !modelPolicyResolved
        ? `${scoringPolicyVersion}-model-resolution-pending`
        : analyzed.analysisSource === "fallback"
          ? `${scoringPolicyVersion}-analysis-pending`
        : adjudicationRequired && source !== "adjudicated"
          ? `${scoringPolicyVersion}-adjudication-pending`
          : scoringPolicyVersion;
      const evidence: MatchEvidence = structuredClone(scored.evidence);
      if (!modelPolicyResolved) {
        evidence.reasons.push(
          "Deterministic fallback shown; concrete model resolution will be retried"
        );
      } else if (analyzed.analysisSource === "fallback") {
        evidence.reasons.push(
          "Deterministic job analysis shown; structured extraction will be retried"
        );
      } else if (resultPolicyVersion !== scoringPolicyVersion) {
        evidence.reasons.push(
          "Deterministic fallback shown; configured adjudication will be retried"
        );
      }

      throwIfAborted(signal);
      const persisted = await artifactRepository.createMatchResult({
        jobId,
        candidateSnapshotId: candidateArtifact.id,
        jobAnalysisId: analyzed.jobAnalysisId,
        candidateFingerprint: candidateArtifact.fingerprint,
        jobFingerprint: analyzed.jobFingerprint,
        scoringPolicyVersion: resultPolicyVersion,
        score: scored.score,
        breakdown: scored.breakdown,
        evidence,
        confidence: scored.confidence,
        source,
        adjudicationRunId,
        signal,
      });
      const publicResult = toPublicMatchResult(persisted.score, persisted.evidence);
      throwIfAborted(signal);
      await persistPublicResult({
        jobId,
        matchResultId: persisted.id,
        result: publicResult,
        sessionId,
        attemptCount: attempts,
        duration: Math.round(performance.now() - startedAt),
        modelUsed: adjudicationRuntime?.snapshot.modelId ?? "deterministic",
      });
      results.set(jobId, publicResult);
      succeeded++;
    } catch (error) {
      throwIfAborted(signal);
      const normalized = error instanceof Error ? error : new Error(String(error));
      results.set(jobId, normalized);
      failed++;
      await persistFailure({
        jobId,
        error: normalized,
        sessionId,
        duration: Math.round(performance.now() - startedAt),
        modelUsed: adjudicationRuntime?.snapshot.modelId ?? "deterministic",
      });
    } finally {
      completed++;
      onProgress?.(completed, jobIds.length, succeeded, failed);
    }
  })));

  return results;
}
