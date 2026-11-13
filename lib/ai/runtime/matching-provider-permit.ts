import { AIError, AIRateLimitError, getRetryAfterMs, isRateLimitError } from "@/lib/ai/shared/errors";

import { adaptiveProviderLimiter } from "./adaptive-provider-limiter";
import { providerModelScope, providerQuotaScope } from "./provider-scope";
import type { createAIRunRepository } from "./run-repository";
import type { ResolvedModelSnapshot } from "./types";

type CooldownRepository = Pick<ReturnType<typeof createAIRunRepository>,
  "getProviderCooldown" | "setProviderCooldown" | "recordModelCooldown">;

export async function acquireMatchingProviderPermit(
  snapshot: ResolvedModelSnapshot,
  configuredCeiling: number,
  repository: CooldownRepository,
  signal: AbortSignal
) {
  const accountScope = providerQuotaScope(snapshot);
  const splitCooldown = snapshot.backendKind === "opencode_cli";
  const modelScope = splitCooldown ? providerModelScope(accountScope, snapshot.modelId) : accountScope;
  const ceiling = snapshot.modelId.endsWith("-free") ? 1 : configuredCeiling;
  const accountCooldownScope = splitCooldown ? `${accountScope}:account` : accountScope;

  // Legacy OpenCode account cooldowns did not distinguish actual account limits
  // from one model's limit. Only restore the new, confirmed account cooldowns.
  if (repository.getProviderCooldown) {
    const accountUntil = await repository.getProviderCooldown(accountCooldownScope);
    adaptiveProviderLimiter.restoreCooldown(accountScope, ceiling, accountUntil);
    if (splitCooldown) {
      const modelUntil = await repository.getProviderCooldown(modelScope);
      adaptiveProviderLimiter.restoreCooldown(modelScope, ceiling, modelUntil);
    }
  }

  const modelPermit = splitCooldown
    ? await adaptiveProviderLimiter.acquire(modelScope, ceiling, signal)
    : undefined;
  let accountPermit;
  try {
    accountPermit = await adaptiveProviderLimiter.acquire(accountScope, ceiling, signal);
  } catch (error) {
    // An account cooldown or cancellation is not a new provider response.
    modelPermit?.release();
    throw error;
  }

  return {
    success() {
      modelPermit?.success();
      accountPermit.success();
    },
    release() {
      modelPermit?.release();
      accountPermit.release();
    },
    async failure(error: unknown): Promise<unknown> {
      if (!isRateLimitError(error)) {
        modelPermit?.failure(error);
        accountPermit.failure(error);
        return error;
      }

      // Keep the account permit until persistence and escalation finish, so
      // queued fallback requests cannot race past a newly confirmed account limit.
      try {
        (modelPermit ?? accountPermit).failure(error);
        const until = adaptiveProviderLimiter.getSnapshot(modelScope)!.cooldownUntil;
        let sharedUntil = 0;
        if (splitCooldown) {
          sharedUntil = await repository.recordModelCooldown(accountScope, snapshot.modelId, until,
            error instanceof AIError && error.context?.rateLimitScope === "account");
          adaptiveProviderLimiter.restoreCooldown(accountScope, ceiling, sharedUntil);
        } else if (repository.setProviderCooldown) {
          await repository.setProviderCooldown(accountScope, until);
        }
        return new AIRateLimitError("Provider is cooling down", error instanceof Error ? error : undefined,
          Math.max(getRetryAfterMs(error) ?? 0, Math.max(until, sharedUntil) - Date.now()));
      } finally {
        if (splitCooldown) accountPermit.failure(error, false);
      }
    },
  };
}
