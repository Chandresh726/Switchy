"use client";

import { useEffect, useRef } from "react";

import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { getMatchSession } from "@/lib/api/clients/runtime";
import type { MatchSessionProgress } from "@/lib/api/contracts/runtime";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function useMatchSession(
  sessionId: string | null,
  options: {
    extraInvalidationKeys?: QueryKey[];
    onSettled?: (progress: MatchSessionProgress) => void;
  } = {}
) {
  const queryClient = useQueryClient();
  const settledSessions = useRef(new Set<string>());
  const query = useQuery<MatchSessionProgress | null>({
    queryKey: ["match-session", sessionId],
    queryFn: async () => {
      if (!sessionId) return null;
      return getMatchSession(sessionId);
    },
    enabled: Boolean(sessionId),
    refetchInterval: ({ state }) => {
      const progress = state.data;
      return progress && TERMINAL_STATUSES.has(progress.status) ? false : 1_000;
    },
  });

  useEffect(() => {
    const progress = query.data;
    if (!progress || !TERMINAL_STATUSES.has(progress.status)) return;
    if (settledSessions.current.has(progress.sessionId)) return;
    settledSessions.current.add(progress.sessionId);
    for (const queryKey of [
      ["jobs"],
      ["stats"],
      ["companies"],
      ["match-history"],
      ["unmatched-jobs-count"],
      ...(options.extraInvalidationKeys ?? []),
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
    options.onSettled?.(progress);
  }, [options, query.data, queryClient]);

  return query;
}
