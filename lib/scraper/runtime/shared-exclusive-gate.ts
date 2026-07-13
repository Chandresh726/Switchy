export type ExecutionMode = "shared" | "exclusive";

interface ExecutionWaiter {
  mode: ExecutionMode;
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  signal: AbortSignal;
  onAbort: () => void;
}

export class SharedExclusiveExecutionGate {
  private readonly waiters: ExecutionWaiter[] = [];
  private activeShared = 0;
  private activeExclusive = false;

  constructor(private sharedLimit: number) {
    this.setSharedLimit(sharedLimit);
  }

  setSharedLimit(limit: number): void {
    this.sharedLimit = Math.max(1, Math.floor(limit));
    this.drain();
  }

  acquire(mode: ExecutionMode, signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const waiter: ExecutionWaiter = {
        mode,
        resolve,
        reject,
        signal,
        onAbort: () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(signal.reason);
          this.drain();
        },
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      this.waiters.push(waiter);
      this.drain();
    });
  }

  private drain(): void {
    if (this.activeExclusive || this.waiters.length === 0) return;
    const first = this.waiters[0];
    if (first?.mode === "exclusive") {
      if (this.activeShared > 0) return;
      this.grant(this.waiters.shift()!);
      return;
    }
    while (
      this.waiters[0]?.mode === "shared" &&
      this.activeShared < this.sharedLimit &&
      !this.activeExclusive
    ) {
      this.grant(this.waiters.shift()!);
    }
  }

  private grant(waiter: ExecutionWaiter): void {
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    if (waiter.mode === "exclusive") this.activeExclusive = true;
    else this.activeShared += 1;
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      if (waiter.mode === "exclusive") this.activeExclusive = false;
      else this.activeShared = Math.max(0, this.activeShared - 1);
      this.drain();
    });
  }
}
