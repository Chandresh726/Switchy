import { getAIClientV2, getAIGenerationOptions } from "@/lib/ai/client";
import { createCircuitBreaker } from "../resilience";
import type {
  MatcherConfig,
  CandidateProfile,
  MatchJob,
  MatchResultMap,
  StrategyResultItem,
  StrategyResultMap,
} from "../types";
import { singleStrategy, bulkStrategy, parallelStrategy, selectStrategy, type StrategyProgressCallback } from "../strategies";
import { fetchJobsData, updateJobWithMatchResult, logMatchSuccess, logMatchFailure } from "../tracking";
import { extractRequirements, htmlToText } from "../utils";
import { categorizeError } from "../resilience";

export interface ExecuteMatchOptions {
  config: MatcherConfig & { providerId?: string };
  jobIds: number[];
  sessionId?: string;
  onProgress?: StrategyProgressCallback;
  shouldStop?: () => Promise<boolean>;
}

export async function executeMatch(options: ExecuteMatchOptions): Promise<MatchResultMap> {
  const { config, jobIds, sessionId, onProgress, shouldStop } = options;

  if (jobIds.length === 0) {
    return new Map();
  }

  const aiModel = await getAIClientV2({ modelId: config.model, reasoningEffort: config.reasoningEffort as "low" | "medium" | "high" | undefined, providerId: config.providerId });
  const providerOptions = await getAIGenerationOptions(config.model, config.reasoningEffort, config.providerId);

  const circuitBreaker = createCircuitBreaker({
    failureThreshold: config.circuitBreakerThreshold,
    resetTimeout: config.circuitBreakerResetTimeout,
  });

  const jobsMap = await fetchJobsData(jobIds);
  const profileData = await fetchProfileDataForMatch();

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
    skills: profileData.skills.map((s: { name: string; proficiency: number; category: string | null }) => ({
      name: s.name,
      proficiency: s.proficiency,
      category: s.category || undefined,
    })),
    experience: profileData.experience.map((e: { title: string; company: string; description: string | null }) => ({
      title: e.title,
      company: e.company,
      description: e.description || undefined,
    })),
    education: profileData.education.map((e: { institution: string; degree: string; field: string | null }) => ({
      institution: e.institution,
      degree: e.degree,
      field: e.field || undefined,
    })),
  };

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
    const results = await persistResults(missingResults, sessionId, config.model, new Set<number>());
    return results;
  }

  const strategyType = selectStrategy(config, matchJobs.length);

  console.log(
    `[ExecuteMatch] Using ${strategyType} strategy for ${matchJobs.length} jobs (bulkEnabled=${config.bulkEnabled})`
  );

  const strategyContext = {
    config,
    model: aiModel,
    providerOptions,
    circuitBreaker,
    candidateProfile,
  };

  const persistedJobIds = new Set<number>();

  const persistRealtimeResult = async (jobId: number, item: StrategyResultItem) => {
    if (persistedJobIds.has(jobId)) return;

    try {
      await persistJobResult(jobId, item, sessionId, config.model);
      persistedJobIds.add(jobId);
    } catch (error) {
      console.error(`[ExecuteMatch] Failed to persist realtime result for job ${jobId}:`, error);
    }
  };

  let strategyResults: StrategyResultMap;

  if (strategyType === "single") {
    if (shouldStop && await shouldStop()) {
      strategyResults = new Map();
    } else {
    const startTime = Date.now();
    try {
      const result = await singleStrategy({
        ...strategyContext,
        job: matchJobs[0],
      });
      const item = { result, duration: Date.now() - startTime };
      strategyResults = new Map([[matchJobs[0].id, item]]);
      await persistRealtimeResult(matchJobs[0].id, item);
      onProgress?.(1, 1, 1, 0);
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      const item = { error: errorObj, duration: Date.now() - startTime };
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
    strategyResults.set(id, {
      error: new Error(`Job with ID ${id} not found`),
      duration: 0,
    });
  }

  const results = await persistResults(strategyResults, sessionId, config.model, persistedJobIds);

  return results;
}

async function fetchProfileDataForMatch() {
  const { fetchProfileData } = await import("../tracking");
  return fetchProfileData();
}

async function persistResults(
  strategyResults: StrategyResultMap,
  sessionId: string | undefined,
  modelUsed: string,
  persistedJobIds: Set<number>
): Promise<MatchResultMap> {
  const results: MatchResultMap = new Map();

  for (const [jobId, item] of strategyResults) {
    if (item.error) {
      results.set(jobId, item.error);
    } else if (item.result) {
      results.set(jobId, item.result);
    }

    if (persistedJobIds.has(jobId)) {
      continue;
    }

    await persistJobResult(jobId, item, sessionId, modelUsed);
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
        1,
        modelUsed
      );
    }
    return;
  }

  if (!item.result) {
    return;
  }

  await updateJobWithMatchResult(jobId, item.result);

  if (sessionId) {
    await logMatchSuccess(
      sessionId,
      jobId,
      item.result.score,
      1,
      item.duration,
      modelUsed
    );
  }
}
