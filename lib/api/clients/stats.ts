import { statsResponseSchema } from "@/lib/api/contracts/stats";
import type { StatsResponse } from "@/lib/api/contracts/stats";

import { apiGet } from "../client";

export const getStats = (): Promise<StatsResponse> => apiGet("/api/stats", statsResponseSchema, "Failed to fetch stats");
