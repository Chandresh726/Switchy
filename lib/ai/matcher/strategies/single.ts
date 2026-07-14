import { parseReasoningEffort } from "@/lib/ai/runtime-context";

import { SINGLE_MATCH_SYSTEM_PROMPT, buildSingleMatchPrompt } from "../prompts";
import { generateStructured } from "../generation";
import { throwIfAborted } from "../resilience";
import { MatchResultSchema } from "../types";
import type { SingleStrategy } from "./types";

const SINGLE_MATCH_PROMPT_VERSION = "legacy-single-match-v1";
const MATCH_RESULT_SCHEMA_VERSION = "legacy-match-result-v1";
const MATCH_POLICY_VERSION = "legacy-matcher-policy-v1";

export const singleStrategy: SingleStrategy = async (ctx) => {
  const {
    config,
    runtime,
    circuitBreaker,
    candidateProfile,
    job,
    signal,
  } = ctx;

  const prompt = buildSingleMatchPrompt(
    job.title,
    job.description,
    job.requirements,
    candidateProfile
  );

  try {
    throwIfAborted(signal);
    if (!circuitBreaker.canExecute()) {
      throw new Error("Circuit breaker is open - too many failures");
    }

    const generated = await generateStructured({
      runtime,
      schema: MatchResultSchema,
      instructions: SINGLE_MATCH_SYSTEM_PROMPT,
      prompt,
      policy: {
        maxAttempts: config.maxRetries,
        timeoutMs: config.timeoutMs,
        reasoningEffort: parseReasoningEffort(config.reasoningEffort),
      },
      subject: { type: "job", id: String(job.id) },
      promptVersion: SINGLE_MATCH_PROMPT_VERSION,
      schemaVersion: MATCH_RESULT_SCHEMA_VERSION,
      policyVersion: MATCH_POLICY_VERSION,
      retry: {
        baseDelayMs: config.backoffBaseDelay,
        maxDelayMs: config.backoffMaxDelay,
      },
      signal,
    });

    circuitBreaker.recordSuccess();
    return { result: generated.data, attemptCount: generated.attempts };
  } catch (error) {
    throwIfAborted(signal);
    const errorObj = error instanceof Error ? error : new Error(String(error));
    circuitBreaker.recordFailure(errorObj);
    throw errorObj;
  }
};
