import { getCurrentMatchContext } from "@/lib/ai/matcher/presentation";
import { logApiFailure, type ApiRequestContext } from "@/lib/api";
import { jobsQuerySchema } from "@/lib/api/contracts/jobs";

import { listJobs } from "./jobs-service";
import { getDashboardStats } from "./stats-service";

export async function getDashboard(requestContext: ApiRequestContext) {
  const context = await getCurrentMatchContext();
  const preview = { includeTotal: "false", limit: 20 };
  const [stats, highMatches, recentJobs, appliedJobs] = await Promise.allSettled([
    getDashboardStats(7, new Date(), context),
    listJobs(jobsQuerySchema.parse({ ...preview, matchBands: ["high", "good"], excludeStatus: ["applied", "archived"], sortBy: "matchScore" }), context),
    listJobs(jobsQuerySchema.parse({ ...preview, excludeStatus: ["applied", "archived"], sortBy: "discoveredAt" }), context),
    listJobs(jobsQuerySchema.parse({ ...preview, status: "applied", sortBy: "discoveredAt", limit: 5 }), context),
  ]);
  const errors: Record<string, { error: string; code: string; requestId: string }> = {};
  const result = <T>(key: string, value: PromiseSettledResult<T>): T | null => {
    if (value.status === "fulfilled") return value.value;
    const code = `dashboard_${key}_failed`;
    logApiFailure(requestContext, code, 500, value.reason);
    errors[key] = { error: "This dashboard section could not be loaded", code, requestId: requestContext.requestId };
    return null;
  };
  return { stats: result("stats", stats), highMatches: result("highMatches", highMatches), recentJobs: result("recentJobs", recentJobs), appliedJobs: result("appliedJobs", appliedJobs), errors };
}
