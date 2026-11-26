export type ScrapeCompanyProgressStatus =
  | "queued" | "running" | "success" | "partial" | "failed" | "cancelled";

export type ScrapeCompanyProgressCounts = Record<ScrapeCompanyProgressStatus, number>;

/** Queue ownership wins while active; finished work uses its actual outcome. */
export function resolveScrapeCompanyProgressStatus(
  queueStatus?: string | null,
  outcome?: string | null,
  logStatus?: string | null
): ScrapeCompanyProgressStatus {
  if (queueStatus === "queued" || queueStatus === "running" ||
      queueStatus === "failed" || queueStatus === "cancelled") return queueStatus;
  const status = outcome ?? logStatus ?? (queueStatus === "completed" ? "success" : "queued");
  if (status === "completed") return "success";
  if (status === "queued" || status === "running" || status === "success" ||
      status === "partial" || status === "cancelled") return status;
  return "failed";
}
