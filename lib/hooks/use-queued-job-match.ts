"use client";

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";

import { APP_REQUEST_HEADERS } from "@/lib/api/request-headers";

import { useMatchSession } from "./use-match-session";

interface QueuedMatchResponse {
  sessionId: string;
  status: "queued";
  total: number;
}

interface UseQueuedJobMatchOptions {
  jobId: number;
  extraInvalidationKeys?: Array<readonly unknown[]>;
}

export function useQueuedJobMatch({
  jobId,
  extraInvalidationKeys,
}: UseQueuedJobMatchOptions) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const session = useMatchSession(sessionId, {
    extraInvalidationKeys,
    onSettled: () => setSessionId(null),
  });
  const mutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...APP_REQUEST_HEADERS },
        body: JSON.stringify({ jobId }),
      });
      if (!response.ok) throw new Error("Failed to calculate match");
      return response.json() as Promise<QueuedMatchResponse>;
    },
    onSuccess: (queued) => setSessionId(queued.sessionId),
  });

  return {
    mutation,
    session,
    sessionId,
    isMatching: mutation.isPending || sessionId !== null,
  };
}
