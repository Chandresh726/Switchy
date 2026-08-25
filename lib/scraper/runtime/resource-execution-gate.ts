export type ScrapeResourceClass = "standard" | "browser_heavy";

interface ResourceWaiter {
  resourceClass: ScrapeResourceClass;
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  signal: AbortSignal;
  onAbort: () => void;
}

export class ScrapeResourceExecutionGate {
  private readonly waiters: ResourceWaiter[] = [];
  private activeTotal = 0;
  private activeBrowserHeavy = 0;
  private totalLimit: number;
  private browserHeavyLimit: number;
  private readonly browserHeavyCapacity: number;

  constructor(totalLimit: number, browserHeavyLimit = 2) {
    this.browserHeavyCapacity = Math.max(1, Math.floor(browserHeavyLimit));
    this.totalLimit = Math.max(1, Math.floor(totalLimit));
    this.browserHeavyLimit = Math.max(
      1,
      Math.min(this.totalLimit, this.browserHeavyCapacity)
    );
  }

  setTotalLimit(limit: number): void {
    this.totalLimit = Math.max(1, Math.floor(limit));
    this.browserHeavyLimit = Math.min(
      this.browserHeavyCapacity,
      this.totalLimit
    );
    this.drain();
  }

  acquire(
    resourceClass: ScrapeResourceClass,
    signal: AbortSignal
  ): Promise<() => void> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const waiter: ResourceWaiter = {
        resourceClass,
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
    while (this.activeTotal < this.totalLimit) {
      const index = this.waiters.findIndex((waiter) =>
        this.canGrant(waiter.resourceClass)
      );
      if (index < 0) return;
      const [waiter] = this.waiters.splice(index, 1);
      if (waiter) this.grant(waiter);
    }
  }

  private canGrant(resourceClass: ScrapeResourceClass): boolean {
    return (
      resourceClass === "standard" ||
      this.activeBrowserHeavy < this.browserHeavyLimit
    );
  }

  private grant(waiter: ResourceWaiter): void {
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    this.activeTotal += 1;
    if (waiter.resourceClass === "browser_heavy") {
      this.activeBrowserHeavy += 1;
    }
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      this.activeTotal = Math.max(0, this.activeTotal - 1);
      if (waiter.resourceClass === "browser_heavy") {
        this.activeBrowserHeavy = Math.max(0, this.activeBrowserHeavy - 1);
      }
      this.drain();
    });
  }
}
