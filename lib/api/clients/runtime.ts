import { queuedMatchResponseSchema } from "@/lib/api/contracts/settings";
import {
  matchSessionProgressResponseSchema,
  schedulerRecoveryResponseSchema,
  schedulerStatusResponseSchema,
} from "@/lib/api/contracts/runtime";

import { apiRequest } from "../client";
import { APP_REQUEST_HEADERS } from "../request-headers";

export const getSchedulerStatus = () => apiRequest("/api/scheduler/status", { method: "GET", cache: "no-store" }, schedulerStatusResponseSchema, "Failed to fetch scheduler status");
export const recoverScheduler = () => apiRequest("/api/scheduler/recover", { method: "POST", headers: APP_REQUEST_HEADERS, cache: "no-store" }, schedulerRecoveryResponseSchema, "Failed to recover scheduler");
export const queueJobMatch = (jobId: number) => apiRequest("/api/match", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...APP_REQUEST_HEADERS },
  body: JSON.stringify({ jobId }),
}, queuedMatchResponseSchema, "Failed to calculate match");
export const getMatchSession = (sessionId: string) => apiRequest(`/api/match/sessions/${encodeURIComponent(sessionId)}`, { method: "GET", cache: "no-store" }, matchSessionProgressResponseSchema, "Failed to read match progress");
