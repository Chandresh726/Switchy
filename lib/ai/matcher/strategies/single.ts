import { SINGLE_MATCH_SYSTEM_PROMPT, buildSingleMatchPrompt } from "../prompts";
import { generateStructured } from "../generation";
import { retryWithBackoff, withTimeout, isServerError, isRateLimitError } from "../resilience";
import { MatchResultSchema } from "../types";
import type { SingleStrategy } from "./types";

export const singleStrategy: SingleStrategy = async (ctx) => {
  const { config, model, providerOptions, circuitBreaker, candidateProfile, job } = ctx;

  const prompt = buildSingleMatchPrompt(
    job.title,
    job.description,
    job.requirements,
    candidateProfile
  );

  const result = await retryWithBackoff(
    async () => {
      if (!circuitBreaker.canExecute()) {
        throw new Error("Circuit breaker is open - too many failures");
      }

      return withTimeout(
        (async () => {
          const generated = await generateStructured({
            model,
            schema: MatchResultSchema,
            system: SINGLE_MATCH_SYSTEM_PROMPT,
            prompt,
            providerOptions,
          });
          return generated.data;
        })(),
        config.timeoutMs,
        `Match job ${job.id}`
      );
    },
    {
      maxRetries: config.maxRetries,
      baseDelay: config.backoffBaseDelay,
      maxDelay: config.backoffMaxDelay,
      onRetry: (attempt, delay, error) => {
        if (error && (isServerError(error) || isRateLimitError(error))) {
          console.log(`[SingleStrategy] Retry ${attempt}: Server/rate limit error, returning 3x base delay`);
          return config.backoffBaseDelay * 3;
        }
        console.log(`[SingleStrategy] Job ${job.id} retry ${attempt} scheduled after ${Math.round(delay)}ms`);
      },
    }
  );

  circuitBreaker.recordSuccess();
  return result;
};
