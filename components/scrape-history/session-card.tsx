"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  XCircle,
  Clock,
  ChevronRight,
  Building2,
  Briefcase,
  Filter,
  Trash2,
  Play,
  Plus,
} from "lucide-react";
import Link from "next/link";
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
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  scheduled: "Auto Scrape",
  api: "API",
};

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
  const [isDeleting, setIsDeleting] = useState(false);
  const queryClient = useQueryClient();
  const statusConfig = STATUS_CONFIG[session.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.in_progress;
  const StatusIcon = statusConfig.icon;

  const progress = session.companiesTotal
    ? Math.round(((session.companiesCompleted || 0) / session.companiesTotal) * 100)
    : 0;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/scrape-history?sessionId=${session.id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete session");

      queryClient.invalidateQueries({ queryKey: ["scrape-history"] });
      toast.success("Session deleted successfully");
    } catch (error) {
      console.error("Failed to delete session:", error);
      toast.error("Failed to delete session");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="group rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 transition-all hover:border-zinc-700">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${statusConfig.bgColor}`}>
            <StatusIcon className={`h-5 w-5 ${statusConfig.color}`} />
          </div>
          <div>
            <h3 className="font-medium text-white">
              {formatDate(session.startedAt)} <span className="text-zinc-500">at</span> {formatTime(session.startedAt)}
            </h3>
            <p className="flex items-center gap-1 text-sm text-zinc-400">
              <Play className="h-3 w-3" />
              {TRIGGER_LABELS[session.triggerSource] || session.triggerSource}
            </p>
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
                <AlertDialogTitle>Delete Session?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete this scrape session and its logs.
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

          <Link href={`/history/scrape/${session.id}`}>
            <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white h-8">
              Details <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Progress Bar */}
      {session.status === "in_progress" && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
            <span>Processing Companies...</span>
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
          <Building2 className="h-3.5 w-3.5 text-zinc-400" />
          <span className="text-zinc-300 font-medium">{session.companiesCompleted || 0}/{session.companiesTotal || 0}</span> Companies
        </span>
        <span className="flex items-center gap-1.5">
          <Briefcase className="h-3.5 w-3.5 text-zinc-400" />
          <span className="text-zinc-300 font-medium">{session.totalJobsFound || 0}</span> Found
        </span>
        <span className="flex items-center gap-1.5">
          <Plus className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-emerald-400 font-medium">{session.totalJobsAdded || 0}</span> New
        </span>
        <span className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-zinc-400" />
          <span className="text-zinc-300 font-medium">{session.totalJobsFiltered || 0}</span> Filtered
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
    </div>
  );
}
