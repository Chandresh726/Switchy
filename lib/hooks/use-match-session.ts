"use client";

import { useEffect, useRef } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMatchSession } from "@/lib/api/clients/runtime";
import type { MatchSessionProgress } from "@/lib/api/contracts/runtime";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function useMatchSession(
  sessionId: string | null,
  options: {
    onSettled?: (progress: MatchSessionProgress) => void;
  } = {}
) {
  const queryClient = useQueryClient();
  const settledSessions = useRef(new Set<string>());
  const query = useQuery<MatchSessionProgress | null>({
    queryKey: queryKeys.runtime.matchSession(sessionId),
    queryFn: async () => {
      if (!sessionId) return null;
      return getMatchSession(sessionId);
    },
    enabled: Boolean(sessionId),
    refetchInterval: ({ state }) => {
      const progress = state.data;
      return progress && TERMINAL_STATUSES.has(progress.status) ? false : 3_000;
    },
    refetchIntervalInBackground: false,
  });

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

  return query;
}
