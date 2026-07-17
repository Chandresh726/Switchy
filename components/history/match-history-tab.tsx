"use client";

import { useQuery } from "@tanstack/react-query";
import { MatchSessionCard } from "./match-session-card";
import { Loader2, Sparkles } from "lucide-react";
import { formatDurationMs, groupSessionsByDate } from "@/lib/utils/format";
import { getMatchHistoryList } from "@/lib/api/clients/history";
import { queryKeys } from "@/lib/query-keys";
import { historyPollingInterval } from "@/lib/hooks/history-polling";
import { ApiErrorState } from "@/components/ui/api-error-state";

export function MatchHistoryTab() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.matchHistory.list(),
    queryFn: async () => {
      return getMatchHistoryList();
    },
    refetchInterval: (query) => {
      const sessions = query.state.data?.sessions || [];
      return historyPollingInterval(sessions);
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
      <ApiErrorState
        error={error}
        fallbackMessage="Match history could not be loaded."
        onRetry={() => void refetch()}
      />
    );
  }

  const sessions = data?.sessions || [];
  const stats = data?.stats;

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12">
        <Sparkles className="h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-medium text-foreground">No match history yet</h3>
        <p className="mt-1 text-sm text-muted-foreground">
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
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-2xl font-semibold text-foreground">{stats.totalSessions}</p>
            <p className="text-sm text-muted-foreground">Total Sessions</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">{stats.successRate}%</p>
            <p className="text-sm text-muted-foreground">Success Rate</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-2xl font-semibold text-foreground">{formatDurationMs(stats.avgDuration)}</p>
            <p className="text-sm text-muted-foreground">Avg Duration</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-2xl font-semibold text-purple-600 dark:text-purple-400">{stats.totalJobsMatched}</p>
            <p className="text-sm text-muted-foreground">Jobs Matched</p>
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
              <MatchSessionCard key={session.id} session={session} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
