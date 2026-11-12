import type { z } from "zod";

import type { AIContextOverrides } from "@/lib/ai/runtime-context";
import { createAICapabilityRuntime, getAIExecutionErrorContext, type AICapabilityRuntime, type CreateAICapabilityRuntimeOptions } from "@/lib/ai/runtime";
import { categorizeError, isRateLimitError } from "@/lib/ai/shared/errors";
import type { AIExecutionResult, ResolvedModelSnapshot } from "@/lib/ai/runtime/types";

export interface MatchFallbackModel extends AIContextOverrides {
  providerId: string;
  modelId: string;
}

function canUseFallback(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "AbortError") return false;
  return ["rate_limit", "network", "timeout", "generation_failed", "json_parse", "no_object",
    "missing_api_key", "invalid_model", "provider_not_found", "provider_restricted"].includes(categorizeError(error));
}

// The wrapper owns routing, while each concrete runtime keeps its own ledger.
// A fallback is resolved lazily so an unavailable fallback cannot break a healthy primary.
export function withMatchFallback(primary: AICapabilityRuntime, model?: MatchFallbackModel): AICapabilityRuntime {
  if (!model) return primary;
  let fallbackPromise: Promise<AICapabilityRuntime> | undefined;
  return {
    ...primary,
    async executeStructured<T extends z.ZodTypeAny>(input: Parameters<AICapabilityRuntime["executeStructured"]>[0] & { schema: T }): Promise<AIExecutionResult<z.infer<T>>> {
      try {
        return await primary.executeStructured({ ...input,
          policy: { ...input.policy, maxAttempts: Math.min(input.policy.maxAttempts, 2) } });
      } catch (error) {
        input.signal?.throwIfAborted();
        if (!canUseFallback(error)) throw error;
        const previous = getAIExecutionErrorContext(error);
        fallbackPromise ??= createAICapabilityRuntime({ capability: primary.capability, model, providerConcurrencyLimit: 1 });
        const fallback = await fallbackPromise.catch((resolutionError: unknown) => {
          fallbackPromise = undefined;
          // Keep a quota deferral if the alternate cannot even be configured.
          if (isRateLimitError(error)) throw error;
          throw resolutionError;
        });
        try {
          const result = await fallback.executeStructured({ ...input,
            metadata: { ...input.metadata, fallbackUsed: true,
              ...(previous.aiRunId ? { fallbackFromRunId: previous.aiRunId } : {}),
              fallbackReason: categorizeError(error as Error) },
            policy: { ...input.policy, maxAttempts: Math.min(input.policy.maxAttempts, 2), reasoningEffort: fallback.reasoningEffort },
          });
          return { ...result, attempts: result.attempts + (previous.attemptCount ?? 0) };
        } catch (fallbackError) {
          // If either route is temporarily throttled, keep the operation resumable.
          if (isRateLimitError(error) && !isRateLimitError(fallbackError) && ["network", "timeout"].includes(categorizeError(fallbackError as Error))) throw error;
          throw fallbackError;
        }
      }
    },
  };
}

export function resultModelConfig(snapshot?: ResolvedModelSnapshot, reasoningEffort?: string) {
  return snapshot ? { providerId: snapshot.providerRecordId, model: snapshot.modelId, reasoningEffort } : undefined;
}

export async function createMatchRuntime(options: CreateAICapabilityRuntimeOptions, fallback?: MatchFallbackModel): Promise<AICapabilityRuntime> {
  try {
    return withMatchFallback(await createAICapabilityRuntime(options), fallback);
  } catch (error) {
    if (!fallback || !canUseFallback(error)) throw error;
    const runtime = await createAICapabilityRuntime({ ...options, model: fallback, providerConcurrencyLimit: 1 });
    const previous = getAIExecutionErrorContext(error);
    return { ...runtime, executeStructured: (input) => runtime.executeStructured({ ...input,
      policy: { ...input.policy, maxAttempts: Math.min(input.policy.maxAttempts, 2), reasoningEffort: runtime.reasoningEffort },
      metadata: { ...input.metadata, fallbackUsed: true, fallbackReason: categorizeError(error as Error),
        ...(previous.aiRunId ? { fallbackFromRunId: previous.aiRunId } : {}) },
    }) };
  }
}
