"use client";

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { queueJobMatch } from "@/lib/api/clients/runtime";
import { getApiErrorMessage } from "@/lib/api/error-presentation";

import { useMatchSession } from "./use-match-session";

interface UseQueuedJobMatchOptions {
  jobId: number;
}

export function useQueuedJobMatch({
  jobId,
}: UseQueuedJobMatchOptions) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const session = useMatchSession(sessionId, {
    onSettled: () => setSessionId(null),
  });
  const mutation = useMutation({
    mutationFn: async () => {
      return queueJobMatch(jobId);
    },
    onSuccess: (queued) => setSessionId(queued.sessionId),
    onError: (error) => toast.error(getApiErrorMessage(error, "Failed to queue job matching")),
  });

  return {
    mutation,
    session,
    sessionId,
    isMatching: mutation.isPending || sessionId !== null,
  };
}
