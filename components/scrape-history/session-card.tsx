"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  ChevronRight,
  Building2,
  Briefcase,
  Filter,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

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

interface SessionCardProps {
  session: ScrapeSession;
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

export function SessionCard({ session }: SessionCardProps) {
  const statusConfig = STATUS_CONFIG[session.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.in_progress;
  const StatusIcon = statusConfig.icon;

  const progress = session.companiesTotal
    ? Math.round(((session.companiesCompleted || 0) / session.companiesTotal) * 100)
    : 0;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${statusConfig.bgColor}`}>
            <StatusIcon className={`h-5 w-5 ${statusConfig.color}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white">
                {formatDate(session.startedAt)} at {formatTime(session.startedAt)}
              </span>
              <Badge
                variant="outline"
                className="border-zinc-700 text-zinc-400 capitalize"
              >
                {session.triggerSource}
              </Badge>
            </div>
            <p className={`text-sm ${statusConfig.color}`}>
              {statusConfig.label} in {formatDuration(session.startedAt, session.completedAt)}
            </p>
          </div>
        </div>

        <Link href={`/history/${session.id}`}>
          <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white">
            Details
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      </div>

      {/* Progress Bar */}
      {session.status === "in_progress" && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
            <span>Companies: {session.companiesCompleted || 0}/{session.companiesTotal || 0}</span>
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
          <Building2 className="h-4 w-4 text-zinc-500" />
          <div>
            <p className="text-sm font-medium text-white">{session.companiesCompleted || 0}</p>
            <p className="text-xs text-zinc-500">Companies</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-zinc-500" />
          <div>
            <p className="text-sm font-medium text-white">{session.totalJobsFound || 0}</p>
            <p className="text-xs text-zinc-500">Found</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-500" />
          <div>
            <p className="text-sm font-medium text-emerald-400">{session.totalJobsAdded || 0}</p>
            <p className="text-xs text-zinc-500">New</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-zinc-500" />
          <div>
            <p className="text-sm font-medium text-zinc-400">{session.totalJobsFiltered || 0}</p>
            <p className="text-xs text-zinc-500">Filtered</p>
          </div>
        </div>
      </div>
    </div>
  );
}
