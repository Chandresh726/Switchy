"use client";

import { useState } from "react";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Sparkles,
  Square,
  Target,
  Timer,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { TRIGGER_LABELS } from "@/components/history/shared/constants";
import {
  MetaLine,
  SessionStat,
  StatusPill,
  StatusRail,
  statusPillClass,
} from "@/components/history/shared/session-primitives";
import { AIRunTelemetry } from "@/components/history/shared/ai-run-telemetry";
import { MatchPhaseSummary } from "@/components/matching/match-pipeline-progress";
import { ApiErrorState } from "@/components/ui/api-error-state";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import {
  getMatchHistoryDetail,
  cancelMatchHistorySession,
  deleteMatchHistorySession,
} from "@/lib/api/clients/history";
import type { MatchHistoryDetailResponse } from "@/lib/api/contracts/history";
import { cn } from "@/lib/utils";
import { formatDurationMs, formatDurationFromDates, formatDateTime } from "@/lib/utils/format";
import { getSessionStatusConfig } from "@/lib/utils/status-config";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/error-presentation";

type MatchLog = MatchHistoryDetailResponse["logs"][number];

interface MatchSessionDetailProps {
  sessionId: string;
}

function runModel(
  run: { id: string; provider: string; modelId: string | null } | null | undefined
): string | null {
  if (!run) return null;
  return `${run.provider} · ${run.modelId ?? "unknown model"}`;
}

function MatchJobLogRow({ log }: { log: MatchLog }) {
  const failed = log.status === "failed";
  const hasJobId = log.jobId != null;
  const jobDisplay = log.jobTitle || (hasJobId ? `Job #${log.jobId}` : "Untitled Job");
  const labeledRunModels = [
    { label: "Analysis", model: runModel(log.analysisRun) },
    { label: "Match", model: runModel(log.matchRun) },
    { label: "Adjudication", model: runModel(log.adjudicationRun) },
  ].filter(
    (entry): entry is { label: string; model: string } => Boolean(entry.model)
  );
  const distinctRunModels = Array.from(new Set(
    labeledRunModels.map(({ model }) => model)
  ));
  const runModels = distinctRunModels.length === 1
    ? distinctRunModels
    : labeledRunModels.map(({ label, model }) => `${label} ${model}`);
  const hasRunModel = runModels.some(Boolean);

  const body = (
    <>
      <StatusRail className={failed ? "bg-red-400" : "bg-emerald-400"} />
      <div className="py-3.5 pl-5 pr-4 sm:pl-6 sm:pr-5">
        <div className="flex items-start gap-3">
          {log.companyLogoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={log.companyLogoUrl}
              alt={log.companyName || "Company"}
              className="size-10 shrink-0 rounded-lg bg-muted object-contain p-1.5"
            />
          ) : (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-medium text-muted-foreground">
              {(log.companyName || "?").charAt(0).toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-4">
              <h4
                className="truncate text-[15px] font-semibold text-foreground"
                title={log.jobTitle || undefined}
              >
                {jobDisplay}
              </h4>

              {failed ? (
                <StatusPill
                  label={log.errorType || "error"}
                  className="border-red-500/20 bg-red-500/10 text-red-400"
                  icon={AlertCircle}
                />
              ) : (
                <span className="flex shrink-0 items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-emerald-400" />
                  <span className="text-lg font-semibold leading-none tabular-nums text-emerald-400">
                    {log.score?.toFixed(0) ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">score</span>
                </span>
              )}
            </div>

            <div className="mt-1 flex min-w-0 items-center justify-between gap-3">
              <MetaLine
                items={[
                  log.companyName,
                  ...runModels,
                  !hasRunModel && log.modelUsed && `Model ${log.modelUsed}`,
                ]}
              />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatDurationMs(log.duration)}
              </span>
            </div>
          </div>
        </div>

        {failed && log.errorMessage && (
          <p className="ml-13 mt-2 break-words font-mono text-xs text-red-300/90">
            {log.errorMessage}
          </p>
        )}
      </div>
    </>
  );

  const shellClass = cn(
    "relative overflow-hidden rounded-lg border bg-card transition-colors",
    failed ? "border-red-500/20" : "border-border",
    hasJobId && (failed ? "hover:border-red-500/40" : "hover:border-border/60"),
    !hasJobId && "opacity-60"
  );

  return (
    <div className={shellClass}>
      {hasJobId ? (
        <Link href={`/jobs/${log.jobId}`} className="block">
          {body}
        </Link>
      ) : (
        <div aria-disabled="true">{body}</div>
      )}
      <AIRunTelemetry
        runs={[
          { label: "Job analysis", run: log.analysisRun },
          { label: "Match evaluation", run: log.matchRun },
          { label: "Match adjudication", run: log.adjudicationRun },
        ]}
      />
    </div>
  );
}

export function MatchSessionDetail({ sessionId }: MatchSessionDetailProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const router = useRouter();
  const queryClient = useQueryClient();
  const offset = (currentPage - 1) * pageSize;
  const detailParams = {
    logOffset: offset,
    logLimit: pageSize,
    workOffset: offset,
    workLimit: pageSize,
  };
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.matchHistory.detail(sessionId, detailParams),
    queryFn: async () => {
      return getMatchHistoryDetail(sessionId, detailParams);
    },
    refetchInterval: (query) => {
      const session = query.state.data?.session;
      if (!session) return 3000;
      return session.status === "in_progress" || session.status === "queued" ? 3000 : false;
    },
    refetchIntervalInBackground: false,
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      return cancelMatchHistorySession(sessionId);
    },
    onSuccess: () => {
      toast.success("Stopping match session");
      void cacheOwnership.updateMatchHistoryStatus(queryClient);
    },
    onError: (mutationError) => {
      toast.error(getApiErrorMessage(mutationError, "Failed to stop match session"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return deleteMatchHistorySession(sessionId);
    },
    onSuccess: () => {
      void cacheOwnership.clearMatchHistory(queryClient);
      router.push("/history/ai/matching");
    },
    onError: (mutationError) => {
      toast.error(getApiErrorMessage(mutationError, "Failed to delete match session"));
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <ApiErrorState
          error={error}
          fallbackMessage="Match session details could not be loaded."
          onRetry={() => void refetch()}
        />
        <Link href="/history/ai/matching">
          <Button variant="ghost" className="mt-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Match History
          </Button>
        </Link>
      </div>
    );
  }

  const { session, logs, logPagination, pipeline } = data;
  const statusConfig = getSessionStatusConfig(session.status);
  const StatusIcon = statusConfig.icon;
  const progress = session.jobsTotal
    ? Math.round(((session.jobsCompleted || 0) / session.jobsTotal) * 100)
    : 0;
  const isActiveSession = session.status === "in_progress" || session.status === "queued";
  const hasJobStats = (session.jobsTotal || 0) > 0;

  const failedCount = logs.filter((log) => log.status === "failed").length;
  const matchedCount = logs.length - failedCount;
  const totalRecords = logPagination.total;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  return (
    <div className="space-y-6">
      {/* Header Navigation */}
      <div className="flex items-center justify-between">
        <Link href="/history/ai/matching">
          <Button variant="ghost" className="text-muted-foreground hover:text-foreground -ml-2 pl-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Match History
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          {isActiveSession && (
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
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-start justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
                statusConfig.bgColor
              )}
            >
              <StatusIcon className={cn("h-5 w-5", statusConfig.color)} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-foreground">Match Session</h1>
              <MetaLine
                className="mt-1"
                items={[
                  formatDateTime(session.startedAt),
                  TRIGGER_LABELS[session.triggerSource] || session.triggerSource,
                  session.companyName,
                ]}
              />
            </div>
          </div>
          <StatusPill
            label={statusConfig.label}
            className={statusPillClass(statusConfig)}
          />
        </div>

        {/* Phase rollup only; individual jobs are listed under Job results. */}
        {pipeline.analysis.total > 0 ? (
          <div className="border-t border-border/60 px-5 py-4">
            <MatchPhaseSummary
              analysis={pipeline.analysis}
              matching={pipeline.matching}
            />
          </div>
        ) : session.status === "in_progress" ? (
          <div className="border-t border-border/60 px-5 py-3">
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
        ) : null}

        {/* Summary Stats */}
        <div className="flex flex-wrap items-center gap-x-7 gap-y-2.5 border-t border-border/60 px-5 py-3.5">
          <SessionStat
            size="md"
            value={`${session.jobsCompleted || 0}/${session.jobsTotal || 0}`}
            label="jobs"
            icon={Target}
          />
          {hasJobStats && (
            <>
              <SessionStat
                size="md"
                value={session.jobsSucceeded || 0}
                label="matched"
                icon={CheckCircle2}
                accent="emerald"
              />
              <SessionStat
                size="md"
                value={session.jobsFailed || 0}
                label="failed"
                icon={XCircle}
                accent="red"
              />
            </>
          )}
          <SessionStat
            size="md"
            value={formatDurationFromDates(session.startedAt, session.completedAt)}
            label="duration"
            icon={Timer}
          />
        </div>
      </div>

      {/* Job Logs */}
      <section aria-labelledby="match-logs-heading">
        <div className="mb-4 flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 id="match-logs-heading" className="text-base font-medium text-foreground">
              Job results
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Compatibility scores, models used, and failures for each job in this run.
            </p>
          </div>
          {logs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {failedCount > 0 && (
                <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-red-400">
                  {failedCount} failed
                </span>
              )}
              <span className="rounded-full border border-border bg-muted/30 px-2.5 py-1 text-muted-foreground">
                {matchedCount} matched
              </span>
            </div>
          )}
        </div>

        {logs.length > 0 ? (
          <div className="space-y-3">
            {logs.map((log) => (
              <MatchJobLogRow key={log.id} log={log} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No job results have been recorded for this session.
          </div>
        )}
      </section>

      {totalPages > 1 && (
        <Pagination
          ariaLabel="Match session records pagination"
          itemLabel="job records"
          currentPage={currentPage}
          totalPages={totalPages}
          totalCount={totalRecords}
          pageSize={pageSize}
          isFetching={isFetching}
          onPageChange={setCurrentPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setCurrentPage(1);
          }}
        />
      )}
    </div>
  );
}
