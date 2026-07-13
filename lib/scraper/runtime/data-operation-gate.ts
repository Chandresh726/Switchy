import { SharedExclusiveExecutionGate } from "./shared-exclusive-gate";

export interface MatchCancellationFilter {
  jobIds?: readonly number[];
  sessionId?: string;
  trackedOnly?: boolean;
}

export interface LocalDataOperationGate {
  runScrape<T>(
    companyId: number,
    signal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T>;
  runMatch<T>(
    context: { jobIds: readonly number[]; sessionId?: string },
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T>;
  cancelScrapes(companyIds?: readonly number[]): void;
  cancelMatches(filter?: MatchCancellationFilter): void;
  runMaintenance<T>(operation: () => T | Promise<T>): Promise<T>;
}

type ActiveWork =
  | {
      kind: "scrape";
      companyId: number;
      controller: AbortController;
    }
  | {
      kind: "match";
      jobIds: Set<number>;
      sessionId?: string;
      controller: AbortController;
    };

function maintenanceAbortError(): DOMException {
  return new DOMException(
    "Local data maintenance requested cancellation",
    "AbortError"
  );
}

export class InProcessLocalDataOperationGate implements LocalDataOperationGate {
  private readonly gate = new SharedExclusiveExecutionGate(
    Number.MAX_SAFE_INTEGER
  );
  private readonly activeWork = new Set<ActiveWork>();

  runScrape<T>(
    companyId: number,
    signal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    return this.run(
      { kind: "scrape", companyId, controller: new AbortController() },
      signal,
      operation
    );
  }

  runMatch<T>(
    context: { jobIds: readonly number[]; sessionId?: string },
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    return this.run(
      {
        kind: "match",
        jobIds: new Set(context.jobIds),
        sessionId: context.sessionId,
        controller: new AbortController(),
      },
      signal,
      operation
    );
  }

  cancelScrapes(companyIds?: readonly number[]): void {
    const scope = companyIds ? new Set(companyIds) : null;
    for (const work of this.activeWork) {
      if (
        work.kind === "scrape" &&
        (!scope || scope.has(work.companyId))
      ) {
        work.controller.abort(maintenanceAbortError());
      }
    }
  }

  cancelMatches(filter?: MatchCancellationFilter): void {
    const jobIds = filter?.jobIds ? new Set(filter.jobIds) : null;
    for (const work of this.activeWork) {
      if (work.kind !== "match") continue;
      const sessionMatches =
        filter?.sessionId !== undefined &&
        work.sessionId === filter.sessionId;
      const jobsMatch =
        jobIds !== null &&
        Array.from(work.jobIds).some((jobId) => jobIds.has(jobId));
      const trackedMatch = filter?.trackedOnly === true && Boolean(work.sessionId);
      if (!filter || sessionMatches || jobsMatch || trackedMatch) {
        work.controller.abort(maintenanceAbortError());
      }
    }
  }

  async runMaintenance<T>(operation: () => T | Promise<T>): Promise<T> {
    const release = await this.gate.acquire(
      "exclusive",
      new AbortController().signal
    );
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async run<T>(
    work: ActiveWork,
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const combinedSignal = signal
      ? AbortSignal.any([signal, work.controller.signal])
      : work.controller.signal;
    this.activeWork.add(work);
    let release: (() => void) | null = null;
    try {
      release = await this.gate.acquire("shared", combinedSignal);
      combinedSignal.throwIfAborted();
      const result = await operation(combinedSignal);
      combinedSignal.throwIfAborted();
      return result;
    } finally {
      release?.();
      this.activeWork.delete(work);
    }
  }
}

const defaultDataOperationGate = new InProcessLocalDataOperationGate();

export function getLocalDataOperationGate(): LocalDataOperationGate {
  return defaultDataOperationGate;
}
