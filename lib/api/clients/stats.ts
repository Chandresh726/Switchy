import { statsQuerySchema, statsResponseSchema, dashboardResponseSchema } from "@/lib/api/contracts/stats";
import type { StatsResponse } from "@/lib/api/contracts/stats";

import { appendQuery, apiGet, serializeQuery } from "../client";

export const getStats = (days?: 7 | 30 | 90): Promise<StatsResponse> => {
  const query = days === undefined
    ? ""
    : serializeQuery(statsQuerySchema, { days: String(days) as "7" | "30" | "90" });
  return apiGet(appendQuery("/api/stats", query), statsResponseSchema, "Failed to fetch stats");
};

export const getDashboard = (signal?: AbortSignal) => apiGet("/api/dashboard", dashboardResponseSchema, "Failed to fetch dashboard", signal);
