"use client";

import Link from "next/link";
import { useState } from "react";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  FileText,
  Loader2,
  Timer,
  Upload,
  XCircle,
} from "lucide-react";

import { AIUsageOverview } from "@/components/history/ai-usage-overview";
import { ResumeHistoryCard } from "@/components/history/resume-history-card";
import { RESUME_HISTORY_POLL_INTERVAL_MS } from "@/components/history/resume-history-state";
import { OverviewCard } from "@/components/history/shared/overview-card";
import { ApiErrorState } from "@/components/ui/api-error-state";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { getResumeHistoryList } from "@/lib/api/clients/history";
import { queryKeys } from "@/lib/query-keys";
import {
  formatDurationMs,
  formatRelativeTime,
  groupSessionsByDate,
} from "@/lib/utils/format";

export function ResumeHistoryTab() {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const offset = (currentPage - 1) * pageSize;
  const query = { limit: pageSize, offset };
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.resumeHistory.list(query),
    queryFn: () => getResumeHistoryList(query),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (
      query.state.data?.entries.some((entry) => entry.parseState === "running")
        ? RESUME_HISTORY_POLL_INTERVAL_MS
        : false
    ),
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
        fallbackMessage="Resume parse history could not be loaded."
        onRetry={() => void refetch()}
      />
    );
  }

  const entries = data?.entries ?? [];
  const stats = data?.stats;
  const totalCount = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  if (totalCount === 0) {
    return (
      <div className="space-y-6">
        <AIUsageOverview group="profile" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12">
          <FileText className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium text-foreground">
            No resume uploads yet
          </h3>
          <p className="mt-1 max-w-md text-center text-sm text-muted-foreground">
            Upload a resume on your profile to see every upload and parse
            attempt, the data the model extracted, and what it cost
          </p>
          <Link href="/profile" className="mt-6">
            <Button variant="outline" className="border-border hover:bg-muted">
              <Upload className="mr-2 h-4 w-4" />
              Go to Profile
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Date grouping is shared with the other history tabs, which key off session
  // timestamps rather than a single created-at field.
  const groupedEntries = groupSessionsByDate(entries.map((entry) => ({
    ...entry,
    startedAt: entry.createdAt ? new Date(entry.createdAt) : null,
    completedAt: null,
  })));
  const lastUploadAt = stats?.lastUploadAt ? new Date(stats.lastUploadAt) : null;

  return (
    <div className="space-y-6">
      <AIUsageOverview group="profile" />

      {stats ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <OverviewCard
            label="Uploads"
            value={stats.totalUploads}
            icon={FileText}
            detail={
              lastUploadAt
                ? `Last upload ${formatRelativeTime(lastUploadAt)}`
                : undefined
            }
          />
          <OverviewCard
            label="Parse rate"
            value={`${stats.successRate}%`}
            icon={CheckCircle2}
            accent="text-emerald-400"
            detail="Share of parse runs that succeeded"
          />
          <OverviewCard
            label="Failed parses"
            value={stats.failedParses}
            icon={XCircle}
            accent={stats.failedParses > 0 ? "text-red-400" : undefined}
            detail={
              stats.uploadOnly > 0
                ? `${stats.uploadOnly} uploaded without autofill`
                : undefined
            }
          />
          <OverviewCard
            label="Avg duration"
            value={formatDurationMs(stats.avgDuration)}
            icon={Timer}
            detail="Per completed parse run"
          />
        </div>
      ) : null}

      {Array.from(groupedEntries.entries()).map(([date, dateEntries]) => (
        <div key={date} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h3 className="sticky top-0 z-10 mb-3 border-b border-border/60 bg-background/95 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground backdrop-blur-sm supports-backdrop-filter:bg-background/80">
            {date}
          </h3>
          <div className="space-y-3">
            {dateEntries.map((entry) => (
              <ResumeHistoryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      ))}

      {totalPages > 1 ? (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={pageSize}
          ariaLabel="Resume history pagination"
          itemLabel="entries"
          isFetching={isFetching}
          onPageChange={setCurrentPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setCurrentPage(1);
          }}
          pageSizeOptions={[10, 20, 50]}
        />
      ) : null}
    </div>
  );
}
