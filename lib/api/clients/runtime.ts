import {
  MatchRouteBodySchema,
  MatchUnmatchedBodySchema,
  MatchUnmatchedQuerySchema,
} from "@/lib/ai/contracts";
import {
  type QueuedMatchResponse,
  type UnmatchedJobsCountResponse,
  queuedMatchResponseSchema,
  unmatchedJobsCountResponseSchema,
} from "@/lib/api/contracts/settings";
import {
  matchSessionProgressResponseSchema,
  matchSessionParamsSchema,
  schedulerHostActionSchema,
  schedulerHostStatusResponseSchema,
  schedulerHostSyncResponseSchema,
  schedulerRecoveryResponseSchema,
  schedulerStatusResponseSchema,
  type SchedulerHostStatusResponse,
  type SchedulerHostSyncResponse,
} from "@/lib/api/contracts/runtime";

import { apiCommand, apiGet, apiJsonMutation, apiRequest, serializePathParam, serializeQuery } from "../client";

const matchSessionPath = (id: string) => serializePathParam(matchSessionParamsSchema, { id });

export const getSchedulerStatus = () => apiRequest("/api/scheduler/status", { method: "GET", cache: "no-store" }, schedulerStatusResponseSchema, "Failed to fetch scheduler status");
export const recoverScheduler = () => apiCommand("/api/scheduler/recover", "POST", schedulerRecoveryResponseSchema, "Failed to recover scheduler");
export const getSchedulerHost = (): Promise<SchedulerHostStatusResponse> => apiRequest("/api/scheduler/host", { method: "GET", cache: "no-store" }, schedulerHostStatusResponseSchema, "Failed to fetch scheduler host status");
export const syncSchedulerHost = (action: "sync" | "install" | "uninstall"): Promise<SchedulerHostSyncResponse> => apiJsonMutation("/api/scheduler/host", "POST", schedulerHostActionSchema, { action }, schedulerHostSyncResponseSchema, "Failed to sync scheduler host");
export const queueJobMatch = (jobId: number) => apiJsonMutation("/api/match", "POST", MatchRouteBodySchema, { jobId }, queuedMatchResponseSchema, "Failed to calculate match");
export const getMatchSession = (sessionId: string) => apiRequest(`/api/match/sessions/${matchSessionPath(sessionId)}`, { method: "GET", cache: "no-store" }, matchSessionProgressResponseSchema, "Failed to read match progress");
export const getUnmatchedJobsCount = (days: number): Promise<UnmatchedJobsCountResponse> => apiGet(`/api/jobs/match-unmatched?${serializeQuery(MatchUnmatchedQuerySchema, { days })}`, unmatchedJobsCountResponseSchema, "Failed to fetch unmatched count");
export const queueUnmatchedJobs = (days: number): Promise<QueuedMatchResponse> => apiJsonMutation("/api/jobs/match-unmatched", "POST", MatchUnmatchedBodySchema, { days }, queuedMatchResponseSchema, "Failed to match jobs");
