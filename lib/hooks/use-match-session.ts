"use client";

import { useEffect, useRef } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMatchSession } from "@/lib/api/clients/runtime";
import type { MatchSessionProgress } from "@/lib/api/contracts/runtime";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";

import { useProgressRefresh } from "./use-progress-refresh";
import { sessionPollingInterval } from "./history-polling";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function useMatchSession(
  sessionId: string | null,
  options: {
    includeJobs?: boolean;
    onSettled?: (progress: MatchSessionProgress) => void;
  } = {}
) {
  const queryClient = useQueryClient();
  const settledSessions = useRef(new Set<string>());
  const query = useQuery<MatchSessionProgress | null>({
    queryKey: [...queryKeys.runtime.matchSession(sessionId), "summary"],
    queryFn: async () => {
      if (!sessionId) return null;
      return getMatchSession(sessionId, true);
    },
    enabled: Boolean(sessionId),
    refetchInterval: ({ state }) => sessionPollingInterval(state.data ?? undefined),

  });

  const detailKey = [...queryKeys.runtime.matchSession(sessionId), "detail"];
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: () => getMatchSession(sessionId!),
    enabled: Boolean(sessionId && options.includeJobs),
    refetchInterval: () => sessionPollingInterval(query.data ?? undefined) === false ? false : 30_000,
  });
  useProgressRefresh(detailKey, options.includeJobs ? query.data?.revision : undefined);

  const onSettledRef = useRef(options.onSettled);
  useEffect(() => {
    onSettledRef.current = options.onSettled;
  }, [options.onSettled]);
  const progress = query.data;

  useEffect(() => {
    if (!progress || !TERMINAL_STATUSES.has(progress.status)) return;
    if (settledSessions.current.has(progress.sessionId)) return;
    settledSessions.current.add(progress.sessionId);
    void cacheOwnership.matchCompletion(queryClient);
    onSettledRef.current?.(progress);
  }, [progress, queryClient]);

  return { ...query, data: query.data && options.includeJobs && detail.data
    ? { ...query.data, jobs: detail.data.jobs, jobPagination: detail.data.jobPagination }
    : query.data };
}
