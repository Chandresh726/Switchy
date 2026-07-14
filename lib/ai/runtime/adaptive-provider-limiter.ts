import { isRateLimitError } from "@/lib/ai/shared/errors";

const SUCCESS_STREAK_TO_INCREASE = 20;

interface WaitingPermit {
  resolve: (permit: AdaptiveProviderPermit) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  removeAbortListener: () => void;
}

interface ProviderLimitState {
  ceiling: number;
  currentLimit: number;
  active: number;
  consecutiveSuccesses: number;
  waiters: WaitingPermit[];
}

export interface AdaptiveProviderLimitSnapshot {
  ceiling: number;
  currentLimit: number;
  active: number;
  consecutiveSuccesses: number;
  waiting: number;
}

export interface AdaptiveProviderPermit {
  success(): void;
  failure(error: unknown): void;
}

function normalizeCeiling(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Provider request cancelled", "AbortError");
}

export class AdaptiveProviderLimiter {
  private readonly states = new Map<string, ProviderLimitState>();

  acquire(
    providerRecordId: string,
    configuredCeiling: number,
    signal?: AbortSignal
  ): Promise<AdaptiveProviderPermit> {
    signal?.throwIfAborted();
    const state = this.getOrCreateState(providerRecordId, configuredCeiling);

    if (state.active < state.currentLimit) {
      state.active += 1;
      return Promise.resolve(this.createPermit(providerRecordId, state));
    }

    return new Promise<AdaptiveProviderPermit>((resolve, reject) => {
      const waiter: WaitingPermit = {
        resolve,
        reject,
        signal,
        removeAbortListener: () => undefined,
      };
      const onAbort = () => {
        const index = state.waiters.indexOf(waiter);
        if (index === -1) return;
        state.waiters.splice(index, 1);
        waiter.removeAbortListener();
        reject(signal ? abortReason(signal) : new DOMException("Provider request cancelled", "AbortError"));
      };
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
        waiter.removeAbortListener = () => signal.removeEventListener("abort", onAbort);
      }
      state.waiters.push(waiter);
      if (signal?.aborted) onAbort();
    });
  }

  getSnapshot(providerRecordId: string): AdaptiveProviderLimitSnapshot | null {
    const state = this.states.get(providerRecordId);
    if (!state) return null;
    return {
      ceiling: state.ceiling,
      currentLimit: state.currentLimit,
      active: state.active,
      consecutiveSuccesses: state.consecutiveSuccesses,
      waiting: state.waiters.length,
    };
  }

  reset(): void {
    const reason = new DOMException("Provider limiter reset", "AbortError");
    for (const state of this.states.values()) {
      for (const waiter of state.waiters.splice(0)) {
        waiter.removeAbortListener();
        waiter.reject(reason);
      }
    }
    this.states.clear();
  }

  private getOrCreateState(
    providerRecordId: string,
    configuredCeiling: number
  ): ProviderLimitState {
    const ceiling = normalizeCeiling(configuredCeiling);
    const existing = this.states.get(providerRecordId);
    if (existing) {
      existing.ceiling = ceiling;
      existing.currentLimit = Math.min(existing.currentLimit, ceiling);
      return existing;
    }

    const state: ProviderLimitState = {
      ceiling,
      currentLimit: ceiling,
      active: 0,
      consecutiveSuccesses: 0,
      waiters: [],
    };
    this.states.set(providerRecordId, state);
    return state;
  }

  private createPermit(
    providerRecordId: string,
    state: ProviderLimitState
  ): AdaptiveProviderPermit {
    let completed = false;
    const finish = (error?: unknown) => {
      if (completed) return;
      completed = true;

      if (error === undefined) {
        state.consecutiveSuccesses += 1;
        if (
          state.consecutiveSuccesses >= SUCCESS_STREAK_TO_INCREASE &&
          state.currentLimit < state.ceiling
        ) {
          state.currentLimit += 1;
          state.consecutiveSuccesses = 0;
        }
      } else {
        state.consecutiveSuccesses = 0;
        if (isRateLimitError(error)) {
          state.currentLimit = Math.max(1, state.currentLimit - 1);
        }
      }

      state.active = Math.max(0, state.active - 1);
      this.drain(providerRecordId, state);
    };

    return {
      success: () => finish(),
      failure: (error) => finish(error),
    };
  }

  private drain(providerRecordId: string, state: ProviderLimitState): void {
    while (state.active < state.currentLimit && state.waiters.length > 0) {
      const waiter = state.waiters.shift();
      if (!waiter) return;
      waiter.removeAbortListener();
      if (waiter.signal?.aborted) {
        waiter.reject(abortReason(waiter.signal));
        continue;
      }
      state.active += 1;
      waiter.resolve(this.createPermit(providerRecordId, state));
    }
  }
}

export const adaptiveProviderLimiter = new AdaptiveProviderLimiter();

export function resetAdaptiveProviderLimiter(): void {
  adaptiveProviderLimiter.reset();
}
