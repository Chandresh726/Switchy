import PQueue from "p-queue";

import {
  artifactRepository,
  buildCandidateEvidence,
  type MatchEvidence,
} from "@/lib/ai/artifacts";
import { recordAICacheHit } from "@/lib/ai/observability";
import {
  createAICapabilityRuntime,
  getAIExecutionErrorContext,
} from "@/lib/ai/runtime";
import { AIError } from "@/lib/ai/shared/errors";

import {
  buildMatchPolicyVersion,
  buildPersistedMatchArtifacts,
  evaluateMatchWithAI,
} from "../evidence/ai-match";
import { enrichCandidateEvidence } from "../evidence/candidate";
import {
  analyzeJobsForMatching,
  buildJobAnalysisVersion,
  type MatchingJobAnalysis,
} from "../evidence/job-analysis";
import {
  fetchJobsData,
  logMatchFailure,
  markJobAnalysisReady,
  markJobAnalysisStarted,
  markJobMatchStarted,
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

const CANDIDATE_SNAPSHOT_VERSION = "candidate-facts-v2";

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

export interface ExecuteMatchOptions {
  config: MatcherConfig;
  jobIds: number[];
  sessionId?: string;
  onProgress?: StrategyProgressCallback;
  shouldStop?: () => Promise<boolean>;
  signal?: AbortSignal;
}

function toPublicMatchResult(score: number, evidence: MatchEvidence): MatchResult {
  return {
    score,
    reasons: evidence.reasoning.map((point) => point.text),
    matchedSkills: evidence.matchedSkills,
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
  matchRunId?: string | null;
  cached?: boolean;
}): Promise<void> {
  if (!input.sessionId) return;
  await persistMatchSuccess(
    input.sessionId,
    input.jobId,
    input.matchResultId,
    input.result,
    input.attemptCount,
    input.duration,
    input.modelUsed,
    { matchRunId: input.matchRunId, cached: input.cached }
  );
}

async function persistFailure(input: {
  jobId: number;
  error: Error;
  sessionId?: string;
  duration: number;
  modelUsed: string;
  attemptCount?: number;
  stage?: "analysis" | "matching";
}): Promise<void> {
  if (!input.sessionId) return;
  const execution = getAIExecutionErrorContext(input.error);
  await logMatchFailure(
    input.sessionId,
    input.jobId,
    input.duration,
    input.error,
    input.attemptCount
      ?? execution.attemptCount
      ?? 1,
    input.modelUsed,
    undefined,
    input.stage,
    execution.aiRunId
  );
}

export async function executeMatch(options: ExecuteMatchOptions): Promise<MatchResultMap> {
  const { config, jobIds, sessionId, onProgress, shouldStop, signal } = options;
  throwIfAborted(signal);
  if (jobIds.length === 0) return new Map();

  const [jobsMap, profileData] = await Promise.all([
    fetchJobsData(jobIds),
    fetchProfileDataForMatch(),
  ]);
  throwIfAborted(signal);

  if (!profileData) {
    const error = new AIError({
      type: "missing_profile",
      message: "Create a candidate profile before matching jobs.",
      retryable: false,
    });
    const results: MatchResultMap = new Map();
    let completed = 0;
    for (const jobId of jobIds) {
      results.set(jobId, error);
      await persistFailure({
        jobId,
        error,
        sessionId,
        duration: 0,
        modelUsed: "not_started",
        attemptCount: 0,
        stage: "analysis",
      });
      completed += 1;
      onProgress?.(completed, jobIds.length, 0, completed);
    }
    return results;
  }

  const candidateEvidence = enrichCandidateEvidence(buildCandidateEvidence(profileData));
  const candidateArtifact = await artifactRepository.getOrCreateCandidateSnapshot({
    sourceProfileId: profileData.profile.id,
    snapshotVersion: CANDIDATE_SNAPSHOT_VERSION,
    evidence: candidateEvidence,
  });
  const availableJobs = jobIds
    .map((jobId) => jobsMap.get(jobId))
    .filter((job): job is JobData => job !== undefined);
  if (shouldStop && await shouldStop()) return new Map();

  const results: MatchResultMap = new Map();
  let analysisRuntime: Awaited<ReturnType<typeof createAICapabilityRuntime>>;
  let matchRuntime: Awaited<ReturnType<typeof createAICapabilityRuntime>>;
  try {
    [analysisRuntime, matchRuntime] = await Promise.all([
      createAICapabilityRuntime({
        capability: "job_analysis",
        model: {
          providerId: config.jobAnalysisProviderId,
          modelId: config.jobAnalysisModel,
          reasoningEffort: config.jobAnalysisReasoningEffort,
        },
        providerConcurrencyLimit: config.concurrencyLimit,
      }),
      createAICapabilityRuntime({
        capability: "match_evaluation",
        model: {
          providerId: config.providerId,
          modelId: config.model,
          reasoningEffort: config.reasoningEffort,
        },
        providerConcurrencyLimit: config.concurrencyLimit,
      }),
    ]);
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    const execution = getAIExecutionErrorContext(normalized);
    const stage = execution.aiCapability === "match_evaluation" ? "matching" : "analysis";
    const modelUsed = (stage === "matching" ? config.model : config.jobAnalysisModel)
      ?? "unresolved";
    let completed = 0;
    for (const job of availableJobs) {
      results.set(job.id, normalized);
      await persistFailure({
        jobId: job.id,
        error: normalized,
        sessionId,
        duration: 0,
        modelUsed,
        stage,
      });
      completed += 1;
      onProgress?.(completed, availableJobs.length, 0, completed);
    }
    return results;
  }
  const concreteConfig: MatcherConfig = {
    ...config,
    jobAnalysisProviderId: analysisRuntime.snapshot.providerRecordId,
    jobAnalysisModel: analysisRuntime.snapshot.modelId,
    jobAnalysisReasoningEffort: analysisRuntime.reasoningEffort,
    providerId: matchRuntime.snapshot.providerRecordId,
    model: matchRuntime.snapshot.modelId,
    reasoningEffort: matchRuntime.reasoningEffort,
  };

  const analysisVersion = buildJobAnalysisVersion(concreteConfig);
  const matchPolicyVersion = buildMatchPolicyVersion(concreteConfig, analysisVersion);
  let completed = 0;
  let succeeded = 0;
  let failed = 0;
  const terminalJobIds = new Set<number>();
  const scheduledJobIds = new Set<number>();
  const matchTasks: Array<Promise<void | undefined>> = [];
  const matchQueue = new PQueue({ concurrency: Math.max(1, config.concurrencyLimit) });

  const reportTerminal = (jobId: number, status: "succeeded" | "failed") => {
    if (terminalJobIds.has(jobId)) return;
    terminalJobIds.add(jobId);
    completed += 1;
    if (status === "succeeded") succeeded += 1;
    else failed += 1;
    onProgress?.(completed, jobIds.length, succeeded, failed);
  };

  const failAnalysis = async (jobId: number, cause?: unknown) => {
    if (terminalJobIds.has(jobId) || scheduledJobIds.has(jobId)) return;
    const error = cause instanceof Error
      ? cause
      : new AIError({
        type: "generation_failed",
        message: `AI job analysis failed for job ${jobId}`,
        retryable: true,
        cause: cause === undefined ? undefined : new Error(String(cause)),
      });
    results.set(jobId, error);
    await persistFailure({
      jobId,
      error,
      sessionId,
      duration: 0,
      modelUsed: analysisRuntime.snapshot.modelId,
      stage: "analysis",
    });
    reportTerminal(jobId, "failed");
  };

  const matchAnalyzedJob = async (analyzed: MatchingJobAnalysis) => {
    const jobId = analyzed.job.id;
    throwIfAborted(signal);
    if (shouldStop && await shouldStop()) return;
    const startedAt = performance.now();
    if (sessionId) await markJobMatchStarted(sessionId, jobId);

    try {
      const cached = await artifactRepository.findFreshMatch(jobId, {
        candidateFingerprint: candidateArtifact.fingerprint,
        jobFingerprint: analyzed.jobFingerprint,
        scoringPolicyVersion: matchPolicyVersion,
      });
      if (cached) {
        const publicResult = toPublicMatchResult(cached.score, cached.evidence);
        if (!sessionId) {
          await recordAICacheHit({
            capability: "match_evaluation",
            subject: { type: "job", id: String(jobId) },
            artifact: { type: "match_result", id: cached.id },
            sourceRunId: cached.matchRunId,
          });
        }
        await persistPublicResult({
          jobId,
          matchResultId: cached.id,
          result: publicResult,
          sessionId,
          attemptCount: 0,
          duration: Math.round(performance.now() - startedAt),
          modelUsed: "cache",
          matchRunId: cached.matchRunId,
          cached: true,
        });
        results.set(jobId, publicResult);
        reportTerminal(jobId, "succeeded");
        return;
      }

      const evaluation = await evaluateMatchWithAI(
        matchRuntime,
        candidateArtifact.evidence,
        candidateArtifact.fingerprint,
        analyzed,
        concreteConfig,
        signal
      );
      const persistedArtifacts = buildPersistedMatchArtifacts(evaluation.outcome);
      throwIfAborted(signal);
      const persisted = await artifactRepository.createMatchResult({
        jobId,
        candidateSnapshotId: candidateArtifact.id,
        jobAnalysisId: analyzed.jobAnalysisId,
        candidateFingerprint: candidateArtifact.fingerprint,
        jobFingerprint: analyzed.jobFingerprint,
        scoringPolicyVersion: matchPolicyVersion,
        matchPolicyVersion,
        score: evaluation.outcome.score,
        breakdown: persistedArtifacts.breakdown,
        evidence: persistedArtifacts.evidence,
        source: "ai",
        matchRunId: evaluation.runId,
        signal,
      });
      const publicResult = toPublicMatchResult(persisted.score, persisted.evidence);
      await persistPublicResult({
        jobId,
        matchResultId: persisted.id,
        result: publicResult,
        sessionId,
        attemptCount: evaluation.attempts,
        duration: Math.round(performance.now() - startedAt),
        modelUsed: matchRuntime.snapshot.modelId,
        matchRunId: evaluation.runId,
      });
      results.set(jobId, publicResult);
      reportTerminal(jobId, "succeeded");
    } catch (error) {
      throwIfAborted(signal);
      const normalized = error instanceof Error ? error : new Error(String(error));
      results.set(jobId, normalized);
      await persistFailure({
        jobId,
        error: normalized,
        sessionId,
        duration: Math.round(performance.now() - startedAt),
        modelUsed: matchRuntime.snapshot.modelId,
        stage: "matching",
      });
      reportTerminal(jobId, "failed");
    }
  };

  const scheduleMatch = (analyzed: MatchingJobAnalysis) => {
    const jobId = analyzed.job.id;
    if (scheduledJobIds.has(jobId) || terminalJobIds.has(jobId)) return;
    scheduledJobIds.add(jobId);
    matchTasks.push(matchQueue.add(() => matchAnalyzedJob(analyzed)));
  };

  const sameProvider = analysisRuntime.snapshot.providerRecordId ===
    matchRuntime.snapshot.providerRecordId;
  const analysisConcurrency = sameProvider
    ? Math.max(1, Math.floor(config.concurrencyLimit * 0.6))
    : Math.max(1, config.concurrencyLimit);

  let analyses: Map<number, MatchingJobAnalysis>;
  try {
    analyses = await analyzeJobsForMatching(
      availableJobs,
      concreteConfig,
      signal,
      shouldStop,
      analysisRuntime,
      {
        concurrencyLimit: analysisConcurrency,
        onStarted: async (startedJobIds) => {
          if (sessionId) await markJobAnalysisStarted(sessionId, startedJobIds);
        },
        onReady: async (analyzed, source) => {
          if (sessionId) {
            await markJobAnalysisReady(sessionId, {
              jobId: analyzed.job.id,
              jobAnalysisId: analyzed.jobAnalysisId,
              analysisRunId: analyzed.analysisRunId,
              cached: source === "cached",
            });
          } else if (source === "cached") {
            await recordAICacheHit({
              capability: "job_analysis",
              subject: { type: "job", id: String(analyzed.job.id) },
              artifact: { type: "job_analysis", id: analyzed.jobAnalysisId },
              sourceRunId: analyzed.analysisRunId,
            });
          }
          scheduleMatch(analyzed);
        },
        onFailed: async (failedJobIds, error) => {
          for (const jobId of failedJobIds) await failAnalysis(jobId, error);
        },
      }
    );
  } catch (error) {
    await Promise.allSettled(matchTasks);
    throw error;
  }

  for (const analyzed of analyses.values()) scheduleMatch(analyzed);

  for (const jobId of jobIds) {
    if (!analyses.has(jobId) && !terminalJobIds.has(jobId) && !scheduledJobIds.has(jobId)) {
      await failAnalysis(jobId);
    }
  }
  const settledMatches = await Promise.allSettled(matchTasks);
  const failedMatch = settledMatches.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (failedMatch) throw failedMatch.reason;

  return results;
}
