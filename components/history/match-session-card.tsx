"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  XCircle,
  Clock,
  Sparkles,
  Loader2,
  Building2,
  Trash2,
  Play,
  Square,
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
import { TRIGGER_LABELS } from "@/components/scrape-history/constants";
import {
  formatDurationFromDates,
  formatTime,
  formatDate,
} from "@/lib/utils/format";
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


interface MatchSessionCardProps {
  session: MatchSession;
}

export function MatchSessionCard({ session }: MatchSessionCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const queryClient = useQueryClient();

  const statusConfig = getSessionStatusConfig(session.status);
  const StatusIcon = statusConfig.icon;

  const progress = session.jobsTotal
    ? Math.round(((session.jobsCompleted || 0) / session.jobsTotal) * 100)
    : 0;

  const successRate = session.jobsTotal
    ? Math.round(((session.jobsSucceeded || 0) / session.jobsTotal) * 100)
    : 0;

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

  const markSessionStoppedInCache = () => {
    const now = new Date();

    queryClient.setQueryData([
      "match-history",
    ], (old: { sessions?: MatchSession[] } | undefined) => {
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
      "match-history",
      session.id,
    ], (old: { session?: MatchSession } | undefined) => {
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
      const res = await fetch(`/api/match-history?sessionId=${encodeURIComponent(session.id)}`, {
        method: "PATCH",
      });

      if (!res.ok) throw new Error("Failed to stop session");

      toast.success("Stopping match session");
      queryClient.invalidateQueries({ queryKey: ["match-history"] });
      queryClient.invalidateQueries({ queryKey: ["match-history", session.id] });
    } catch (error) {
      console.error("Failed to stop session:", error);
      toast.error("Failed to stop match session");
      queryClient.invalidateQueries({ queryKey: ["match-history"] });
      queryClient.invalidateQueries({ queryKey: ["match-history", session.id] });
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
      href={`/history/match/${session.id}`}
      className="group block rounded-lg border border-border bg-card p-4 transition-all hover:border-border"
    >
        {/* Main Card Content */}
        <div>
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
                  <h3 className="font-medium text-foreground">
                    {formatDate(session.startedAt)} <span className="text-muted-foreground">at</span> {formatTime(session.startedAt)}
                  </h3>
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-0.5">
                  <span className="flex items-center gap-1">
                    <Play className="h-3 w-3" />
                    {TRIGGER_LABELS[session.triggerSource] || session.triggerSource}
                  </span>

                  {session.companyName && (
                    <>
                      <span className="text-muted-foreground">•</span>
                      <span className="flex items-center gap-1 text-purple-600 dark:text-purple-400">
                        <Building2 className="h-3 w-3" />
                        {session.companyName}
                      </span>
                    </>
                  )}
                </div>
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
                    className="h-8 w-8 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
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
                    className="bg-red-500 hover:bg-red-600 text-foreground"
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
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Matching Jobs...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Meta Stats */}
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-foreground/80 font-medium">{session.jobsTotal || 0}</span> Total
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="font-medium text-emerald-600 dark:text-emerald-400">{session.jobsSucceeded || 0}</span> Succeeded
          </span>
          {session.jobsFailed ? (
            <span className="flex items-center gap-1.5">
              <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
              <span className="font-medium text-red-600 dark:text-red-400">{session.jobsFailed}</span> Failed
            </span>
          ) : null}
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-yellow-500" />
            <span
              className={`font-medium ${
                successRate >= 75
                  ? "text-emerald-600 dark:text-emerald-400"
                  : successRate >= 50
                    ? "text-yellow-600 dark:text-yellow-400"
                    : "text-red-600 dark:text-red-400"
              }`}
            >
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
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              {formatDurationFromDates(session.startedAt, session.completedAt)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
