"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface UseStopSessionOptions {
  sessionId: string;
  apiEndpoint: string;
  queryKey: string;
  sessionType: "scrape" | "match";
}

export function useStopSession({
  sessionId,
  apiEndpoint,
  queryKey,
  sessionType,
}: UseStopSessionOptions) {
  const queryClient = useQueryClient();

  const markSessionStoppedInCache = () => {
    const now = new Date();

    queryClient.setQueryData([queryKey], (old: { sessions?: Record<string, unknown>[] } | undefined) => {
      if (!old?.sessions) return old;
      return {
        ...old,
        sessions: old.sessions.map((item) =>
          item.id === sessionId
            ? { ...item, status: "failed", completedAt: now }
            : item
        ),
      };
    });

    queryClient.setQueryData([queryKey, sessionId], (old: { session?: unknown } | undefined) => {
      if (!old?.session) return old;
      return {
        ...old,
        session: {
          ...(old.session as object),
          status: "failed",
          completedAt: now,
        },
      };
    });
  };

  const mutation = useMutation({
    mutationFn: async () => {
      markSessionStoppedInCache();

      const res = await fetch(`${apiEndpoint}?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
      });

      if (!res.ok) throw new Error("Failed to stop session");
      return res.json();
    },
    onSuccess: () => {
      toast.success(`Stopping ${sessionType} session`);
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      queryClient.invalidateQueries({ queryKey: [queryKey, sessionId] });
    },
    onError: () => {
      toast.error(`Failed to stop ${sessionType} session`);
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      queryClient.invalidateQueries({ queryKey: [queryKey, sessionId] });
    },
  });

  return {
    stopSession: mutation.mutate,
    isStopping: mutation.isPending,
    ...mutation,
  };
}
