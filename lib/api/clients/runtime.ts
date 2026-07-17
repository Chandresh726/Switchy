import {
  MatchRouteBodySchema,
  MatchUnmatchedBodySchema,
  MatchUnmatchedQuerySchema,
} from "@/lib/ai/contracts";
import {
  queuedMatchResponseSchema,
  unmatchedJobsCountResponseSchema,
} from "@/lib/api/contracts/settings";
import {
  matchSessionProgressResponseSchema,
  matchSessionParamsSchema,
  schedulerRecoveryResponseSchema,
  schedulerStatusResponseSchema,
} from "@/lib/api/contracts/runtime";

import { apiCommand, apiGet, apiJsonMutation, apiRequest, serializePathParam, serializeQuery } from "../client";

const matchSessionPath = (id: string) => serializePathParam(matchSessionParamsSchema, { id });

export const getSchedulerStatus = () => apiRequest("/api/scheduler/status", { method: "GET", cache: "no-store" }, schedulerStatusResponseSchema, "Failed to fetch scheduler status");
export const recoverScheduler = () => apiCommand("/api/scheduler/recover", "POST", schedulerRecoveryResponseSchema, "Failed to recover scheduler");
export const queueJobMatch = (jobId: number) => apiJsonMutation("/api/match", "POST", MatchRouteBodySchema, { jobId }, queuedMatchResponseSchema, "Failed to calculate match");
export const getMatchSession = (sessionId: string) => apiRequest(`/api/match/sessions/${matchSessionPath(sessionId)}`, { method: "GET", cache: "no-store" }, matchSessionProgressResponseSchema, "Failed to read match progress");
export const getUnmatchedJobsCount = (days: number) => apiGet(`/api/jobs/match-unmatched?${serializeQuery(MatchUnmatchedQuerySchema, { days })}`, unmatchedJobsCountResponseSchema, "Failed to fetch unmatched count");
export const queueUnmatchedJobs = (days: number) => apiJsonMutation("/api/jobs/match-unmatched", "POST", MatchUnmatchedBodySchema, { days }, queuedMatchResponseSchema, "Failed to match jobs");
