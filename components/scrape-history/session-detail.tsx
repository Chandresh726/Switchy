"use client";

import { useState } from "react";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  Briefcase,
  Building2,
  Filter,
  Loader2,
  Plus,
  Square,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiErrorState } from "@/components/ui/api-error-state";
import { Pagination } from "@/components/ui/pagination";
import {
  getScrapeHistoryDetail,
  cancelScrapeHistorySession,
  deleteScrapeHistorySession,
} from "@/lib/api/clients/history";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/utils/format";
import { getSessionStatusConfig } from "@/lib/utils/status-config";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/error-presentation";

import { CompanyProgressList } from "./company-progress-list";
import { TRIGGER_LABELS } from "./constants";

interface SessionDetailProps {
  sessionId: string;
}

function SummaryStat({
  value,
  label,
  icon: Icon,
  accent,
}: {
  value: string | number;
  label: string;
  icon: LucideIcon;
  accent?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 text-muted-foreground",
          accent && "text-emerald-400"
        )}
      />
      <span
        className={cn(
          "text-lg font-semibold leading-none tabular-nums text-foreground",
          accent && "text-emerald-400"
        )}
      >
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

export function SessionDetail({ sessionId }: SessionDetailProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const router = useRouter();
  const queryClient = useQueryClient();
  const offset = (currentPage - 1) * pageSize;
  const detailParams = {
    logOffset: offset,
    logLimit: pageSize,
    workOffset: offset,
    workLimit: pageSize,
  };
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.scrapeHistory.detail(sessionId, detailParams),
    queryFn: async () => {
      return getScrapeHistoryDetail(sessionId, detailParams);
    },
    refetchInterval: (query) => {
      const session = query.state.data?.session;
      if (!session) return 1000;
      return session.status === "in_progress" || query.state.data?.hasActiveWork ? 1000 : false;
    },
    refetchIntervalInBackground: true,
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      return cancelScrapeHistorySession(sessionId);
    },
    onSuccess: () => {
      toast.success("Stopping scrape session");
      void cacheOwnership.updateScrapeHistoryStatus(queryClient);
    },
    onError: (mutationError) => {
      toast.error(getApiErrorMessage(mutationError, "Failed to stop scrape session"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return deleteScrapeHistorySession(sessionId);
    },
    onSuccess: () => {
      void cacheOwnership.clearScrapeHistory(queryClient);
      router.push("/history/scrape");
    },
    onError: (mutationError) => {
      toast.error(getApiErrorMessage(mutationError, "Failed to delete scrape session"));
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <ApiErrorState
          error={error}
          fallbackMessage="Scrape session details could not be loaded."
          onRetry={() => void refetch()}
        />
        <Link href="/history">
          <Button variant="ghost" className="mt-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to History
          </Button>
        </Link>
      </div>
    );
  }

  const { session, logs, logPagination, workPagination, hasActiveWork, queueItems } = data;
  const sessionStatusConfig = getSessionStatusConfig(session.status);
  const SessionStatusIcon = sessionStatusConfig.icon;
  const sessionDisplayTime = session.scheduledForAt ? new Date(session.scheduledForAt) : session.startedAt;
  const progress = session.companiesTotal
    ? Math.round(((session.companiesCompleted || 0) / session.companiesTotal) * 100)
    : 0;
  const hasActiveQueueWork = hasActiveWork;
  const hasJobStats = [
    session.totalJobsFound,
    session.totalJobsAdded,
    session.totalJobsFiltered,
    session.totalJobsArchived,
  ].some((value) => (value ?? 0) > 0);
  const totalRecords = Math.max(workPagination.total, logPagination.total);
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  return (
    <div className="space-y-6">
      {/* Header Navigation */}
      <div className="flex items-center justify-between">
        <Link href="/history/scrape">
          <Button variant="ghost" className="text-muted-foreground hover:text-foreground -ml-2 pl-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to History
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          {session.status === "in_progress" && (
            <Button
              variant="outline"
              size="sm"
              className="border-amber-500/20 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
            >
              <Square className="mr-2 h-4 w-4" />
              {stopMutation.isPending ? "Stopping..." : "Stop Session"}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="border-red-500/20 text-red-400 hover:bg-red-500/10 hover:text-red-300"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending || session.status === "in_progress" || hasActiveQueueWork}
            title={hasActiveQueueWork ? "Wait for running queue work to stop" : undefined}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {deleteMutation.isPending ? "Deleting..." : "Delete Session"}
          </Button>
        </div>
      </div>

      {/* Session Overview Card */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-start justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
                sessionStatusConfig.bgColor
              )}
            >
              <SessionStatusIcon className={cn("h-5 w-5", sessionStatusConfig.color)} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-foreground">
                Scrape Session
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span>{formatDateTime(sessionDisplayTime)}</span>
                <span aria-hidden className="text-border">
                  &middot;
                </span>
                <span>{TRIGGER_LABELS[session.triggerSource] || session.triggerSource}</span>
              </div>
            </div>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-md border border-transparent px-3 py-1 text-xs font-medium",
              sessionStatusConfig.color,
              sessionStatusConfig.bgColor
            )}
          >
            {sessionStatusConfig.label}
          </span>
        </div>

        {session.skipReason && (
          <div className="mx-5 mb-5 rounded-md border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            {session.skipReason}
          </div>
        )}

        {/* Progress Bar */}
        {session.status === "in_progress" && (
          <div className="border-t border-border/60 px-5 py-3">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>Processing Companies...</span>
              <span className="tabular-nums">{progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Summary Stats */}
        <div className="flex flex-wrap items-center gap-x-7 gap-y-2.5 border-t border-border/60 px-5 py-3.5">
          <SummaryStat
            value={`${session.companiesCompleted || 0}/${session.companiesTotal || 0}`}
            label="companies"
            icon={Building2}
          />
          {hasJobStats && (
            <>
              <SummaryStat
                value={session.totalJobsFound || 0}
                label="jobs found"
                icon={Briefcase}
              />
              <SummaryStat
                value={session.totalJobsAdded || 0}
                label="new"
                icon={Plus}
                accent={(session.totalJobsAdded || 0) > 0}
              />
              <SummaryStat
                value={session.totalJobsFiltered || 0}
                label="filtered"
                icon={Filter}
              />
              <SummaryStat
                value={session.totalJobsArchived || 0}
                label="archived"
                icon={Archive}
              />
            </>
          )}
        </div>
      </div>

      <CompanyProgressList queueItems={queueItems} logs={logs} />
      {totalPages > 1 && (
        <Pagination
          ariaLabel="Session records pagination"
          itemLabel="session records"
          currentPage={currentPage}
          totalPages={totalPages}
          totalCount={totalRecords}
          pageSize={pageSize}
          isFetching={isFetching}
          onPageChange={setCurrentPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setCurrentPage(1);
          }}
          pageSizeOptions={[25, 50, 100]}
        />
      )}
    </div>
  );
}
