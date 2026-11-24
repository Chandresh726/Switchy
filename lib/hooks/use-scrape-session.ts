"use client";

import { useEffect, useRef } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getScrapeSessionProgress } from "@/lib/api/clients/runtime";
import type { ScrapeSessionProgress } from "@/lib/api/contracts/runtime";
import { cacheOwnership } from "@/lib/query-keys";

import { sessionPollingInterval } from "./history-polling";

export function useScrapeSession(sessionId: string | null, onSettled?: (progress: ScrapeSessionProgress) => void) {
  const client = useQueryClient();
  const settled = useRef(new Set<string>());
  const callback = useRef(onSettled);
  useEffect(() => { callback.current = onSettled; }, [onSettled]);
  const query = useQuery({
    queryKey: ["runtime", "scrape-session", sessionId],
    queryFn: () => getScrapeSessionProgress(sessionId!),
    enabled: Boolean(sessionId),
    refetchInterval: ({ state }) => sessionPollingInterval(state.data),
  });
  useEffect(() => {
    const progress = query.data;
    if (!progress || sessionPollingInterval(progress) !== false || settled.current.has(progress.sessionId)) return;
    settled.current.add(progress.sessionId);
    void cacheOwnership.updateScrapeHistoryStatus(client);
    callback.current?.(progress);
  }, [client, query.data]);
  return query;
}
