import {
  artifactRepository,
  buildCandidateEvidence,
  type MatchEvidence,
} from "@/lib/ai/artifacts";
import { createAICapabilityRuntime } from "@/lib/ai/runtime";

import { categorizeError, throwIfAborted } from "../resilience";
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
} from "../types";
import type { StrategyProgressCallback } from "../strategies";
import {
  adjudicateMatch,
  buildScoringPolicyVersion,
  shouldAdjudicate,
} from "../evidence/adjudication";
import { buildScoringCandidate, enrichCandidateEvidence } from "../evidence/candidate";
import { analyzeJobsForMatching } from "../evidence/job-analysis";
import { scoreDeterministically } from "../evidence/scoring";

const CANDIDATE_SNAPSHOT_VERSION = "candidate-evidence-v1";

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
}): Promise<void> {
  if (!input.sessionId) return;
  await logMatchFailure(
    input.sessionId,
    input.jobId,
    input.duration,
    categorizeError(input.error),
    input.error.message,
    (input.error as Error & { attemptCount?: number }).attemptCount ?? 1,
    input.modelUsed
  );
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
    return new Map(jobIds.map((jobId) => [jobId, new Error("No profile found")]));
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
    });
  } catch (error) {
    console.warn("[EvidenceMatcher] Model policy unavailable; using retryable deterministic results.", error);
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
  let adjudicationRuntime: Awaited<ReturnType<typeof createAICapabilityRuntime>> | null = null;
  let adjudicationUnavailable = !modelPolicyResolved;

  for (const jobId of jobIds) {
    throwIfAborted(signal);
    if (shouldStop && await shouldStop()) break;
    const startedAt = performance.now();
    const analyzed = analyses.get(jobId);

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
        continue;
      }

      const deterministic = scoreDeterministically(
        candidate,
        analyzed.jobEvidence,
        analyzed.analysis
      );
      let score = deterministic.score;
      let source: "deterministic" | "adjudicated" = "deterministic";
      let adjudicationRunId: string | undefined;
      let attempts = 0;
      const evidence: MatchEvidence = structuredClone(deterministic.evidence);
      const adjudicationRequired = shouldAdjudicate(
        config.qualityPreset,
        deterministic
      );

      if (adjudicationRequired && !adjudicationUnavailable) {
        if (!adjudicationRuntime) {
          try {
            adjudicationRuntime = await createAICapabilityRuntime({
              capability: "match_adjudication",
              resolved: {
                snapshot: modelRuntime!.snapshot,
                reasoningEffort: modelRuntime!.reasoningEffort,
              },
            });
          } catch (error) {
            adjudicationUnavailable = true;
            console.warn("[EvidenceMatcher] Adjudication unavailable; using deterministic score.", error);
          }
        }
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
            score = adjudicated.score;
            source = "adjudicated";
            adjudicationRunId = adjudicated.runId;
            attempts = adjudicated.attempts;
            evidence.reasons.push(`Adjudication: ${adjudicated.rationale}`);
            evidence.componentEvidence.adjudication = adjudicated.evidenceReferences;
          } catch (error) {
            throwIfAborted(signal);
            console.warn(`[EvidenceMatcher] Adjudication failed for job ${jobId}; using deterministic score.`, error);
          }
        }
      }

      const resultPolicyVersion = !modelPolicyResolved
        ? `${scoringPolicyVersion}-model-resolution-pending`
        : adjudicationRequired && source !== "adjudicated"
          ? `${scoringPolicyVersion}-adjudication-pending`
          : scoringPolicyVersion;
      if (!modelPolicyResolved) {
        evidence.reasons.push(
          "Deterministic fallback shown; concrete model resolution will be retried"
        );
      } else if (resultPolicyVersion !== scoringPolicyVersion) {
        evidence.reasons.push(
          "Deterministic fallback shown; configured adjudication will be retried"
        );
      }

      const persisted = await artifactRepository.createMatchResult({
        jobId,
        candidateSnapshotId: candidateArtifact.id,
        jobAnalysisId: analyzed.jobAnalysisId,
        candidateFingerprint: candidateArtifact.fingerprint,
        jobFingerprint: analyzed.jobFingerprint,
        scoringPolicyVersion: resultPolicyVersion,
        score,
        breakdown: deterministic.breakdown,
        evidence,
        confidence: deterministic.confidence,
        source,
        adjudicationRunId,
      });
      const publicResult = toPublicMatchResult(persisted.score, persisted.evidence);
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
  }

  return results;
}
