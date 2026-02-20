"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Clock,
  Building2,
  Briefcase,
  Filter,
  Trash2,
  Play,
  Plus,
  Square,
  Loader2,
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
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { TRIGGER_LABELS } from "./constants";
import {
  formatDurationFromDates,
  formatTime,
  formatDate,
} from "@/lib/utils/format";
import { getSessionStatusConfig } from "@/lib/utils/status-config";

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

export function SessionCard({ session }: SessionCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const queryClient = useQueryClient();
  const statusConfig = getSessionStatusConfig(session.status);
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

  const markSessionStoppedInCache = () => {
    const now = new Date();

    queryClient.setQueryData([
      "scrape-history",
    ], (old: { sessions?: ScrapeSession[] } | undefined) => {
      if (!old?.sessions) return old;
      return {
        ...old,
        sessions: old.sessions.map((item) =>
          item.id === session.id
            ? { ...item, status: "failed", completedAt: now }
            : item
        ),
      };
    });

    queryClient.setQueryData([
      "scrape-history",
      session.id,
    ], (old: { session?: ScrapeSession } | undefined) => {
      if (!old?.session) return old;
      return {
        ...old,
        session: {
          ...old.session,
          status: "failed",
          completedAt: now,
        },
      };
    });
  };

  const handleStop = async () => {
    setIsStopping(true);
    markSessionStoppedInCache();

    try {
      const res = await fetch(`/api/scrape-history?sessionId=${encodeURIComponent(session.id)}`, {
        method: "PATCH",
      });

      if (!res.ok) throw new Error("Failed to stop session");

      toast.success("Stopping scrape session");
      queryClient.invalidateQueries({ queryKey: ["scrape-history"] });
      queryClient.invalidateQueries({ queryKey: ["scrape-history", session.id] });
    } catch (error) {
      console.error("Failed to stop session:", error);
      toast.error("Failed to stop scrape session");
      queryClient.invalidateQueries({ queryKey: ["scrape-history"] });
      queryClient.invalidateQueries({ queryKey: ["scrape-history", session.id] });
    } finally {
      setIsStopping(false);
    }
  };

  const handleDeleteAreaClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <Link
      href={`/history/scrape/${session.id}`}
      className="group block rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 mb-3 transition-all hover:border-zinc-700"
    >
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

          <div className="flex items-center gap-2" onClick={handleDeleteAreaClick}>
            {session.status === "in_progress" && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={handleStop}
                disabled={isStopping}
                title="Stop Session"
              >
                {isStopping ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
              </Button>
            )}

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
            {formatDurationFromDates(session.startedAt, session.completedAt)}
          </span>
        </div>
      </div>
    </Link>
  );
}
