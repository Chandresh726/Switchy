import type { LanguageModel } from "ai";
import type {
  MatcherConfig,
  MatchResult,
  MatchJob,
  CandidateProfile,
  StrategyResultItem,
  StrategyResultMap,
} from "../types";
import type { CircuitBreaker } from "../resilience";

export interface StrategyContext {
  config: MatcherConfig;
  model: LanguageModel;
  providerOptions: Record<string, unknown> | undefined;
  circuitBreaker: CircuitBreaker;
  candidateProfile: CandidateProfile;
}

export interface SingleStrategyContext extends StrategyContext {
  job: MatchJob;
}

export type StrategyProgressCallback = (
  completed: number,
  total: number,
  succeeded: number,
  failed: number
) => void;

export type StrategyResultCallback = (
  jobId: number,
  item: StrategyResultItem
) => Promise<void> | void;

export type ShouldStopCallback = () => Promise<boolean>;

export interface BulkStrategyContext extends StrategyContext {
  jobs: MatchJob[];
  onProgress?: StrategyProgressCallback;
  onResult?: StrategyResultCallback;
  shouldStop?: ShouldStopCallback;
}

export interface ParallelStrategyContext extends StrategyContext {
  jobs: MatchJob[];
  onProgress?: StrategyProgressCallback;
  onResult?: StrategyResultCallback;
  shouldStop?: ShouldStopCallback;
}

export type SingleStrategy = (ctx: SingleStrategyContext) => Promise<MatchResult>;
export type BulkStrategy = (ctx: BulkStrategyContext) => Promise<StrategyResultMap>;
export type ParallelStrategy = (ctx: ParallelStrategyContext) => Promise<StrategyResultMap>;

export function selectStrategy(config: MatcherConfig, jobCount: number): "single" | "bulk" | "parallel" {
  if (jobCount === 1) {
    return "single";
  }
  
  if (config.bulkEnabled) {
    return "bulk";
  }
  
  return "parallel";
}
