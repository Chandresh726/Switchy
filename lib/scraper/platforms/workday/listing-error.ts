import type { WorkdayListFetchStage } from "./payloads";

export class WorkdayListError extends Error {
  constructor(
    readonly stage: WorkdayListFetchStage,
    readonly offset: number,
    message: string,
    readonly status?: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "WorkdayListError";
  }

  describe(): string {
    const statusSuffix = this.status !== undefined ? `, HTTP ${this.status}` : "";
    return `Failed to fetch Workday jobs list (stage=${this.stage}, offset=${this.offset}${statusSuffix}): ${this.message}`;
  }
}
