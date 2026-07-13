"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Clock,
  ArrowLeft,
  Building2,
  Briefcase,
  Filter,
  Archive,
  Sparkles,
  Plus,
  AlertCircle,
  Loader2,
  Trash2,
  Square,
} from "lucide-react";
import Link from "next/link";
import { TRIGGER_LABELS } from "./constants";
import { toast } from "sonner";
import { APP_REQUEST_HEADERS } from "@/lib/api/request-headers";
import { cn } from "@/lib/utils";
import { formatDurationMs, formatDateTime } from "@/lib/utils/format";
import {
  getLogStatusConfig,
  getSessionStatusConfig,
  MATCHER_STATUS_CONFIG,
} from "@/lib/utils/status-config";

interface SessionLog {
  id: number;
  companyId: number | null;
  companyName: string | null;
  companyLogoUrl: string | null;
  platform: string | null;
  status: string;
  jobsFound: number | null;
  jobsAdded: number | null;
  jobsUpdated: number | null;
  jobsFiltered: number | null;
  jobsArchived: number | null;
  errorMessage: string | null;
  duration: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  matcherStatus: string | null;
  matcherJobsTotal: number | null;
  matcherJobsCompleted: number | null;
  matcherDuration: number | null;
  matcherErrorCount: number | null;
  attemptNumber: number;
  attemptsTotal: number;
  isFinalAttempt: boolean;
}

interface ScrapeSession {
  id: string;
  triggerSource: string;
  status: string;
  companiesTotal: number | null;
  companiesCompleted: number | null;
  totalJobsFound: number | null;
  totalJobsAdded: number | null;
  totalJobsFiltered: number | null;
  totalJobsArchived: number | null;
  skipReason?: string | null;
  scheduledForAt?: Date | string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface ScrapeQueueItem {
  id: string;
  companyId: number;
  companyName: string | null;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  availableAt: Date | string;
  workerId: string | null;
  lockedAt: Date | string | null;
  leaseExpiresAt: Date | string | null;
  cancelRequested: boolean;
  lastError: string | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface SessionDetailResponse {
  session: ScrapeSession;
  logs: SessionLog[];
  queueItems: ScrapeQueueItem[];
}

const QUEUE_STATUS_STYLES: Record<string, string> = {
  queued: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  running: "border-blue-500/20 bg-blue-500/10 text-blue-400",
  completed: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  failed: "border-red-500/20 bg-red-500/10 text-red-400",
  cancelled: "border-zinc-500/20 bg-zinc-500/10 text-zinc-400",
};

interface SessionDetailProps {
  sessionId: string;
}

export function SessionDetail({ sessionId }: SessionDetailProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<SessionDetailResponse>({
    queryKey: ["scrape-history", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/scrape-history?sessionId=${sessionId}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch session details");
      return res.json();
    },
    refetchInterval: (query) => {
      const session = query.state.data?.session;
      const queueItems = query.state.data?.queueItems ?? [];
      if (!session) return 1000;
      const hasActiveQueueWork = queueItems.some(
        (item) => item.status === "queued" || item.status === "running"
      );
      return session.status === "in_progress" || hasActiveQueueWork ? 1000 : false;
    },
    refetchIntervalInBackground: true,
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/scrape-history?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: APP_REQUEST_HEADERS,
      });

      if (!res.ok) throw new Error("Failed to stop session");
      return res.json();
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
      const res = await fetch(`/api/scrape-history?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        headers: APP_REQUEST_HEADERS,
      });
      if (!res.ok) throw new Error("Failed to delete session");
      const text = await res.text();
      return text ? JSON.parse(text) : null;
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

  const { session, logs, queueItems } = data;
  const sessionStatusConfig = getSessionStatusConfig(session.status);
  const SessionStatusIcon = sessionStatusConfig.icon;
  const sessionDisplayTime = session.scheduledForAt ? new Date(session.scheduledForAt) : session.startedAt;
  const progress = session.companiesTotal
    ? Math.round(((session.companiesCompleted || 0) / session.companiesTotal) * 100)
    : 0;
  const hasActiveQueueWork = queueItems.some(
    (item) => item.status === "queued" || item.status === "running"
  );

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

      {queueItems.length > 0 && (
        <div>
          <div className="mb-4 px-1">
            <h3 className="text-sm font-medium text-muted-foreground">Durable Work Queue</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Attempts and recovery state persisted in the local SQLite database.
            </p>
          </div>
          <div className="space-y-3">
            {queueItems.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className="font-medium text-foreground">
                      {item.companyName ?? `Company ${item.companyId}`}
                    </h4>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        Attempt <span className="text-foreground/80">{item.attemptCount}</span>
                        /{item.maxAttempts}
                      </span>
                      {item.startedAt && (
                        <span>
                          Started {formatDateTime(new Date(item.startedAt))}
                        </span>
                      )}
                      {item.status === "queued" && item.attemptCount > 0 && (
                        <span>Retry available {formatDateTime(new Date(item.availableAt))}</span>
                      )}
                      {item.status === "running" && item.leaseExpiresAt && (
                        <span>Lease through {formatDateTime(new Date(item.leaseExpiresAt))}</span>
                      )}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={QUEUE_STATUS_STYLES[item.status] ?? "border-border text-muted-foreground"}
                  >
                    {item.status}
                  </Badge>
                </div>
                {item.lastError && (
                  <div className="mt-3 rounded-md border border-red-500/10 bg-red-500/5 p-3">
                    <p className="break-all font-mono text-xs text-red-700/90 dark:text-red-300">
                      {item.lastError}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Company Logs List */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4 px-1">Company Logs</h3>
        <div className="space-y-3">
          {logs.map((log) => {
            const logStatusConfig = getLogStatusConfig(log.status);
            const LogStatusIcon = logStatusConfig.icon;
            const matcherConfig = log.matcherStatus
              ? MATCHER_STATUS_CONFIG[log.matcherStatus] || MATCHER_STATUS_CONFIG.pending
              : null;
            const isPartialWarning = log.status === "partial";

            return (
              <div
                key={log.id}
                className="group rounded-lg border border-border bg-card p-4 transition-all hover:border-border hover:bg-muted/30"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="mt-1">
                      {log.companyLogoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={log.companyLogoUrl}
                          alt={log.companyName || "Company"}
                          className="h-10 w-10 rounded-lg bg-muted object-contain p-1.5"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-sm font-medium text-muted-foreground">
                          {(log.companyName || "?").charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-foreground">{log.companyName || "Unknown"}</h4>
                        {log.platform && (
                          <Badge variant="outline" className="border-border bg-card text-muted-foreground text-[10px] h-5 px-1.5">
                            {log.platform}
                          </Badge>
                        )}
                        {log.attemptsTotal > 1 && (
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                            Attempt {log.attemptNumber} of {log.attemptsTotal}
                            {!log.isFinalAttempt ? " · superseded" : " · final"}
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-4 mt-2 text-sm">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Briefcase className="h-3.5 w-3.5" />
                          <span>{log.jobsFound || 0}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                          <Plus className="h-3.5 w-3.5" />
                          <span>{log.jobsAdded || 0}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Filter className="h-3.5 w-3.5" />
                          <span>{log.jobsFiltered || 0}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Archive className="h-3.5 w-3.5" />
                          <span>{log.jobsArchived || 0}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div className={`flex items-center gap-1.5 text-xs font-medium ${logStatusConfig.color}`}>
                      <LogStatusIcon className="h-3.5 w-3.5" />
                      <span className="capitalize">{log.status}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      {formatDurationMs(log.duration)}
                    </div>
                  </div>
                </div>

                {/* Error Message */}
                {log.errorMessage && (
                  <div
                    className={cn(
                      "mt-4 rounded-md border p-3",
                      isPartialWarning
                        ? "border-amber-500/10 bg-amber-500/5"
                        : "border-red-500/10 bg-red-500/5"
                    )}
                  >
                    <div className="flex gap-2">
                      <AlertCircle
                        className={cn(
                          "h-4 w-4 shrink-0",
                          isPartialWarning
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-red-600 dark:text-red-400"
                        )}
                      />
                      <p
                        className={cn(
                          "break-all font-mono text-xs",
                          isPartialWarning
                            ? "text-amber-700/90 dark:text-amber-300"
                            : "text-red-700/90 dark:text-red-300"
                        )}
                      >
                        {log.errorMessage}
                      </p>
                    </div>
                  </div>
                )}

                {/* Matcher Status */}
                {matcherConfig && log.matcherJobsTotal && log.matcherJobsTotal > 0 && (
                  <div className="mt-4 flex items-center justify-between rounded-md border border-border bg-background/30 p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                      <span className="text-muted-foreground">Matcher:</span>
                      <span className={`font-medium ${matcherConfig.color}`}>
                        {matcherConfig.label}
                      </span>
                      {log.matcherStatus === "in_progress" && (
                        <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <Link
                        href="/history/match"
                        className="text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        View Match History
                      </Link>
                      <span>
                        <span className="text-foreground/80">{log.matcherJobsCompleted || 0}</span>
                        <span className="text-muted-foreground mx-0.5">/</span>
                        {log.matcherJobsTotal}
                      </span>
                      {log.matcherErrorCount && log.matcherErrorCount > 0 && (
                        <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                          <AlertCircle className="h-3 w-3" />
                          {log.matcherErrorCount}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
