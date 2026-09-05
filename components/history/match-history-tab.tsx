"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, History, Loader2, Sparkles, Timer } from "lucide-react";
import { AIUsageOverview } from "./ai-usage-overview";
import { MatchSessionCard } from "./match-session-card";
import { OverviewCard } from "@/components/history/shared/overview-card";
import {
  formatDurationMs,
  formatRelativeTime,
  groupSessionsByDate,
} from "@/lib/utils/format";
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
    refetchIntervalInBackground: false,
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
      <div className="space-y-6">
        <AIUsageOverview group="matching" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12">
          <Sparkles className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium text-foreground">No match history yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Match jobs from the Settings page to start tracking match history
          </p>
        </div>
      </div>
    );
  }

  const groupedSessions = groupSessionsByDate(sessions);
  // Sessions come back newest-first, so the first row is the latest run overall.
  const lastRunAt = sessions[0]?.startedAt ? new Date(sessions[0].startedAt) : null;

  return (
    <div className="space-y-6">
      <AIUsageOverview group="matching" />

      {/* Summary Stats */}
      {stats && stats.totalSessions > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <OverviewCard
            label="Sessions"
            value={stats.totalSessions}
            icon={History}
            detail={
              lastRunAt ? `Last run ${formatRelativeTime(lastRunAt)}` : undefined
            }
          />
          <OverviewCard
            label="Match rate"
            value={`${stats.successRate}%`}
            icon={CheckCircle2}
            accent="text-emerald-400"
            detail="Share of attempted jobs matched"
          />
          <OverviewCard
            label="Jobs matched"
            value={stats.totalJobsMatched}
            icon={Sparkles}
            accent="text-purple-400"
          />
          <OverviewCard
            label="Avg duration"
            value={formatDurationMs(stats.avgDuration)}
            icon={Timer}
            detail="Per completed session"
          />
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
