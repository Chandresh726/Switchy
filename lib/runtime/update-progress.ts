export const UPDATE_STAGES = ["download", "verify", "extract", "browser", "snapshot", "migrate", "start", "cleanup"] as const;
export type UpdateStage = typeof UPDATE_STAGES[number];

export interface UpdateProgress {
  stage: UpdateStage;
  completedBytes?: number;
  totalBytes?: number;
}

export const UPDATE_STAGE_LABELS: Record<UpdateStage, string> = {
  download: "Downloading update…",
  verify: "Verifying download…",
  extract: "Preparing update…",
  browser: "Preparing browser…",
  snapshot: "Backing up your data…",
  migrate: "Updating your data…",
  start: "Restarting Switchy…",
  cleanup: "Finishing update…",
};
