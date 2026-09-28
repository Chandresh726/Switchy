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
 * Read-only indicator that the scraper schedule is backend-owned.
 * The UI never schedules work; this badge only surfaces whether the macOS
 * host agents keep the backend alive with no tab open, with a one-click
 * reinstall when the plists were removed out-of-band.
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

  const installed = host.serverAgentInstalled && host.tickAgentInstalled;
  return (
    <span className={cn("flex items-center gap-2 text-xs", className)}>
      <span className={installed ? "text-emerald-400" : "text-amber-400"}>
        {installed
          ? "Background service installed: runs with UI closed"
          : "Background service not installed: runs only while app server is up"}
      </span>
      {!installed && (
        <button
          type="button"
          disabled={reinstallMutation.isPending}
          onClick={() => reinstallMutation.mutate()}
          className="underline underline-offset-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {reinstallMutation.isPending ? "Installing..." : "Install"}
        </button>
      )}
    </span>
  );
}
