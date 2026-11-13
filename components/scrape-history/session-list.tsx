"use client";

import { useQuery } from "@tanstack/react-query";
import { Briefcase, CheckCircle2, History, Loader2, Timer } from "lucide-react";

import { SessionCard } from "./session-card";
import { SessionGroups } from "@/components/history/shared/session-groups";
import { OverviewCard } from "@/components/history/shared/overview-card";
import {
  formatDurationMs,
  formatRelativeTime,
} from "@/lib/utils/format";
import { getScrapeHistoryList } from "@/lib/api/clients/history";
import { queryKeys } from "@/lib/query-keys";
import { historyPollingInterval } from "@/lib/hooks/history-polling";
import { ApiErrorState } from "@/components/ui/api-error-state";

export function SessionList() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.scrapeHistory.list(),
    queryFn: async () => {
      return getScrapeHistoryList();
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
        fallbackMessage="Scrape history could not be loaded."
        onRetry={() => void refetch()}
      />
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


  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      {stats && stats.totalSessions > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <OverviewCard
            label="Scrapes"
            value={stats.totalSessions}
            icon={History}
            detail={
              stats.lastRunAt
                ? `Last run ${formatRelativeTime(new Date(stats.lastRunAt))}`
                : undefined
            }
          />
          <OverviewCard
            label="Success rate"
            value={`${stats.successRate}%`}
            icon={CheckCircle2}
            accent="text-emerald-400"
            detail={`${stats.completedSessions} completed · ${stats.failedSessions} failed`}
          />
          <OverviewCard
            label="Jobs found"
            value={stats.totalJobsFound}
            icon={Briefcase}
            detail={`${stats.totalJobsAdded} new jobs added`}
          />
          <OverviewCard
            label="Avg duration"
            value={formatDurationMs(stats.avgDuration)}
            icon={Timer}
            detail={`${stats.companiesScraped} companies scraped`}
          />
        </div>
      )}

      <SessionGroups
        sessions={sessions}
        renderSession={(session) => <SessionCard key={session.id} session={session} />}
      />
    </div>
  );
}
