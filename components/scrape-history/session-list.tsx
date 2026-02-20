"use client";

import { useQuery } from "@tanstack/react-query";
import { SessionCard } from "./session-card";
import { Loader2, History } from "lucide-react";
import { formatDurationMs, groupSessionsByDate } from "@/lib/utils/format";

interface ScrapeSession {
  id: string;
  triggerSource: string;
  status: string;
  companiesTotal: number | null;
  companiesCompleted: number | null;
  totalJobsFound: number | null;
  totalJobsAdded: number | null;
  totalJobsFiltered: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface HistoryResponse {
  sessions: ScrapeSession[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  stats: {
    totalSessions: number;
    successRate: number;
    avgDuration: number;
  };
}

export function SessionList() {
  const { data, isLoading, error } = useQuery<HistoryResponse>({
    queryKey: ["scrape-history"],
    queryFn: async () => {
      const res = await fetch("/api/scrape-history", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch scrape history");
      return res.json();
    },
    refetchInterval: (query) => {
      const sessions = query.state.data?.sessions || [];
      const hasInProgress = sessions.some((s) => s.status === "in_progress");
      return hasInProgress ? 1000 : 5000;
    },
    refetchIntervalInBackground: true,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load scrape history</p>
      </div>
    );
  }

  const sessions = data?.sessions || [];
  const stats = data?.stats;

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12">
        <History className="h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-medium text-foreground">No scrape history yet</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Refresh jobs from the Companies page to start tracking scrape history
        </p>
      </div>
    );
  }

  const groupedSessions = groupSessionsByDate(sessions);

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      {stats && stats.totalSessions > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-2xl font-semibold text-foreground">{stats.totalSessions}</p>
            <p className="text-sm text-muted-foreground">Total Scrapes</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">{stats.successRate}%</p>
            <p className="text-sm text-muted-foreground">Success Rate</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-2xl font-semibold text-foreground">{formatDurationMs(stats.avgDuration)}</p>
            <p className="text-sm text-muted-foreground">Avg Duration</p>
          </div>
        </div>
      )}

      {/* Sessions grouped by date */}
      {Array.from(groupedSessions.entries()).map(([date, dateSessions]) => (
        <div key={date} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h3 className="sticky top-0 z-10 mb-3 border-b border-border/60 bg-background/95 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground backdrop-blur-sm supports-backdrop-filter:bg-background/80">
            {date}
          </h3>
          <div className="space-y-3">
            {dateSessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
