import { KeyedExecutionLock } from "@/lib/runtime/keyed-lock";

import { abortableDelay } from "./cancellation";

export interface AdaptivePacingOptions {
  maxIntervalMs: number;
  recoverySuccesses: number;
}

interface HostPacingState {
  lastStartedAt: number | null;
  intervalMs: number;
  successes: number;
}

/** Serializes start-time decisions, without holding the lock during HTTP IO. */
export class HostRequestPacer {
  private readonly locks = new KeyedExecutionLock<string>();
  private readonly hosts = new Map<string, HostPacingState>();

  async wait(host: string, minimumMs: number, signal: AbortSignal, adaptive?: AdaptivePacingOptions): Promise<void> {
    const release = await this.locks.acquire(host, signal);
    try {
      const state = this.hosts.get(host) ?? { lastStartedAt: null, intervalMs: 0, successes: 0 };
      const minimum = Number.isFinite(minimumMs) ? Math.max(0, minimumMs) : 0;
      while (state.lastStartedAt !== null) {
        const interval = adaptive ? Math.max(minimum, state.intervalMs) : minimum;
        const delay = state.lastStartedAt + interval - Date.now();
        if (delay <= 0) break;
        await abortableDelay(delay, signal);
        // Another in-flight request may have increased the adaptive penalty.
      }
      if (signal.aborted) throw signal.reason;
      state.lastStartedAt = Date.now();
      this.hosts.set(host, state);
    } finally { release(); }
  }

  observe(host: string, status: number, minimumMs: number, policy?: AdaptivePacingOptions): void {
    if (!policy || minimumMs <= 0) return;
    const state = this.hosts.get(host);
    if (!state) return;
    if (status === 429) {
      const maximum = Number.isFinite(policy.maxIntervalMs) ? Math.max(minimumMs, policy.maxIntervalMs) : minimumMs * 8;
      state.intervalMs = Math.min(maximum, Math.max(minimumMs, state.intervalMs) * 2);
      state.successes = 0;
    } else if (status >= 200 && status < 300) {
      state.successes++;
      const successes = Number.isFinite(policy.recoverySuccesses) ? Math.max(1, policy.recoverySuccesses) : 5;
      if (state.successes >= successes) {
        state.intervalMs = Math.max(minimumMs, state.intervalMs * 0.8);
        state.successes = 0;
      }
    }
  }
}
