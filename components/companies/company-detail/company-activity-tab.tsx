"use client";

import { useMemo } from "react";
import { Activity, Building2, Sparkles, Clock, Target, Plus, CheckCircle, XCircle, Play } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatRelativeTime, formatDurationFromDates, formatDate, formatTime } from "@/lib/utils/format";
import { getSessionStatusConfig } from "@/lib/utils/status-config";
import { TRIGGER_LABELS } from "@/components/scrape-history/constants";

import type { ActivityItem, CompanyActivity } from "./types";

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

interface CompanyActivityTabProps {
  activity: CompanyActivity;
}

export function CompanyActivityTab({ activity }: CompanyActivityTabProps) {
  const activityFeed = useMemo(() => {
    const scrapeItems = activity.scrapeLogs.map((log) => ({
      id: String(log.id),
      type: "scrape" as const,
      data: log,
      startedAt: log.startedAt,
      completedAt: log.completedAt,
    }));

    const matchItems = activity.matchSessions.map((session) => ({
      id: session.id,
      type: "match" as const,
      data: session,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
    }));

    return [...scrapeItems, ...matchItems].sort((a, b) => {
      const aDate = parseDate(a.startedAt) || parseDate(a.completedAt);
      const bDate = parseDate(b.startedAt) || parseDate(b.completedAt);
      return (bDate?.getTime() || 0) - (aDate?.getTime() || 0);
    });
  }, [activity]);

  if (activityFeed.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No activity yet"
        description="Run a scrape or match to see activity for this company."
      />
    );
  }

  return (
    <div className="space-y-3">
      {activityFeed.map((item) => {
        const isScrape = item.type === "scrape";
        const statusConfig = getSessionStatusConfig(item.data.status);
        const StatusIcon = statusConfig.icon;

        const startedDate = parseDate(item.startedAt);
        const completedDate = parseDate(item.completedAt);

        const scrapeData = isScrape ? item.data as any : null;
        const matchData = !isScrape ? item.data as any : null;

        const triggerSource = item.data.triggerSource || "manual";

        return (
          <div
            key={`${item.type}-${item.id}`}
            className="block rounded-lg border border-border bg-card p-4 transition-all hover:border-border/80"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${statusConfig.bgColor}`}>
                  {isScrape ? (
                    <Building2 className={`h-5 w-5 ${statusConfig.color}`} />
                  ) : (
                    <Sparkles className={`h-5 w-5 ${statusConfig.color}`} />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-foreground">
                      {isScrape ? "Scrape Run" : "Match Session"}
                    </h3>
                  </div>

                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    {startedDate ? (
                      <>
                        <span>{formatDate(startedDate)}</span>
                        <span className="text-muted-foreground/50">at</span>
                        <span>{formatTime(startedDate)}</span>
                      </>
                    ) : (
                      <span>Unknown date</span>
                    )}

                    <span className="text-muted-foreground/50">•</span>

                    <span className="flex items-center gap-1">
                      <Play className="h-3 w-3" />
                      {TRIGGER_LABELS[triggerSource] || triggerSource}
                    </span>
                  </div>
                </div>
              </div>

              {/* Top Right Actions / Status */}
              <div>
                <Badge
                  variant="outline"
                  className={`${statusConfig.color} ${statusConfig.bgColor} border-transparent text-[10px] h-5 px-1.5`}
                >
                  {statusConfig.label}
                </Badge>
              </div>
            </div>

            {/* Meta Stats */}
            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              {isScrape ? (
                <>
                  <span className="flex items-center gap-1.5">
                    <Target className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-foreground/80 font-medium">{scrapeData?.jobsFound || 0}</span> Found
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Plus className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">{scrapeData?.jobsAdded || 0}</span> Added
                  </span>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1.5">
                    <Target className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-foreground/80 font-medium">{matchData?.jobsTotal || 0}</span> Total
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">{matchData?.jobsSucceeded || 0}</span> Success
                  </span>
                  {(matchData?.jobsFailed || 0) > 0 && (
                    <span className="flex items-center gap-1.5">
                      <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                      <span className="font-medium text-red-600 dark:text-red-400">{matchData?.jobsFailed || 0}</span> Failed
                    </span>
                  )}
                </>
              )}

              <div className="ml-auto flex items-center gap-3">
                {item.data.status !== "queued" && startedDate && (
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    {formatDurationFromDates(startedDate, completedDate)}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
