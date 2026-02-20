"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface SchedulerStatus {
  isActive: boolean;
  isRunning: boolean;
  isEnabled: boolean;
  lastRun: string | null;
  nextRun: string | null;
  cronExpression: string;
}

interface ScrapeCountdownProps {
  className?: string;
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return "now";

  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function ScrapeCountdown({ className }: ScrapeCountdownProps) {
  const { data: status, isLoading, isError, refetch } = useQuery<SchedulerStatus>({
    queryKey: ["scheduler-status"],
    queryFn: async () => {
      const res = await fetch("/api/scheduler/status");
      if (!res.ok) throw new Error("Failed to fetch scheduler status");
      return res.json();
    },
    refetchInterval: 10000,
    staleTime: 5000,
  });

  const getRemainingMs = useCallback(() => {
    if (!status?.nextRun) return null;
    const nextRun = new Date(status.nextRun).getTime();
    return Math.max(0, nextRun - Date.now());
  }, [status]);

  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    const update = () => {
      const ms = getRemainingMs();
      setRemainingMs(ms);
      if (ms !== null && ms <= 0 && !status?.isRunning) {
        refetch();
      }
    };
    update();

    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [getRemainingMs, refetch, status?.isRunning]);

  if (isLoading) {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-zinc-500", className)}>
        <Clock className="h-4 w-4" />
        <span>Loading...</span>
      </div>
    );
  }

  if (isError || !status) {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-yellow-500", className)}>
        <AlertCircle className="h-4 w-4" />
        <span>Scheduler status unavailable</span>
      </div>
    );
  }

  if (!status.isEnabled) {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-zinc-500", className)}>
        <Clock className="h-4 w-4" />
        <span>Auto-scrape off</span>
      </div>
    );
  }

  if (!status.isActive) {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-yellow-500", className)}>
        <AlertCircle className="h-4 w-4" />
        <span>Scheduler inactive</span>
      </div>
    );
  }

  if (status.isRunning) {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-emerald-400", className)}>
        <Clock className="h-4 w-4 animate-spin" />
        <span>Scraping now...</span>
      </div>
    );
  }

  if (remainingMs !== null && remainingMs > 0) {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-zinc-400", className)}>
        <Clock className="h-4 w-4" />
        <span className="tabular-nums">Next: {formatTimeRemaining(remainingMs)}</span>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2 text-sm text-zinc-500", className)}>
      <Clock className="h-4 w-4" />
      <span>Calculating...</span>
    </div>
  );
}
