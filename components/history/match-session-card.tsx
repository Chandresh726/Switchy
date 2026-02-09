"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  Trash2,
  Play,
  Target,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

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
  const [isDeleting, setIsDeleting] = useState(false);
  const queryClient = useQueryClient();

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

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/match-history?sessionId=${session.id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete session");

      queryClient.invalidateQueries({ queryKey: ["match-history"] });
      toast.success("Match session deleted successfully");
    } catch (error) {
      console.error("Failed to delete session:", error);
      toast.error("Failed to delete match session");
    } finally {
      setIsDeleting(false);
    }
  };

  const logs = detailData?.logs || [];
  const failedLogs = logs.filter((l) => l.status === "failed");
  const successLogs = logs.filter((l) => l.status === "success");

  return (
    <div className="group rounded-lg border border-zinc-800 bg-zinc-900/50 transition-all hover:border-zinc-700">
      {/* Main Card Content */}
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${statusConfig.bgColor}`}>
              {session.status === "in_progress" ? (
                <Loader2 className={`h-5 w-5 ${statusConfig.color} animate-spin`} />
              ) : (
                <StatusIcon className={`h-5 w-5 ${statusConfig.color}`} />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-white">
                  {formatDate(session.startedAt)} <span className="text-zinc-500">at</span> {formatTime(session.startedAt)}
                </h3>
              </div>

              <div className="flex items-center gap-2 text-sm text-zinc-400 mt-0.5">
                <span className="flex items-center gap-1">
                  <Play className="h-3 w-3" />
                  {TRIGGER_LABELS[session.triggerSource] || session.triggerSource}
                </span>

                {session.companyName && (
                  <>
                    <span className="text-zinc-700">•</span>
                    <span className="flex items-center gap-1 text-purple-400">
                      <Building2 className="h-3 w-3" />
                      {session.companyName}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-8 w-8 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Match Session?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete this match session and its logs.
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-red-500 hover:bg-red-600 text-white"
                    disabled={isDeleting}
                  >
                    {isDeleting ? "Deleting..." : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* Progress Bar */}
        {session.status === "in_progress" && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
              <span>Matching Jobs...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Meta Stats */}
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
          <span className="flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-zinc-400" />
            <span className="text-zinc-300 font-medium">{session.jobsTotal || 0}</span> Total
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-emerald-400 font-medium">{session.jobsSucceeded || 0}</span> Succeeded
          </span>
          {session.jobsFailed ? (
            <span className="flex items-center gap-1.5">
              <XCircle className="h-3.5 w-3.5 text-red-400" />
              <span className="text-red-400 font-medium">{session.jobsFailed}</span> Failed
            </span>
          ) : null}
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-yellow-500" />
            <span className={`font-medium ${successRate >= 75 ? "text-emerald-400" : successRate >= 50 ? "text-yellow-500" : "text-red-400"}`}>
              {successRate}%
            </span> Match Rate
          </span>

          <div className="ml-auto flex items-center gap-3">
            <Badge
              variant="outline"
              className={`${statusConfig.color} ${statusConfig.bgColor} border-transparent text-[10px] h-5 px-1.5`}
            >
              {statusConfig.label}
            </Badge>
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-zinc-400" />
              {formatDuration(session.startedAt, session.completedAt)}
            </span>
          </div>
        </div>

        {/* Toggle Details */}
        <div className="mt-4 pt-3 border-t border-zinc-800">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-zinc-400 hover:text-white h-8 justify-between"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <span>{isExpanded ? "Hide Details" : "View Match Log"}</span>
            {isExpanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-zinc-800 bg-zinc-950/30 p-4 rounded-b-lg animate-in slide-in-from-top-2 duration-200">
          {detailLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Failed Jobs Section */}
              {failedLogs.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium uppercase tracking-wider text-red-400 mb-3 flex items-center gap-2">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Failed Jobs ({failedLogs.length})
                  </h4>
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                    {failedLogs.map((log) => (
                      <div
                        key={log.id}
                        className="rounded border border-red-500/20 bg-red-500/5 p-3 text-xs"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-white">
                            {log.jobTitle || `Job #${log.jobId}`}
                          </span>
                          <Badge variant="outline" className="border-red-500/30 text-red-400 text-[10px] h-5 px-1.5">
                            {log.errorType || "error"}
                          </Badge>
                        </div>
                        {log.errorMessage && (
                          <p className="text-red-300/80 mb-2 font-mono text-[10px] break-all">{log.errorMessage}</p>
                        )}
                        <div className="flex gap-4 text-zinc-500 text-[10px]">
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
                  <h4 className="text-xs font-medium uppercase tracking-wider text-emerald-400 mb-3 flex items-center gap-2">
                    <CheckCircle className="h-3.5 w-3.5" />
                    Successful Jobs ({successLogs.length})
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                    {successLogs.map((log) => (
                      <div
                        key={log.id}
                        className="rounded border border-emerald-500/10 bg-emerald-500/5 p-2.5 text-xs transition-colors hover:bg-emerald-500/10 hover:border-emerald-500/20"
                      >
                        <span className="text-zinc-200 font-medium truncate block mb-1.5" title={log.jobTitle || ""}>
                          {log.jobTitle || `Job #${log.jobId}`}
                        </span>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Sparkles className="h-3 w-3 text-emerald-500" />
                            <span className="text-emerald-400 font-mono">
                              {log.score?.toFixed(0)}
                            </span>
                          </div>
                          <span className="text-zinc-600 text-[10px]">
                            {formatDurationMs(log.duration)}
                          </span>
                        </div>
                      </div>
                    ))}
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
