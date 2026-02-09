"use client";

import { useQuery } from "@tanstack/react-query";
import { MatchSessionCard } from "./match-session-card";
import { Loader2, Sparkles } from "lucide-react";

interface MatchSession {
  id: string;
  triggerSource: string;
  companyId: number | null;
  companyName: string | null;
  status: string;
  jobsTotal: number | null;
  jobsCompleted: number | null;
  jobsSucceeded: number | null;
  jobsFailed: number | null;
  errorCount: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface MatchHistoryResponse {
  sessions: MatchSession[];
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
    totalJobsMatched: number;
  };
}

function formatDurationMs(ms: number): string {
  if (!ms || ms <= 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function groupSessionsByDate(sessions: MatchSession[]): Map<string, MatchSession[]> {
  const groups = new Map<string, MatchSession[]>();
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

export function MatchHistoryTab() {
  const { data, isLoading, error } = useQuery<MatchHistoryResponse>({
    queryKey: ["match-history"],
    queryFn: async () => {
      const res = await fetch("/api/match-history");
      if (!res.ok) throw new Error("Failed to fetch match history");
      return res.json();
    },
    refetchInterval: (query) => {
      // Refresh every 2 seconds if any session is in progress
      const sessions = query.state.data?.sessions || [];
      const hasInProgress = sessions.some((s) => s.status === "in_progress");
      return hasInProgress ? 2000 : false;
    },
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
        <p className="text-sm text-red-400">Failed to load match history</p>
      </div>
    );
  }

  const sessions = data?.sessions || [];
  const stats = data?.stats;

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700 py-12">
        <Sparkles className="h-12 w-12 text-zinc-600" />
        <h3 className="mt-4 text-lg font-medium text-white">No match history yet</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Match jobs from the Settings page to start tracking match history
        </p>
      </div>
    );
  }

  const groupedSessions = groupSessionsByDate(sessions);

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      {stats && stats.totalSessions > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-2xl font-semibold text-white">{stats.totalSessions}</p>
            <p className="text-sm text-zinc-400">Total Sessions</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-2xl font-semibold text-emerald-400">{stats.successRate}%</p>
            <p className="text-sm text-zinc-400">Success Rate</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-2xl font-semibold text-white">{formatDurationMs(stats.avgDuration)}</p>
            <p className="text-sm text-zinc-400">Avg Duration</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-2xl font-semibold text-purple-400">{stats.totalJobsMatched}</p>
            <p className="text-sm text-zinc-400">Jobs Matched</p>
          </div>
        </div>
      )}

      {/* Sessions grouped by date */}
      {Array.from(groupedSessions.entries()).map(([date, dateSessions]) => (
        <div key={date} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500 sticky top-0 bg-black/50 backdrop-blur-sm py-2 z-10">{date}</h3>
          <div className="space-y-3">
            {dateSessions.map((session) => (
              <MatchSessionCard key={session.id} session={session} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
