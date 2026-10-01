"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getSchedulerHost, syncSchedulerHost } from "@/lib/api/clients/runtime";
import type { SchedulerHostStatusResponse } from "@/lib/api/contracts/runtime";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

interface SchedulerHostBadgeProps {
  className?: string;
}

/**
 * Surfaces missing macOS host agents with a one-click reinstall when their
 * plists were removed out-of-band.
 */
export function SchedulerHostBadge({ className }: SchedulerHostBadgeProps) {
  const queryClient = useQueryClient();
  const { data: host, isLoading } = useQuery<SchedulerHostStatusResponse>({
    queryKey: queryKeys.runtime.schedulerHost(),
    queryFn: getSchedulerHost,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });
  const reinstallMutation = useMutation({
    mutationFn: () => syncSchedulerHost("sync"),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runtime.schedulerHost() });
    },
  });

  if (isLoading || !host) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        Checking background service...
      </span>
    );
  }

  if (!host.supported) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        Background service runs while the app server is up
      </span>
    );
  }

  const installed = host.tickAgentInstalled
    && (!host.serverAgentSupported || host.serverAgentInstalled);

  if (installed) {
    return null;
  }

  return (
    <span className={cn("flex items-center gap-2 text-xs", className)}>
      <span className="text-amber-400">
        Background service not installed: runs only while app server is up
      </span>
      <button
        type="button"
        disabled={reinstallMutation.isPending}
        onClick={() => reinstallMutation.mutate()}
        className="underline underline-offset-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        {reinstallMutation.isPending ? "Installing..." : "Install"}
      </button>
    </span>
  );
}
