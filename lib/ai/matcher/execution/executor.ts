import { createAICapabilityRuntime } from "@/lib/ai/runtime";
import {
  categorizeError,
  createCircuitBreaker,
  throwIfAborted,
} from "../resilience";
import type {
  MatcherConfig,
  CandidateProfile,
  MatchJob,
  MatchResultMap,
  StrategyResultItem,
  StrategyResultMap,
} from "../types";
import { singleStrategy, bulkStrategy, parallelStrategy, selectStrategy, type StrategyProgressCallback } from "../strategies";
import {
  fetchJobsData,
  logMatchFailure,
  persistMatchSuccess,
  updateJobWithMatchResult,
} from "../tracking";
import {
  applyExperienceScoreGuardrails,
  calculateTotalExperienceYears,
  deriveCandidateExperienceYears,
  estimateRequiredExperienceYears,
  extractRequirements,
  htmlToText,
} from "../utils";

export interface ExecuteMatchOptions {
  config: MatcherConfig & { providerId?: string };
  jobIds: number[];
  sessionId?: string;
  onProgress?: StrategyProgressCallback;
  shouldStop?: () => Promise<boolean>;
  signal?: AbortSignal;
}

export async function executeMatch(options: ExecuteMatchOptions): Promise<MatchResultMap> {
  const { config, jobIds, sessionId, onProgress, shouldStop, signal } = options;

  throwIfAborted(signal);

  if (jobIds.length === 0) {
    return new Map();
  }

  const aiRuntime = await createAICapabilityRuntime({
    capability: "match_adjudication",
    model: {
      providerId: config.providerId,
      modelId: config.model,
      reasoningEffort: config.reasoningEffort,
    },
  });
  throwIfAborted(signal);
  const modelUsed = aiRuntime.snapshot.modelId;

  const circuitBreaker = createCircuitBreaker({
    failureThreshold: config.circuitBreakerThreshold,
    resetTimeout: config.circuitBreakerResetTimeout,
  });

  const jobsMap = await fetchJobsData(jobIds);
  const profileData = await fetchProfileDataForMatch();
  throwIfAborted(signal);

  if (!profileData) {
    const results: MatchResultMap = new Map();
    for (const jobId of jobIds) {
      const error = new Error("No profile found");
      results.set(jobId, error);
    }
    return results;
  }

  const candidateProfile: CandidateProfile = {
    summary: profileData.profile.summary || undefined,
    skills: profileData.skills.map((s: { name: string; category: string | null }) => ({
      name: s.name,
      category: s.category || undefined,
    })),
    experience: profileData.experience.map((e: { title: string; company: string; description: string | null; startDate: string; endDate: string | null }) => ({
      title: e.title,
      company: e.company,
      description: e.description || undefined,
      startDate: e.startDate,
      endDate: e.endDate || undefined,
    })),
    education: profileData.education.map((e: { institution: string; degree: string; field: string | null }) => ({
      institution: e.institution,
      degree: e.degree,
      field: e.field || undefined,
    })),
  };
  candidateProfile.totalExperienceYears = deriveCandidateExperienceYears(
    calculateTotalExperienceYears(candidateProfile.experience)
  ) ?? undefined;

  const matchJobs: MatchJob[] = jobIds
    .map((jobId) => {
      const job = jobsMap.get(jobId);
      if (!job) return null;
      const sourceDescription = job.description || "";
      return {
        id: job.id,
        title: job.title,
        description: sourceDescription,
        requirements: extractRequirements(htmlToText(sourceDescription)),
      };
    })
    .filter((j): j is MatchJob => j !== null);

  const missingIds = jobIds.filter((id) => !jobsMap.has(id));
  if (missingIds.length > 0) {
    console.warn(`[ExecuteMatch] Missing job IDs: ${missingIds.join(", ")}`);
  }

  if (matchJobs.length === 0) {
    const missingResults: StrategyResultMap = new Map(
      missingIds.map((id) => [
        id,
        {
          error: new Error(`Job with ID ${id} not found`),
          duration: 0,
        },
      ])
    );
    const results = await persistResults(
      missingResults,
      sessionId,
      modelUsed,
      new Set<number>(),
      signal
    );
    return results;
  }

  const strategyType = selectStrategy(config, matchJobs.length);

  console.log(
    `[ExecuteMatch] Using ${strategyType} strategy for ${matchJobs.length} jobs (bulkEnabled=${config.bulkEnabled})`
  );

  const strategyContext = {
    config,
    runtime: aiRuntime,
    circuitBreaker,
    candidateProfile,
    signal,
  };

  const persistedJobIds = new Set<number>();
  const jobsById = new Map<number, MatchJob>(matchJobs.map((job) => [job.id, job]));

  const persistRealtimeResult = async (jobId: number, item: StrategyResultItem) => {
    throwIfAborted(signal);
    if (persistedJobIds.has(jobId)) return;

    try {
      const finalizedItem = applyExperienceGuardrail(
        jobId,
        item,
        jobsById,
        candidateProfile.totalExperienceYears ?? null
      );
      await persistJobResult(jobId, finalizedItem, sessionId, modelUsed);
      throwIfAborted(signal);
      persistedJobIds.add(jobId);
    } catch (error) {
      throwIfAborted(signal);
      console.error(`[ExecuteMatch] Failed to persist realtime result for job ${jobId}:`, error);
    }
  };

  let strategyResults: StrategyResultMap;

  if (strategyType === "single") {
    throwIfAborted(signal);
    if (shouldStop && await shouldStop()) {
      strategyResults = new Map();
    } else {
      const startTime = Date.now();
      try {
        const { result, attemptCount } = await singleStrategy({
          ...strategyContext,
          job: matchJobs[0],
        });
        const item = { result, duration: Date.now() - startTime, attemptCount };
        strategyResults = new Map([[matchJobs[0].id, item]]);
        await persistRealtimeResult(matchJobs[0].id, item);
        onProgress?.(1, 1, 1, 0);
      } catch (error) {
        throwIfAborted(signal);
        const errorObj = error instanceof Error ? error : new Error(String(error));
        const item = {
          error: errorObj,
          duration: Date.now() - startTime,
          attemptCount: (errorObj as Error & { attemptCount?: number }).attemptCount,
        };
        strategyResults = new Map([[matchJobs[0].id, item]]);
        await persistRealtimeResult(matchJobs[0].id, item);
        onProgress?.(1, 1, 0, 1);
      }
    }
  } else if (strategyType === "bulk") {
    strategyResults = await bulkStrategy({
      ...strategyContext,
      jobs: matchJobs,
      onProgress,
      onResult: persistRealtimeResult,
      shouldStop,
    });
  } else {
    strategyResults = await parallelStrategy({
      ...strategyContext,
      jobs: matchJobs,
      onProgress,
      onResult: persistRealtimeResult,
      shouldStop,
    });
  }

  for (const id of missingIds) {
    throwIfAborted(signal);
    strategyResults.set(id, {
      error: new Error(`Job with ID ${id} not found`),
      duration: 0,
    });
  }

  applyExperienceGuardrails(strategyResults, matchJobs, candidateProfile.totalExperienceYears ?? null);

  throwIfAborted(signal);
  const results = await persistResults(
    strategyResults,
    sessionId,
    modelUsed,
    persistedJobIds,
    signal
  );

  return results;
}

async function fetchProfileDataForMatch() {
  const { fetchProfileData } = await import("../tracking");
  return fetchProfileData();
}

function applyExperienceGuardrails(
  strategyResults: StrategyResultMap,
  matchJobs: MatchJob[],
  candidateYears: number | null
): void {
  if (candidateYears === null) return;

  const jobsById = new Map<number, MatchJob>(matchJobs.map((job) => [job.id, job]));

  for (const [jobId, item] of strategyResults.entries()) {
    strategyResults.set(
      jobId,
      applyExperienceGuardrail(jobId, item, jobsById, candidateYears)
    );
  }
}

function applyExperienceGuardrail(
  jobId: number,
  item: StrategyResultItem,
  jobsById: Map<number, MatchJob>,
  candidateYears: number | null
): StrategyResultItem {
  if (!item.result || candidateYears === null) return item;

  const job = jobsById.get(jobId);
  if (!job) return item;

  const requiredYears = estimateRequiredExperienceYears(job.description, job.requirements);
  const adjusted = applyExperienceScoreGuardrails(
    item.result.score,
    requiredYears,
    candidateYears
  );

  if (adjusted.adjustedScore >= item.result.score) {
    return item;
  }

  const reasons = adjusted.reason
    ? [adjusted.reason, ...item.result.reasons]
    : item.result.reasons;

  return {
    ...item,
    result: {
      ...item.result,
      score: adjusted.adjustedScore,
      reasons,
    },
  };
}

async function persistResults(
  strategyResults: StrategyResultMap,
  sessionId: string | undefined,
  modelUsed: string,
  persistedJobIds: Set<number>,
  signal?: AbortSignal
): Promise<MatchResultMap> {
  const results: MatchResultMap = new Map();

  for (const [jobId, item] of strategyResults) {
    throwIfAborted(signal);
    if (item.error) {
      results.set(jobId, item.error);
    } else if (item.result) {
      results.set(jobId, item.result);
    }

    if (persistedJobIds.has(jobId)) {
      continue;
    }

    await persistJobResult(jobId, item, sessionId, modelUsed);
    throwIfAborted(signal);
    persistedJobIds.add(jobId);
  }

  return results;
}

async function persistJobResult(
  jobId: number,
  item: StrategyResultItem,
  sessionId: string | undefined,
  modelUsed: string
): Promise<void> {
  if (item.error) {
    if (sessionId) {
      await logMatchFailure(
        sessionId,
        jobId,
        item.duration,
        categorizeError(item.error),
        item.error.message,
        item.attemptCount ?? 1,
        modelUsed
      );
    }
    return;
  }

  if (!item.result) {
    return;
  }

  if (sessionId) {
    await persistMatchSuccess(
      sessionId,
      jobId,
      item.result,
      item.attemptCount ?? 1,
      item.duration,
      modelUsed
    );
  } else {
    await updateJobWithMatchResult(jobId, item.result);
  }
}
