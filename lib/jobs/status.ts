export const JOB_STATUSES = [
  "new",
  "viewed",
  "interested",
  "applied",
  "rejected",
  "archived",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];
