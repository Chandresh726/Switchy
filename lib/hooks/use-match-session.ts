"use client";

import { useEffect, useRef } from "react";

import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";

export interface MatchSessionProgress {
  sessionId: string;
  status: string;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  startedAt: string | null;
  completedAt: string | null;
  analysis: MatchPhaseProgress;
  matching: MatchPhaseProgress;
  jobs: MatchJobProgress[];
}

export interface MatchPhaseProgress {
  total: number;
  completed: number;
  active: number;
  queued: number;
  cached: number;
  failed: number;
}

export interface MatchJobProgress {
  jobId: number;
  jobTitle: string;
  companyName: string | null;
  analysisStatus: "queued" | "analyzing" | "ready" | "cached" | "failed";
  matchStatus: "blocked" | "queued" | "matching" | "completed" | "cached" | "failed";
  errorStage: "analysis" | "matching" | null;
  errorCode: string | null;
  errorMessage: string | null;
  analysisStartedAt: string | null;
  analysisCompletedAt: string | null;
  matchStartedAt: string | null;
  matchCompletedAt: string | null;
  updatedAt: string;
}

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
      const response = await fetch(`/api/match/sessions/${encodeURIComponent(sessionId)}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Failed to read match progress");
      return response.json();
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
