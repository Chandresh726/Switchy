"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
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
  Trash2,
} from "lucide-react";
import Link from "next/link";

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

const STATUS_CONFIG = {
  completed: {
    icon: CheckCircle,
    label: "Completed",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    color: "text-red-400",
    bgColor: "bg-red-500/10",
  },
  in_progress: {
    icon: Clock,
    label: "In Progress",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
  },
};

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  auto_scrape: "Auto Scrape",
  company_refresh: "Company Refresh",
};

function formatDuration(startedAt: Date | null, completedAt: Date | null): string {
  if (!startedAt) return "-";
  const end = completedAt ? new Date(completedAt) : new Date();
  const start = new Date(startedAt);
  const diffMs = end.getTime() - start.getTime();

  if (diffMs < 1000) return `${diffMs}ms`;
  if (diffMs < 60000) return `${(diffMs / 1000).toFixed(1)}s`;
  return `${Math.floor(diffMs / 60000)}m ${Math.floor((diffMs % 60000) / 1000)}s`;
}

function formatDurationMs(ms: number | null): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatDateTime(date: Date | null): string {
  if (!date) return "-";
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

interface MatchSessionDetailProps {
  sessionId: string;
}

export function MatchSessionDetail({ sessionId }: MatchSessionDetailProps) {
  const router = useRouter();
  const { data, isLoading, error } = useQuery<SessionDetailResponse>({
    queryKey: ["match-history", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/match-history?sessionId=${encodeURIComponent(sessionId)}`);
      if (!res.ok) throw new Error("Failed to fetch session details");
      const json = await res.json();
      // Normalize date fields from ISO strings to Date objects
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
      return session?.status === "in_progress" ? 2000 : false;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/match-history?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete session");
      return res.json();
    },
    onSuccess: () => {
      router.push("/history/match");
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-center">
        <p className="text-sm text-red-400">Failed to load session details</p>
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
  const statusConfig = STATUS_CONFIG[session.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.in_progress;
  const StatusIcon = statusConfig.icon;

  const successRate = session.jobsTotal
    ? Math.round(((session.jobsSucceeded || 0) / session.jobsTotal) * 100)
    : 0;

  const failedLogs = logs.filter((l) => l.status === "failed");
  const successLogs = logs.filter((l) => l.status === "success");

  return (
    <div className="space-y-6">
      {/* Header Navigation */}
      <div className="flex items-center justify-between">
        <Link href="/history/match">
          <Button variant="ghost" className="text-zinc-400 hover:text-white -ml-2 pl-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Match History
          </Button>
        </Link>
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

      {/* Session Overview Card */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
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
              <h1 className="text-xl font-semibold text-white">
                Match Session
              </h1>
              <div className="flex items-center gap-3 mt-1.5 text-sm text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDateTime(session.startedAt)}
                </span>
                <span className="text-zinc-700">&bull;</span>
                <span className="flex items-center gap-1.5">
                  <Play className="h-3.5 w-3.5" />
                  {TRIGGER_LABELS[session.triggerSource] || session.triggerSource}
                </span>
                {session.companyName && (
                  <>
                    <span className="text-zinc-700">&bull;</span>
                    <span className="flex items-center gap-1.5 text-purple-400">
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

        {/* Summary Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
            <div className="flex items-center gap-2 mb-2 text-zinc-400">
              <Target className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Total Jobs</span>
            </div>
            <span className="text-2xl font-semibold text-white">
              {session.jobsTotal || 0}
            </span>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
            <div className="flex items-center gap-2 mb-2 text-emerald-400">
              <CheckCircle className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Succeeded</span>
            </div>
            <span className="text-2xl font-semibold text-emerald-400">
              {session.jobsSucceeded || 0}
            </span>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
            <div className="flex items-center gap-2 mb-2 text-red-400">
              <XCircle className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Failed</span>
            </div>
            <span className="text-2xl font-semibold text-red-400">
              {session.jobsFailed || 0}
            </span>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
            <div className="flex items-center gap-2 mb-2 text-purple-400">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Success Rate</span>
            </div>
            <span className={`text-2xl font-semibold ${successRate >= 75 ? "text-emerald-400" : successRate >= 50 ? "text-yellow-400" : "text-red-400"}`}>
              {successRate}%
            </span>
          </div>
        </div>

        {/* Duration */}
        <div className="mt-4 pt-4 border-t border-zinc-800">
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Clock className="h-4 w-4" />
            <span>Duration:</span>
            <span className="text-white font-medium">
              {formatDuration(session.startedAt, session.completedAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Job Logs List */}
      <div>
        <h3 className="text-sm font-medium text-zinc-400 mb-4 px-1">Job Match Logs</h3>
        
        {/* Failed Jobs Section */}
        {failedLogs.length > 0 && (
          <div className="mb-6">
            <h4 className="text-xs font-medium uppercase tracking-wider text-red-400 mb-3 flex items-center gap-2">
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
                      <span className="font-medium text-white">
                        {jobDisplay}
                      </span>
                      <Badge variant="outline" className="border-red-500/30 text-red-400 text-[10px] h-5 px-1.5">
                        {log.errorType || "error"}
                      </Badge>
                    </div>
                    {log.errorMessage && (
                      <p className="text-red-300/80 mb-2 font-mono text-[10px] break-all">{log.errorMessage}</p>
                    )}
                    <div className="flex gap-4 text-zinc-500 text-xs">
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
                      <span className="font-medium text-white">
                        {jobDisplay}
                      </span>
                      <Badge variant="outline" className="border-red-500/30 text-red-400 text-[10px] h-5 px-1.5">
                        {log.errorType || "error"}
                      </Badge>
                    </div>
                    {log.errorMessage && (
                      <p className="text-red-300/80 mb-2 font-mono text-[10px] break-all">{log.errorMessage}</p>
                    )}
                    <div className="flex gap-4 text-zinc-500 text-xs">
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
            <h4 className="text-xs font-medium uppercase tracking-wider text-emerald-400 mb-3 flex items-center gap-2">
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
                      <span className="text-zinc-200 font-medium truncate block" title={log.jobTitle || ""}>
                        {jobDisplay}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                        <span className="text-emerald-400 font-mono text-lg">
                          {log.score?.toFixed(0)}
                        </span>
                        <span className="text-zinc-500 text-xs">match score</span>
                      </div>
                      <span className="text-zinc-600 text-xs">
                        {formatDurationMs(log.duration)}
                      </span>
                    </div>
                    {log.modelUsed && (
                      <div className="mt-2 text-xs text-zinc-500">
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
                      <span className="text-zinc-200 font-medium truncate block" title={log.jobTitle || ""}>
                        {jobDisplay}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                        <span className="text-emerald-400 font-mono text-lg">
                          {log.score?.toFixed(0)}
                        </span>
                        <span className="text-zinc-500 text-xs">match score</span>
                      </div>
                      <span className="text-zinc-600 text-xs">
                        {formatDurationMs(log.duration)}
                      </span>
                    </div>
                    {log.modelUsed && (
                      <div className="mt-2 text-xs text-zinc-500">
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
          <p className="text-sm text-zinc-500 text-center py-8">
            No job logs available for this session
          </p>
        )}
      </div>
    </div>
  );
}
