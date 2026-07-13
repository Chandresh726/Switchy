import { getMatcherConfig } from "../config";
import { withQueue } from "../queue";
import type { StrategyProgressCallback } from "../strategies";
import type { MatcherConfig, MatchResultMap } from "../types";

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
  options: MatchWorkExecutionOptions = {}
): Promise<MatchResultMap> {
  return withQueue(
    config,
    async () => {
      options.signal?.throwIfAborted();
      if ((await options.onStart?.()) === false) return new Map();
      return executeMatch({
        config,
        jobIds,
        sessionId: options.sessionId,
        signal: options.signal,
        onProgress: options.onProgress,
        shouldStop: options.shouldStop,
      });
    },
    options.onQueued,
    options.signal
  );
}

export async function executeMatchWork(
  jobIds: number[],
  options: MatchWorkExecutionOptions = {}
): Promise<MatchResultMap> {
  const config = await getMatcherConfig();
  return executeConfiguredMatchWork(config, jobIds, options);
}
