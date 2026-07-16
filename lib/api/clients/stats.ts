import { statsResponseSchema } from "@/lib/api/contracts/stats";

import { apiGet } from "../client";

export const getStats = () => apiGet("/api/stats", statsResponseSchema, "Failed to fetch stats");
