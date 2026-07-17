"use client";

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";

import { queueJobMatch } from "@/lib/api/clients/runtime";

import { useMatchSession } from "./use-match-session";

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
      return queueJobMatch(jobId);
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
