"use client";

import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import Link from "next/link";

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

const STATUS_CONFIG = {
  success: {
    icon: CheckCircle,
    color: "text-emerald-400",
  },
  error: {
    icon: XCircle,
    color: "text-red-400",
  },
  partial: {
    icon: AlertCircle,
    color: "text-yellow-400",
  },
};

const MATCHER_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "text-zinc-400" },
  in_progress: { label: "In Progress", color: "text-blue-400" },
  completed: { label: "Completed", color: "text-emerald-400" },
  failed: { label: "Failed", color: "text-red-400" },
};

function formatDuration(ms: number | null): string {
  if (!ms) return "-";
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

function calculateSessionDuration(startedAt: Date | null, completedAt: Date | null): string {
  if (!startedAt) return "-";
  const end = completedAt ? new Date(completedAt) : new Date();
  const start = new Date(startedAt);
  const diffMs = end.getTime() - start.getTime();
  return formatDuration(diffMs);
}

interface SessionDetailProps {
  sessionId: string;
}

export function SessionDetail({ sessionId }: SessionDetailProps) {
  const { data, isLoading, error } = useQuery<SessionDetailResponse>({
    queryKey: ["scrape-history", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/scrape-history?sessionId=${sessionId}`);
      if (!res.ok) throw new Error("Failed to fetch session details");
      return res.json();
    },
    refetchInterval: (query) => {
      // Refresh every 2 seconds if session is in progress
      const session = query.state.data?.session;
      return session?.status === "in_progress" ? 2000 : false;
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
    ? STATUS_CONFIG.success
    : session.status === "failed"
    ? STATUS_CONFIG.error
    : STATUS_CONFIG.partial;
  const SessionStatusIcon = sessionStatusConfig.icon;

  return (
    <div className="space-y-6">
      {/* Header Navigation */}
      <div className="flex items-center justify-between">
        <Link href="/history">
          <Button variant="ghost" className="text-zinc-400 hover:text-white -ml-2 pl-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to History
          </Button>
        </Link>
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
                <span className="capitalize">{session.triggerSource}</span>
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
            const logStatusConfig = STATUS_CONFIG[log.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.partial;
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
                      {formatDuration(log.duration)}
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
