"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Loader2,
  Square,
  Target,
  Trash2,
  XCircle,
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
import {
  cancelMatchHistorySession,
  deleteMatchHistorySession,
} from "@/lib/api/clients/history";
import type {
  MatchHistoryResponse,
  MatchHistoryDetailResponse,
  MatchHistorySession,
} from "@/lib/api/contracts/history";
import { TRIGGER_LABELS } from "@/components/history/shared/constants";
import {
  MetaLine,
  SessionStat,
  StatusPill,
  StatusRail,
  statusPillClass,
} from "@/components/history/shared/session-primitives";
import { cn } from "@/lib/utils";
import {
  formatDurationFromDates,
  formatTime,
  formatDate,
} from "@/lib/utils/format";
import { getSessionStatusConfig } from "@/lib/utils/status-config";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/error-presentation";

interface MatchSessionCardProps {
  session: MatchHistorySession;
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
  const isActiveSession = session.status === "in_progress" || session.status === "queued";
  const hasJobStats = (session.jobsTotal || 0) > 0;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteMatchHistorySession(session.id);

      void cacheOwnership.clearMatchHistory(queryClient);
      toast.success("Match session deleted successfully");
    } catch (error) {
      console.error("Failed to delete session:", error);
      toast.error(getApiErrorMessage(error, "Failed to delete match session"));
    } finally {
      setIsDeleting(false);
    }
  };

  const markSessionStoppedInCache = () => {
    const now = new Date();

    queryClient.setQueriesData<MatchHistoryResponse>({
      queryKey: queryKeys.matchHistory.lists(),
    }, (old) => {
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

    queryClient.setQueriesData<Pick<MatchHistoryDetailResponse, "session">>({
      queryKey: queryKeys.matchHistory.detailRoot(session.id),
    }, (old) => {
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
      await cancelMatchHistorySession(session.id);

      toast.success("Stopping match session");
      void cacheOwnership.updateMatchHistoryStatus(queryClient);
    } catch (error) {
      console.error("Failed to stop session:", error);
      toast.error(getApiErrorMessage(error, "Failed to stop match session"));
      void cacheOwnership.updateMatchHistoryStatus(queryClient);
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
      href={`/history/ai/matching/${session.id}`}
      className="group relative block overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-border/60"
    >
      <StatusRail className={statusConfig.railColor} />
      <div className="py-4 pl-5 pr-4 sm:pl-6 sm:pr-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
                statusConfig.bgColor
              )}
            >
              <StatusIcon className={cn("h-5 w-5", statusConfig.color)} />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-[15px] font-semibold text-foreground">
                  {formatDate(session.startedAt)}{" "}
                  <span className="font-normal text-muted-foreground">at</span>{" "}
                  {formatTime(session.startedAt)}
                </h3>
                <span className="shrink-0 rounded border border-border bg-muted/40 px-2 py-1 text-[11px] leading-none text-muted-foreground">
                  {TRIGGER_LABELS[session.triggerSource] || session.triggerSource}
                </span>
              </div>
              <MetaLine
                className="mt-1"
                items={[
                  session.companyName,
                  session.status !== "queued" &&
                    formatDurationFromDates(session.startedAt, session.completedAt),
                  session.completedAt && `Finished ${formatTime(session.completedAt)}`,
                ]}
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center gap-1" onClick={handleDeleteAreaClick}>
              {isActiveSession && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-amber-400 opacity-0 transition-opacity hover:bg-amber-500/10 hover:text-amber-300 group-hover:opacity-100"
                  onClick={handleStop}
                  disabled={isStopping}
                  title="Stop Session"
                >
                  {isStopping ? <Loader2 className="animate-spin" /> : <Square />}
                </Button>
              )}

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                    title="Delete Session"
                  >
                    <Trash2 />
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

            <StatusPill
              label={statusConfig.label}
              className={statusPillClass(statusConfig)}
            />
          </div>
        </div>

        {/* Progress Bar */}
        {session.status === "in_progress" && (
          <div className="mt-3 border-t border-border/60 pt-3">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>Matching Jobs...</span>
              <span className="tabular-nums">{progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Meta Stats */}
        {hasJobStats && (
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border/60 pt-3">
            <SessionStat
              value={`${session.jobsCompleted || 0}/${session.jobsTotal || 0}`}
              label="jobs"
              icon={Target}
            />
            <SessionStat
              value={session.jobsSucceeded || 0}
              label="matched"
              icon={CheckCircle2}
              accent="emerald"
            />
            <SessionStat
              value={session.jobsFailed || 0}
              label="failed"
              icon={XCircle}
              accent="red"
            />
          </div>
        )}
      </div>
    </Link>
  );
}
