"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Briefcase,
  CheckCircle2,
  History,
  Loader2,
  Timer,
  type LucideIcon,
} from "lucide-react";

import { SessionCard } from "./session-card";
import { cn } from "@/lib/utils";
import {
  formatDurationMs,
  formatRelativeTime,
  groupSessionsByDate,
} from "@/lib/utils/format";
import { getScrapeHistoryList } from "@/lib/api/clients/history";
import { queryKeys } from "@/lib/query-keys";
import { historyPollingInterval } from "@/lib/hooks/history-polling";
import { ApiErrorState } from "@/components/ui/api-error-state";

function OverviewCard({
  label,
  value,
  detail,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  detail?: string;
  icon: LucideIcon;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {label}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold leading-none tabular-nums text-foreground",
          accent
        )}
      >
        {value}
      </p>
      {detail && (
        <p className="mt-2 truncate text-xs text-muted-foreground">{detail}</p>
      )}
    </div>
  );
}

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

  const groupedSessions = groupSessionsByDate(sessions);

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
