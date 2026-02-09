"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Sparkles,
  AlertCircle,
  Loader2,
  Building2,
} from "lucide-react";

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

interface MatchSessionCardProps {
  session: MatchSession;
}

const STATUS_CONFIG = {
  completed: {
    icon: CheckCircle,
    label: "Completed",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/20",
  },
  in_progress: {
    icon: Clock,
    label: "In Progress",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
  },
};

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  auto_scrape: "Auto (Scrape)",
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

function formatTime(date: Date | null): string {
  if (!date) return "-";
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(date: Date | null): string {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDurationMs(ms: number | null): string {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export function MatchSessionCard({ session }: MatchSessionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const statusConfig = STATUS_CONFIG[session.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.in_progress;
  const StatusIcon = statusConfig.icon;

  const progress = session.jobsTotal
    ? Math.round(((session.jobsCompleted || 0) / session.jobsTotal) * 100)
    : 0;

  const successRate = session.jobsTotal
    ? Math.round(((session.jobsSucceeded || 0) / session.jobsTotal) * 100)
    : 0;

  // Fetch detailed logs when expanded
  const { data: detailData, isLoading: detailLoading } = useQuery<SessionDetailResponse>({
    queryKey: ["match-history", session.id],
    queryFn: async () => {
      const res = await fetch(`/api/match-history?sessionId=${session.id}`);
      if (!res.ok) throw new Error("Failed to fetch session details");
      return res.json();
    },
    enabled: isExpanded,
    refetchInterval: session.status === "in_progress" ? 2000 : false,
  });

  const logs = detailData?.logs || [];
  const failedLogs = logs.filter((l) => l.status === "failed");
  const successLogs = logs.filter((l) => l.status === "success");

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 transition-colors hover:border-zinc-700">
      {/* Main Card Content */}
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${statusConfig.bgColor}`}>
              {session.status === "in_progress" ? (
                <Loader2 className={`h-5 w-5 ${statusConfig.color} animate-spin`} />
              ) : (
                <StatusIcon className={`h-5 w-5 ${statusConfig.color}`} />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">
                  {formatDate(session.startedAt)} at {formatTime(session.startedAt)}
                </span>
                <Badge
                  variant="outline"
                  className="border-zinc-700 text-zinc-400"
                >
                  {TRIGGER_LABELS[session.triggerSource] || session.triggerSource}
                </Badge>
                {session.companyName && (
                  <Badge variant="outline" className="border-purple-500/30 text-purple-400">
                    <Building2 className="h-3 w-3 mr-1" />
                    {session.companyName}
                  </Badge>
                )}
              </div>
              <p className={`text-sm ${statusConfig.color}`}>
                {statusConfig.label} in {formatDuration(session.startedAt, session.completedAt)}
              </p>
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="text-zinc-400 hover:text-white"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? "Hide" : "Details"}
            {isExpanded ? (
              <ChevronUp className="ml-1 h-4 w-4" />
            ) : (
              <ChevronDown className="ml-1 h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Progress Bar */}
        {session.status === "in_progress" && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
              <span>Jobs: {session.jobsCompleted || 0}/{session.jobsTotal || 0}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="mt-4 grid grid-cols-4 gap-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-zinc-500" />
            <div>
              <p className="text-sm font-medium text-white">{session.jobsTotal || 0}</p>
              <p className="text-xs text-zinc-500">Total</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-emerald-500" />
            <div>
              <p className="text-sm font-medium text-emerald-400">{session.jobsSucceeded || 0}</p>
              <p className="text-xs text-zinc-500">Succeeded</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-red-500" />
            <div>
              <p className="text-sm font-medium text-red-400">{session.jobsFailed || 0}</p>
              <p className="text-xs text-zinc-500">Failed</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`h-4 w-4 rounded-full ${successRate >= 80 ? "bg-emerald-500" : successRate >= 50 ? "bg-yellow-500" : "bg-red-500"}`} />
            <div>
              <p className="text-sm font-medium text-white">{successRate}%</p>
              <p className="text-xs text-zinc-500">Success</p>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-zinc-800 p-4">
          {detailLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Failed Jobs Section */}
              {failedLogs.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-red-400 mb-2 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    Failed Jobs ({failedLogs.length})
                  </h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {failedLogs.map((log) => (
                      <div
                        key={log.id}
                        className="rounded bg-red-500/10 p-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-white">
                            {log.jobTitle || `Job #${log.jobId}`}
                          </span>
                          <Badge variant="outline" className="border-red-500/30 text-red-400 text-xs">
                            {log.errorType || "error"}
                          </Badge>
                        </div>
                        {log.errorMessage && (
                          <p className="mt-1 text-red-300 truncate">{log.errorMessage}</p>
                        )}
                        <div className="mt-1 flex gap-4 text-zinc-500">
                          <span>Attempts: {log.attemptCount}</span>
                          <span>Duration: {formatDurationMs(log.duration)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Success Summary */}
              {successLogs.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-emerald-400 mb-2 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" />
                    Successful Jobs ({successLogs.length})
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                    {successLogs.slice(0, 20).map((log) => (
                      <div
                        key={log.id}
                        className="rounded bg-emerald-500/10 p-2 text-xs"
                      >
                        <span className="text-white truncate block">
                          {log.jobTitle || `Job #${log.jobId}`}
                        </span>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-emerald-400">
                            Score: {log.score?.toFixed(0)}
                          </span>
                          <span className="text-zinc-500">
                            {formatDurationMs(log.duration)}
                          </span>
                        </div>
                      </div>
                    ))}
                    {successLogs.length > 20 && (
                      <div className="rounded bg-zinc-800/50 p-2 text-xs flex items-center justify-center text-zinc-400">
                        +{successLogs.length - 20} more
                      </div>
                    )}
                  </div>
                </div>
              )}

              {logs.length === 0 && (
                <p className="text-sm text-zinc-500 text-center py-4">
                  No job logs available for this session
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
