import {
  getLocalDataOperationGate,
  type LocalDataOperationGate,
} from "@/lib/scraper/runtime/data-operation-gate";

import { getMatcherConfig } from "../config";
import type {
  MatcherConfig,
  MatchResultMap,
  StrategyProgressCallback,
} from "../types";

import { executeMatch } from "./executor";

export interface MatchWorkExecutionOptions {
  sessionId?: string;
  signal?: AbortSignal;
  onProgress?: StrategyProgressCallback;
  onQueued?: (position: number) => void;
  onStart?: () => Promise<boolean | void>;
  shouldStop?: () => Promise<boolean>;
}

export async function executeConfiguredMatchWork(
  config: MatcherConfig,
  jobIds: number[],
  options: MatchWorkExecutionOptions = {},
  dataOperationGate: LocalDataOperationGate = getLocalDataOperationGate()
): Promise<MatchResultMap> {
  return dataOperationGate.runMatch(
    { jobIds, sessionId: options.sessionId },
    options.signal,
    async (workSignal) => {
      workSignal.throwIfAborted();
      options.onQueued?.(0);
      if ((await options.onStart?.()) === false) return new Map();
      return executeMatch({
        config,
        jobIds,
        sessionId: options.sessionId,
        signal: workSignal,
        onProgress: options.onProgress,
        shouldStop: options.shouldStop,
      });
    }
  );
}

export async function executeMatchWork(
  jobIds: number[],
  options: MatchWorkExecutionOptions = {}
): Promise<MatchResultMap> {
  const config = await getMatcherConfig();
  return executeConfiguredMatchWork(config, jobIds, options);
}
