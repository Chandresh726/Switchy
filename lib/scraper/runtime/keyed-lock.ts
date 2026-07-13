interface KeyedLockWaiter {
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  signal: AbortSignal;
  onAbort: () => void;
}

export class KeyedExecutionLock<TKey> {
  private readonly activeKeys = new Set<TKey>();
  private readonly waiters = new Map<TKey, KeyedLockWaiter[]>();

  acquire(key: TKey, signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const waiter: KeyedLockWaiter = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          const keyedWaiters = this.waiters.get(key);
          const index = keyedWaiters?.indexOf(waiter) ?? -1;
          if (keyedWaiters && index >= 0) keyedWaiters.splice(index, 1);
          if (keyedWaiters?.length === 0) this.waiters.delete(key);
          reject(signal.reason);
        },
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      if (this.activeKeys.has(key)) {
        const keyedWaiters = this.waiters.get(key) ?? [];
        keyedWaiters.push(waiter);
        this.waiters.set(key, keyedWaiters);
        return;
      }
      this.activeKeys.add(key);
      this.grant(key, waiter);
    });
  }

  private grant(key: TKey, waiter: KeyedLockWaiter): void {
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      const keyedWaiters = this.waiters.get(key);
      const next = keyedWaiters?.shift();
      if (keyedWaiters?.length === 0) this.waiters.delete(key);
      if (next) this.grant(key, next);
      else this.activeKeys.delete(key);
    });
  }
}
