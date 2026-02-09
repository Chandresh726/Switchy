"use client";

import { useQuery } from "@tanstack/react-query";
import { SessionCard } from "./session-card";
import { Loader2, History } from "lucide-react";

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

function formatDurationMs(ms: number): string {
  if (!ms || ms <= 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function groupSessionsByDate(sessions: ScrapeSession[]): Map<string, ScrapeSession[]> {
  const groups = new Map<string, ScrapeSession[]>();
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const session of sessions) {
    if (!session.startedAt) continue;

    const sessionDate = new Date(session.startedAt);
    let label: string;

    if (sessionDate.toDateString() === today.toDateString()) {
      label = "Today";
    } else if (sessionDate.toDateString() === yesterday.toDateString()) {
      label = "Yesterday";
    } else {
      label = sessionDate.toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
    }

    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label)!.push(session);
  }

  return groups;
}

export function SessionList() {
  const { data, isLoading, error } = useQuery<HistoryResponse>({
    queryKey: ["scrape-history"],
    queryFn: async () => {
      const res = await fetch("/api/scrape-history");
      if (!res.ok) throw new Error("Failed to fetch scrape history");
      return res.json();
    },
    refetchInterval: 5000, // Refresh every 5 seconds to show progress updates
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-center">
        <p className="text-sm text-red-400">Failed to load scrape history</p>
      </div>
    );
  }

  const sessions = data?.sessions || [];
  const stats = data?.stats;

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700 py-12">
        <History className="h-12 w-12 text-zinc-600" />
        <h3 className="mt-4 text-lg font-medium text-white">No scrape history yet</h3>
        <p className="mt-1 text-sm text-zinc-400">
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
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-2xl font-semibold text-white">{stats.totalSessions}</p>
            <p className="text-sm text-zinc-400">Total Scrapes</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-2xl font-semibold text-emerald-400">{stats.successRate}%</p>
            <p className="text-sm text-zinc-400">Success Rate</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-2xl font-semibold text-white">{formatDurationMs(stats.avgDuration)}</p>
            <p className="text-sm text-zinc-400">Avg Duration</p>
          </div>
        </div>
      )}

      {/* Sessions grouped by date */}
      {Array.from(groupedSessions.entries()).map(([date, dateSessions]) => (
        <div key={date}>
          <h3 className="mb-3 text-sm font-medium text-zinc-400">{date}</h3>
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
