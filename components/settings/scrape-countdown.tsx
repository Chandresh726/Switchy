"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface SchedulerStatus {
  isActive: boolean;
  lastRun: string | null;
  nextRun: string | null;
  frequencyHours: number;
  cronExpression: string;
}

interface ScrapeCountdownProps {
  className?: string;
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return "Now";

  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

export function ScrapeCountdown({ className }: ScrapeCountdownProps) {
  // Fetch scheduler status every 30 seconds to keep countdown accurate
  const { data: status, isLoading } = useQuery<SchedulerStatus>({
    queryKey: ["scheduler-status"],
    queryFn: async () => {
      const res = await fetch("/api/scheduler/status");
      if (!res.ok) throw new Error("Failed to fetch scheduler status");
      return res.json();
    },
    refetchInterval: 30000, // Refetch every 30 seconds
    staleTime: 10000, // Consider data fresh for 10 seconds
  });

  // Calculate remaining time based on server-provided nextRun
  const calculateRemainingMs = useCallback(() => {
    if (!status?.nextRun) return null;
    const nextRun = new Date(status.nextRun).getTime();
    const now = Date.now();
    return Math.max(0, nextRun - now);
  }, [status]);

  // Local countdown state - updates every second for smooth UI
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  // Initialize and update countdown
  useEffect(() => {
    // Update every second for smooth countdown display
    const interval = setInterval(() => {
      setRemainingMs(calculateRemainingMs());
    }, 1000);

    // Initial calculation via timeout to avoid synchronous setState
    const timeout = setTimeout(() => {
      setRemainingMs(calculateRemainingMs());
    }, 0);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [calculateRemainingMs]);

  // Determine visual state
  const visualState = useMemo(() => {
    if (!status?.isActive) return "inactive";
    if (!remainingMs || remainingMs <= 0) return "now";
    if (remainingMs < 5 * 60 * 1000) return "soon"; // Less than 5 minutes
    return "normal";
  }, [status?.isActive, remainingMs]);

  // Content based on state
  const content = useMemo(() => {
    if (isLoading) {
      return {
        icon: Clock,
        text: "Loading...",
        className: "text-zinc-500",
      };
    }

    if (!status?.isActive) {
      return {
        icon: AlertCircle,
        text: "Scheduler inactive",
        className: "text-yellow-500",
      };
    }

    if (!status.nextRun) {
      return {
        icon: Clock,
        text: "Waiting for first run",
        className: "text-zinc-400",
      };
    }

    return {
      icon: Clock,
      text: remainingMs && remainingMs > 0
        ? `Next scrape in ${formatTimeRemaining(remainingMs)}`
        : "Scraping now...",
      className: cn(
        visualState === "soon" && "text-orange-400 animate-pulse",
        visualState === "now" && "text-emerald-400",
        visualState === "normal" && "text-zinc-400"
      ),
    };
  }, [isLoading, status, remainingMs, visualState]);

  const Icon = content.icon;

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-sm",
        content.className,
        className
      )}
      title={status?.isActive ? `Runs ${status.cronExpression}` : "Scheduler is not running"}
    >
      <Icon className="h-4 w-4" />
      <span className="tabular-nums">{content.text}</span>
    </div>
  );
}
