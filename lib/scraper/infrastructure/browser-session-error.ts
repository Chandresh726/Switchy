export type BrowserSessionBootstrapStage =
  | "launch"
  | "navigation"
  | "settle"
  | "session_extraction";

export class BrowserSessionBootstrapError extends Error {
  readonly retryable = true;

  constructor(public readonly stage: BrowserSessionBootstrapStage) {
    super(`Failed to establish browser session during ${stage.replace("_", " ")}.`);
    this.name = "BrowserSessionBootstrapError";
  }
}
