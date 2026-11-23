export interface ScheduledSingleFlightDispatcherOptions<TResult> {
  run: () => Promise<TResult>;
  getNextRunAt?: (result: TResult) => Date | null;
  failureRetryMs: number;
  onError: (error: unknown) => void;
}

export class ScheduledSingleFlightDispatcher<TResult> {
  private activeRun: Promise<TResult> | null = null;
  private rerunRequested = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly options: ScheduledSingleFlightDispatcherOptions<TResult>
  ) {}

  request(options: { rerunIfActive?: boolean } = {}): Promise<TResult> {
    if (this.activeRun) {
      if (options.rerunIfActive !== false) this.rerunRequested = true;
      return this.activeRun;
    }
    this.clearTimer();

    const run = this.options.run();
    this.activeRun = run;
    let failed = false;
    let nextRunAt: Date | null = null;

    void run
      .then((result) => {
        nextRunAt = this.options.getNextRunAt?.(result) ?? null;
      })
      .catch((error) => {
        failed = true;
        this.options.onError(error);
      })
      .finally(() => {
        if (this.activeRun === run) this.activeRun = null;
        if (this.rerunRequested) {
          this.rerunRequested = false;
          void this.request();
          return;
        }
        if (failed) {
          this.schedule(new Date(Date.now() + this.options.failureRetryMs));
          return;
        }
        this.schedule(nextRunAt);
      });

    return run;
  }

  dispose(): void {
    this.rerunRequested = false;
    this.clearTimer();
  }

  private schedule(nextRunAt: Date | null): void {
    if (!nextRunAt) return;
    const delayMs = Math.max(0, nextRunAt.getTime() - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.request();
    }, delayMs);
    if (typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref();
    }
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
