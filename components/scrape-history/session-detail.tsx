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
  Briefcase,
  Filter,
  Sparkles,
  AlertCircle,
  Loader2,
  Trash2,
  Square,
} from "lucide-react";
import Link from "next/link";
import { TRIGGER_LABELS } from "./constants";
import { toast } from "sonner";
import { formatDurationMs, formatDateTime } from "@/lib/utils/format";
import { getLogStatusConfig, MATCHER_STATUS_CONFIG } from "@/lib/utils/status-config";

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
  errorMessage: string | null;
  duration: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  matcherStatus: string | null;
  matcherJobsTotal: number | null;
  matcherJobsCompleted: number | null;
  matcherDuration: number | null;
  matcherErrorCount: number | null;
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
  startedAt: Date | null;
  completedAt: Date | null;
}

interface SessionDetailResponse {
  session: ScrapeSession;
  logs: SessionLog[];
}

const SESSION_DETAIL_STATUS_CONFIG = {
  completed: {
    icon: CheckCircle,
    color: "text-emerald-400",
  },
  failed: {
    icon: XCircle,
    color: "text-red-400",
  },
  in_progress: {
    icon: AlertCircle,
    color: "text-yellow-400",
  },
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
      if (!session) return 1000;
      return session.status === "in_progress" ? 1000 : false;
    },
    refetchIntervalInBackground: true,
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/scrape-history?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
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
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-center">
        <p className="text-sm text-red-400">Failed to load session details</p>
        <Link href="/history">
          <Button variant="ghost" className="mt-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to History
          </Button>
        </Link>
      </div>
    );
  }

  const { session, logs } = data;
  const sessionStatusConfig = session.status === "completed"
    ? SESSION_DETAIL_STATUS_CONFIG.completed
    : session.status === "failed"
    ? SESSION_DETAIL_STATUS_CONFIG.failed
    : SESSION_DETAIL_STATUS_CONFIG.in_progress;
  const SessionStatusIcon = sessionStatusConfig.icon;
  const progress = session.companiesTotal
    ? Math.round(((session.companiesCompleted || 0) / session.companiesTotal) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header Navigation */}
      <div className="flex items-center justify-between">
        <Link href="/history/scrape">
          <Button variant="ghost" className="text-zinc-400 hover:text-white -ml-2 pl-2">
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
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {deleteMutation.isPending ? "Deleting..." : "Delete Session"}
          </Button>
        </div>
      </div>

      {/* Session Overview Card */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${sessionStatusConfig.color.replace("text-", "bg-").replace("400", "500/10")}`}>
              <SessionStatusIcon className={`h-6 w-6 ${sessionStatusConfig.color}`} />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">
                Scrape Session
              </h1>
              <div className="flex items-center gap-3 mt-1.5 text-sm text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDateTime(session.startedAt)}
                </span>
                <span className="text-zinc-700">&bull;</span>
                <span>{TRIGGER_LABELS[session.triggerSource] || session.triggerSource}</span>
              </div>
            </div>
          </div>
          <Badge
            variant="outline"
            className={`${sessionStatusConfig.color} ${sessionStatusConfig.color.replace("text-", "bg-").replace("400", "500/10")} border-transparent px-3 py-1`}
          >
            {session.status}
          </Badge>
        </div>

        {/* Progress Bar */}
        {session.status === "in_progress" && (
          <div className="mb-6">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1.5">
              <span>Processing Companies...</span>
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

        {/* Summary Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
            <div className="flex items-center gap-2 mb-2 text-zinc-400">
              <Building2 className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Companies</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-white">
                {session.companiesCompleted || 0}
              </span>
              <span className="text-sm text-zinc-500">
                / {session.companiesTotal || 0}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
            <div className="flex items-center gap-2 mb-2 text-zinc-400">
              <Briefcase className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Jobs Found</span>
            </div>
            <span className="text-2xl font-semibold text-white">
              {session.totalJobsFound || 0}
            </span>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
            <div className="flex items-center gap-2 mb-2 text-emerald-400">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">New Jobs</span>
            </div>
            <span className="text-2xl font-semibold text-emerald-400">
              +{session.totalJobsAdded || 0}
            </span>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
            <div className="flex items-center gap-2 mb-2 text-zinc-400">
              <Filter className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Filtered</span>
            </div>
            <span className="text-2xl font-semibold text-zinc-400">
              {session.totalJobsFiltered || 0}
            </span>
          </div>
        </div>
      </div>

      {/* Company Logs List */}
      <div>
        <h3 className="text-sm font-medium text-zinc-400 mb-4 px-1">Company Logs</h3>
        <div className="space-y-3">
          {logs.map((log) => {
            const logStatusConfig = getLogStatusConfig(log.status);
            const LogStatusIcon = logStatusConfig.icon;
            const matcherConfig = log.matcherStatus
              ? MATCHER_STATUS_CONFIG[log.matcherStatus] || MATCHER_STATUS_CONFIG.pending
              : null;

            return (
              <div
                key={log.id}
                className="group rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 transition-all hover:border-zinc-700 hover:bg-zinc-900/50"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="mt-1">
                      {log.companyLogoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={log.companyLogoUrl}
                          alt={log.companyName || "Company"}
                          className="h-10 w-10 rounded-lg bg-zinc-800 object-contain p-1.5"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 text-sm font-medium text-zinc-400">
                          {(log.companyName || "?").charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-white">{log.companyName || "Unknown"}</h4>
                        {log.platform && (
                          <Badge variant="outline" className="border-zinc-800 bg-zinc-900 text-zinc-500 text-[10px] h-5 px-1.5">
                            {log.platform}
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-4 mt-2 text-sm">
                        <div className="flex items-center gap-1.5 text-zinc-400">
                          <Briefcase className="h-3.5 w-3.5" />
                          <span>{log.jobsFound || 0}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-emerald-400">
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>{log.jobsAdded || 0}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-zinc-500">
                          <Filter className="h-3.5 w-3.5" />
                          <span>{log.jobsFiltered || 0}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div className={`flex items-center gap-1.5 text-xs font-medium ${logStatusConfig.color}`}>
                      <LogStatusIcon className="h-3.5 w-3.5" />
                      <span className="capitalize">{log.status}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                      <Clock className="h-3.5 w-3.5" />
                      {formatDurationMs(log.duration)}
                    </div>
                  </div>
                </div>

                {/* Error Message */}
                {log.errorMessage && (
                  <div className="mt-4 rounded-md border border-red-500/10 bg-red-500/5 p-3">
                    <div className="flex gap-2">
                      <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
                      <p className="text-xs text-red-300 font-mono break-all">{log.errorMessage}</p>
                    </div>
                  </div>
                )}

                {/* Matcher Status */}
                {matcherConfig && log.matcherJobsTotal && log.matcherJobsTotal > 0 && (
                  <div className="mt-4 flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/30 p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                      <span className="text-zinc-400">Matcher:</span>
                      <span className={`font-medium ${matcherConfig.color}`}>
                        {matcherConfig.label}
                      </span>
                      {log.matcherStatus === "in_progress" && (
                        <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-zinc-500">
                      <span>
                        <span className="text-zinc-300">{log.matcherJobsCompleted || 0}</span>
                        <span className="text-zinc-600 mx-0.5">/</span>
                        {log.matcherJobsTotal}
                      </span>
                      {log.matcherErrorCount && log.matcherErrorCount > 0 && (
                        <span className="text-red-400 flex items-center gap-1">
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
