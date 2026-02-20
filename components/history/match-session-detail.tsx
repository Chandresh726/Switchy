"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  XCircle,
  Clock,
  ArrowLeft,
  Building2,
  Sparkles,
  AlertCircle,
  Loader2,
  Play,
  Target,
  Square,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { TRIGGER_LABELS } from "@/components/scrape-history/constants";
import { toast } from "sonner";
import { formatDurationMs, formatDurationFromDates, formatDateTime } from "@/lib/utils/format";
import { getSessionStatusConfig } from "@/lib/utils/status-config";

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

interface MatchLog {
  id: number;
  sessionId: string | null;
  jobId: number | null;
  jobTitle: string | null;
  companyName: string | null;
  status: string;
  score: number | null;
  attemptCount: number | null;
  errorType: string | null;
  errorMessage: string | null;
  duration: number | null;
  modelUsed: string | null;
  completedAt: Date | null;
}

interface SessionDetailResponse {
  session: MatchSession;
  logs: MatchLog[];
}

interface MatchSessionDetailProps {
  sessionId: string;
}

export function MatchSessionDetail({ sessionId }: MatchSessionDetailProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<SessionDetailResponse>({
    queryKey: ["match-history", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/match-history?sessionId=${encodeURIComponent(sessionId)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch session details");
      const json = await res.json();
      return {
        session: {
          ...json.session,
          startedAt: json.session.startedAt ? new Date(json.session.startedAt) : null,
          completedAt: json.session.completedAt ? new Date(json.session.completedAt) : null,
        },
        logs: json.logs.map((log: MatchLog) => ({
          ...log,
          completedAt: log.completedAt ? new Date(log.completedAt) : null,
        })),
      };
    },
    refetchInterval: (query) => {
      const session = query.state.data?.session;
      if (!session) return 1000;
      return session.status === "in_progress" || session.status === "queued" ? 1000 : false;
    },
    refetchIntervalInBackground: true,
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/match-history?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
      });
      if (!res.ok) throw new Error("Failed to stop session");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Stopping match session");
      queryClient.invalidateQueries({ queryKey: ["match-history"] });
      queryClient.invalidateQueries({ queryKey: ["match-history", sessionId] });
    },
    onError: () => {
      toast.error("Failed to stop match session");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/match-history?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete session");
      if (res.status !== 204) {
        return res.json();
      }
      return null;
    },
    onSuccess: () => {
      router.push("/history/match");
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
        <Link href="/history/match">
          <Button variant="ghost" className="mt-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Match History
          </Button>
        </Link>
      </div>
    );
  }

  const { session, logs } = data;
  const statusConfig = getSessionStatusConfig(session.status);
  const StatusIcon = statusConfig.icon;
  const progress = session.jobsTotal
    ? Math.round(((session.jobsCompleted || 0) / session.jobsTotal) * 100)
    : 0;
  const isActiveSession = session.status === "in_progress" || session.status === "queued";

  const failedLogs = logs.filter((l) => l.status === "failed");
  const successLogs = logs.filter((l) => l.status === "success");

  return (
    <div className="space-y-6">
      {/* Header Navigation */}
      <div className="flex items-center justify-between">
        <Link href="/history/match">
          <Button variant="ghost" className="text-muted-foreground hover:text-foreground -ml-2 pl-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Match History
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          {isActiveSession && (
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
            disabled={deleteMutation.isPending}
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
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${statusConfig.bgColor}`}>
              {session.status === "in_progress" ? (
                <Loader2 className={`h-6 w-6 ${statusConfig.color} animate-spin`} />
              ) : (
                <StatusIcon className={`h-6 w-6 ${statusConfig.color}`} />
              )}
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                Match Session
              </h1>
              <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDateTime(session.startedAt)}
                </span>
                <span className="text-muted-foreground">&bull;</span>
                <span className="flex items-center gap-1.5">
                  <Play className="h-3.5 w-3.5" />
                  {TRIGGER_LABELS[session.triggerSource] || session.triggerSource}
                </span>
                {session.companyName && (
                  <>
                    <span className="text-muted-foreground">&bull;</span>
                    <span className="flex items-center gap-1.5 text-purple-600 dark:text-purple-400">
                      <Building2 className="h-3.5 w-3.5" />
                      {session.companyName}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <Badge
            variant="outline"
            className={`${statusConfig.color} ${statusConfig.bgColor} border-transparent px-3 py-1`}
          >
            {statusConfig.label}
          </Badge>
        </div>

        {/* Progress Bar */}
        {session.status === "in_progress" && (
          <div className="mb-6">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
              <span>Matching Jobs...</span>
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg border border-border bg-background/60 p-4">
            <div className="flex items-center gap-2 mb-2 text-muted-foreground">
              <Target className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Total Jobs</span>
            </div>
            <span className="text-2xl font-semibold text-foreground">
              {session.jobsTotal || 0}
            </span>
          </div>

          <div className="rounded-lg border border-border bg-background/60 p-4">
            <div className="mb-2 flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Succeeded</span>
            </div>
            <span className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
              {session.jobsSucceeded || 0}
            </span>
          </div>

          <div className="rounded-lg border border-border bg-background/60 p-4">
            <div className="mb-2 flex items-center gap-2 text-red-600 dark:text-red-400">
              <XCircle className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Failed</span>
            </div>
            <span className="text-2xl font-semibold text-red-600 dark:text-red-400">
              {session.jobsFailed || 0}
            </span>
          </div>

          <div className="rounded-lg border border-border bg-background/60 p-4">
            <div className="mb-2 flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Total Duration</span>
            </div>
            <span className="text-2xl font-semibold text-foreground">
              {formatDurationFromDates(session.startedAt, session.completedAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Job Logs List */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4 px-1">Job Match Logs</h3>
        
        {/* Failed Jobs Section */}
        {failedLogs.length > 0 && (
          <div className="mb-6">
            <h4 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-red-600 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              Failed Jobs ({failedLogs.length})
            </h4>
            <div className="space-y-3">
              {failedLogs.map((log) => {
                const jobDisplay = log.jobTitle || (log.jobId != null ? `Job #${log.jobId}` : "Untitled Job");
                const hasJobId = log.jobId != null;
                return hasJobId ? (
                  <Link
                    key={log.id}
                    href={`/jobs/${log.jobId}`}
                    className="block rounded-lg border border-red-500/20 bg-red-500/5 p-4 transition-all hover:bg-red-500/10 hover:border-red-500/30"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-foreground">
                        {jobDisplay}
                      </span>
                      <Badge variant="outline" className="h-5 border-red-500/30 px-1.5 text-[10px] text-red-600 dark:text-red-400">
                        {log.errorType || "error"}
                      </Badge>
                    </div>
                    {log.errorMessage && (
                      <p className="mb-2 break-all font-mono text-[10px] text-red-700/90 dark:text-red-300">{log.errorMessage}</p>
                    )}
                    <div className="flex gap-4 text-muted-foreground text-xs">
                      <span>Attempts: {log.attemptCount}</span>
                      <span>Duration: {formatDurationMs(log.duration)}</span>
                      {log.modelUsed && <span>Model: {log.modelUsed}</span>}
                    </div>
                  </Link>
                ) : (
                  <div
                    key={log.id}
                    className="block rounded-lg border border-red-500/20 bg-red-500/5 p-4 opacity-50"
                    aria-disabled="true"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-foreground">
                        {jobDisplay}
                      </span>
                      <Badge variant="outline" className="h-5 border-red-500/30 px-1.5 text-[10px] text-red-600 dark:text-red-400">
                        {log.errorType || "error"}
                      </Badge>
                    </div>
                    {log.errorMessage && (
                      <p className="mb-2 break-all font-mono text-[10px] text-red-700/90 dark:text-red-300">{log.errorMessage}</p>
                    )}
                    <div className="flex gap-4 text-muted-foreground text-xs">
                      <span>Attempts: {log.attemptCount}</span>
                      <span>Duration: {formatDurationMs(log.duration)}</span>
                      {log.modelUsed && <span>Model: {log.modelUsed}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Successful Jobs Section */}
        {successLogs.length > 0 && (
          <div>
            <h4 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="h-3.5 w-3.5" />
              Successful Jobs ({successLogs.length})
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {successLogs.map((log) => {
                const jobDisplay = log.jobTitle || (log.jobId != null ? `Job #${log.jobId}` : "Untitled Job");
                const hasJobId = log.jobId != null;
                return hasJobId ? (
                  <Link
                    key={log.id}
                    href={`/jobs/${log.jobId}`}
                    className="block rounded-lg border border-emerald-500/10 bg-emerald-500/5 p-4 transition-all hover:bg-emerald-500/10 hover:border-emerald-500/20"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-foreground font-medium truncate block" title={log.jobTitle || ""}>
                        {jobDisplay}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                        <span className="font-mono text-lg text-emerald-600 dark:text-emerald-400">
                          {log.score?.toFixed(0)}
                        </span>
                        <span className="text-muted-foreground text-xs">match score</span>
                      </div>
                      <span className="text-muted-foreground text-xs">
                        {formatDurationMs(log.duration)}
                      </span>
                    </div>
                    {log.modelUsed && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Model: {log.modelUsed}
                      </div>
                    )}
                  </Link>
                ) : (
                  <div
                    key={log.id}
                    className="block rounded-lg border border-emerald-500/10 bg-emerald-500/5 p-4 opacity-50"
                    aria-disabled="true"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-foreground font-medium truncate block" title={log.jobTitle || ""}>
                        {jobDisplay}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                        <span className="font-mono text-lg text-emerald-600 dark:text-emerald-400">
                          {log.score?.toFixed(0)}
                        </span>
                        <span className="text-muted-foreground text-xs">match score</span>
                      </div>
                      <span className="text-muted-foreground text-xs">
                        {formatDurationMs(log.duration)}
                      </span>
                    </div>
                    {log.modelUsed && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Model: {log.modelUsed}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {logs.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No job logs available for this session
          </p>
        )}
      </div>
    </div>
  );
}
