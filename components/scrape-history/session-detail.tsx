"use client";

import { useState } from "react";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Clock,
  ArrowLeft,
  Building2,
  Briefcase,
  Filter,
  Archive,
  Sparkles,
  Loader2,
  Trash2,
  Square,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getScrapeHistoryDetail,
  cancelScrapeHistorySession,
  deleteScrapeHistorySession,
} from "@/lib/api/clients/history";
import { formatDateTime } from "@/lib/utils/format";
import { getSessionStatusConfig } from "@/lib/utils/status-config";

import { CompanyProgressList } from "./company-progress-list";
import { TRIGGER_LABELS } from "./constants";

interface SessionDetailProps {
  sessionId: string;
}

export function SessionDetail({ sessionId }: SessionDetailProps) {
  const [logOffset, setLogOffset] = useState(0);
  const logLimit = 50;
  const [workOffset, setWorkOffset] = useState(0);
  const workLimit = 50;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["scrape-history", sessionId, logOffset, workOffset],
    queryFn: async () => {
      return getScrapeHistoryDetail(sessionId, logOffset, logLimit, workOffset, workLimit);
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
      queryClient.invalidateQueries({ queryKey: ["scrape-history"] });
      queryClient.invalidateQueries({ queryKey: ["scrape-history", sessionId] });
    },
    onError: () => {
      toast.error("Failed to stop scrape session");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return deleteScrapeHistorySession(sessionId);
    },
    onSuccess: () => {
      router.push("/history/scrape");
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
      <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load session details</p>
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
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${sessionStatusConfig.bgColor}`}>
              <SessionStatusIcon className={`h-6 w-6 ${sessionStatusConfig.color}`} />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                Scrape Session
              </h1>
              <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDateTime(sessionDisplayTime)}
                </span>
                <span className="text-muted-foreground">&bull;</span>
                <span>{TRIGGER_LABELS[session.triggerSource] || session.triggerSource}</span>
              </div>
            </div>
          </div>
          <Badge
            variant="outline"
            className={`${sessionStatusConfig.color} ${sessionStatusConfig.bgColor} border-transparent px-3 py-1`}
          >
            {sessionStatusConfig.label}
          </Badge>
        </div>

        {session.skipReason && (
          <div className="mb-6 rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-300">
            {session.skipReason}
          </div>
        )}

        {/* Progress Bar */}
        {session.status === "in_progress" && (
          <div className="mb-6">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
              <span>Processing Companies...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Summary Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="rounded-lg border border-border bg-background/60 p-4">
            <div className="flex items-center gap-2 mb-2 text-muted-foreground">
              <Building2 className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Companies</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-foreground">
                {session.companiesCompleted || 0}
              </span>
              <span className="text-sm text-muted-foreground">
                / {session.companiesTotal || 0}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background/60 p-4">
            <div className="flex items-center gap-2 mb-2 text-muted-foreground">
              <Briefcase className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Jobs Found</span>
            </div>
            <span className="text-2xl font-semibold text-foreground">
              {session.totalJobsFound || 0}
            </span>
          </div>

          <div className="rounded-lg border border-border bg-background/60 p-4">
            <div className="mb-2 flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">New Jobs</span>
            </div>
            <span className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
              +{session.totalJobsAdded || 0}
            </span>
          </div>

          <div className="rounded-lg border border-border bg-background/60 p-4">
            <div className="flex items-center gap-2 mb-2 text-muted-foreground">
              <Filter className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Filtered</span>
            </div>
            <span className="text-2xl font-semibold text-muted-foreground">
              {session.totalJobsFiltered || 0}
            </span>
          </div>

          <div className="rounded-lg border border-border bg-background/60 p-4">
            <div className="flex items-center gap-2 mb-2 text-muted-foreground">
              <Archive className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Archived</span>
            </div>
            <span className="text-2xl font-semibold text-muted-foreground">
              {session.totalJobsArchived || 0}
            </span>
          </div>
        </div>
      </div>

      <CompanyProgressList queueItems={queueItems} logs={logs} />
      {workPagination.total > workLimit && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={workOffset === 0} onClick={() => setWorkOffset(Math.max(0, workOffset - workLimit))}>Previous companies</Button>
          <Button variant="outline" size="sm" disabled={!workPagination.hasMore} onClick={() => setWorkOffset(workOffset + workLimit)}>Next companies</Button>
        </div>
      )}
      {logPagination.total > logLimit && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Showing {logPagination.offset + 1}-{Math.min(logPagination.offset + logs.length, logPagination.total)} of {logPagination.total} log entries
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={logOffset === 0} onClick={() => setLogOffset(Math.max(0, logOffset - logLimit))}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={!logPagination.hasMore} onClick={() => setLogOffset(logOffset + logLimit)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
