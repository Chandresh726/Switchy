"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Archive,
  Briefcase,
  Building2,
  Filter,
  Loader2,
  Plus,
  Square,
  Trash2,
  type LucideIcon,
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
  cancelScrapeHistorySession,
  deleteScrapeHistorySession,
} from "@/lib/api/clients/history";
import type {
  ScrapeHistoryResponse,
  ScrapeHistoryDetailResponse,
  ScrapeHistorySession,
} from "@/lib/api/contracts/history";
import { cn } from "@/lib/utils";
import {
  formatDurationFromDates,
  formatTime,
  formatDate,
} from "@/lib/utils/format";
import { getSessionStatusConfig } from "@/lib/utils/status-config";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/error-presentation";

interface SessionCardProps {
  session: ScrapeHistorySession;
}

const STATUS_RAILS: Record<string, string> = {
  completed: "bg-emerald-400",
  success: "bg-emerald-400",
  in_progress: "bg-blue-400",
  partial: "bg-amber-400",
  skipped: "bg-amber-400",
  queued: "bg-zinc-500",
  failed: "bg-red-400",
  error: "bg-red-400",
  cancelled: "bg-zinc-500",
};

function CardStat({
  value,
  label,
  icon: Icon,
  accent,
}: {
  value: string | number;
  label: string;
  icon: LucideIcon;
  accent?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0 text-muted-foreground",
          accent && "text-emerald-400"
        )}
      />
      <span
        className={cn(
          "text-sm font-semibold leading-none tabular-nums text-foreground",
          accent && "text-emerald-400"
        )}
      >
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

export function SessionCard({ session }: SessionCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const queryClient = useQueryClient();
  const statusConfig = getSessionStatusConfig(session.status);
  const StatusIcon = statusConfig.icon;
  const displayTime = session.scheduledForAt ? new Date(session.scheduledForAt) : session.startedAt;

  const progress = session.companiesTotal
    ? Math.round(((session.companiesCompleted || 0) / session.companiesTotal) * 100)
    : 0;
  const hasJobStats = [
    session.totalJobsFound,
    session.totalJobsAdded,
    session.totalJobsFiltered,
    session.totalJobsArchived,
  ].some((value) => (value ?? 0) > 0);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteScrapeHistorySession(session.id);

      void cacheOwnership.clearScrapeHistory(queryClient);
      toast.success("Session deleted successfully");
    } catch (error) {
      console.error("Failed to delete session:", error);
      toast.error(getApiErrorMessage(error, "Failed to delete session"));
    } finally {
      setIsDeleting(false);
    }
  };

  const markSessionStoppedInCache = () => {
    const now = new Date();

    queryClient.setQueriesData<ScrapeHistoryResponse>({
      queryKey: queryKeys.scrapeHistory.lists(),
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

    queryClient.setQueriesData<Pick<ScrapeHistoryDetailResponse, "session">>({
      queryKey: queryKeys.scrapeHistory.detailRoot(session.id),
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
      await cancelScrapeHistorySession(session.id);

      toast.success("Stopping scrape session");
      void cacheOwnership.updateScrapeHistoryStatus(queryClient);
    } catch (error) {
      console.error("Failed to stop session:", error);
      toast.error(getApiErrorMessage(error, "Failed to stop scrape session"));
      void cacheOwnership.updateScrapeHistoryStatus(queryClient);
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
      className="group relative block overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-border/60"
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-[3px]",
          STATUS_RAILS[session.status] ?? "bg-muted-foreground"
        )}
      />
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
                  {formatDate(displayTime)}{" "}
                  <span className="font-normal text-muted-foreground">at</span>{" "}
                  {formatTime(displayTime)}
                </h3>
                <span className="shrink-0 rounded border border-border bg-muted/40 px-2 py-1 text-[11px] leading-none text-muted-foreground">
                  {TRIGGER_LABELS[session.triggerSource] || session.triggerSource}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span>
                  {formatDurationFromDates(session.startedAt, session.completedAt)}
                </span>
                {session.completedAt && (
                  <>
                    <span aria-hidden className="text-border">
                      &middot;
                    </span>
                    <span>Finished {formatTime(session.completedAt)}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center gap-1" onClick={handleDeleteAreaClick}>
              {session.status === "in_progress" && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-amber-400 opacity-0 transition-opacity hover:bg-amber-500/10 hover:text-amber-300 group-hover:opacity-100"
                  onClick={handleStop}
                  disabled={isStopping}
                  title="Stop Session"
                >
                  {isStopping ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Square />
                  )}
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
                      className="bg-red-500 hover:bg-red-600 text-foreground"
                      disabled={isDeleting}
                    >
                      {isDeleting ? "Deleting..." : "Delete"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            <span
              className={cn(
                "rounded-md border border-transparent px-2.5 py-1 text-xs font-medium",
                statusConfig.color,
                statusConfig.bgColor
              )}
            >
              {statusConfig.label}
            </span>
          </div>
        </div>

        {session.skipReason && (
          <div className="mt-3 rounded-md border border-amber-500/15 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
            {session.skipReason}
          </div>
        )}

        {/* Progress Bar */}
        {session.status === "in_progress" && (
          <div className="mt-3 border-t border-border/60 pt-3">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>Processing Companies...</span>
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
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border/60 pt-3">
          <CardStat
            value={`${session.companiesCompleted || 0}/${session.companiesTotal || 0}`}
            label="companies"
            icon={Building2}
          />
          {hasJobStats && (
            <>
              <CardStat
                value={session.totalJobsFound || 0}
                label="found"
                icon={Briefcase}
              />
              <CardStat
                value={session.totalJobsAdded || 0}
                label="new"
                icon={Plus}
                accent={(session.totalJobsAdded || 0) > 0}
              />
              <CardStat
                value={session.totalJobsFiltered || 0}
                label="filtered"
                icon={Filter}
              />
              <CardStat
                value={session.totalJobsArchived || 0}
                label="archived"
                icon={Archive}
              />
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
