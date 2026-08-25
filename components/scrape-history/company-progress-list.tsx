import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Clock,
  Hourglass,
  Loader2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import {
  MetaLine,
  SessionStat,
  StatusPill,
  StatusRail,
} from "@/components/history/shared/session-primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDateTime, formatDurationMs } from "@/lib/utils/format";
import { MATCHER_STATUS_CONFIG } from "@/lib/utils/status-config";
import type { ScrapeHistoryDetailResponse } from "@/lib/api/contracts/history";

type SessionLog = ScrapeHistoryDetailResponse["logs"][number];
type ScrapeQueueItem = ScrapeHistoryDetailResponse["queueItems"][number];

interface CompanyProgress {
  key: string;
  companyId: number | null;
  queueItem?: ScrapeQueueItem;
  logs: SessionLog[];
}

interface StatusStyle {
  label: string;
  badge: string;
  rail: string;
  icon: LucideIcon;
}

const STATUS_STYLES: Record<string, StatusStyle> = {
  queued: {
    label: "Waiting",
    badge: "border-amber-500/20 bg-amber-500/10 text-amber-400",
    rail: "bg-amber-400",
    icon: Hourglass,
  },
  running: {
    label: "Scraping",
    badge: "border-blue-500/20 bg-blue-500/10 text-blue-400",
    rail: "bg-blue-400",
    icon: Loader2,
  },
  success: {
    label: "Complete",
    badge: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    rail: "bg-emerald-400",
    icon: CheckCircle2,
  },
  completed: {
    label: "Complete",
    badge: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    rail: "bg-emerald-400",
    icon: CheckCircle2,
  },
  partial: {
    label: "Partial",
    badge: "border-amber-500/20 bg-amber-500/10 text-amber-400",
    rail: "bg-amber-400",
    icon: AlertTriangle,
  },
  error: {
    label: "Failed",
    badge: "border-red-500/20 bg-red-500/10 text-red-400",
    rail: "bg-red-400",
    icon: AlertCircle,
  },
  failed: {
    label: "Failed",
    badge: "border-red-500/20 bg-red-500/10 text-red-400",
    rail: "bg-red-400",
    icon: AlertCircle,
  },
  cancelled: {
    label: "Cancelled",
    badge: "border-zinc-500/20 bg-zinc-500/10 text-zinc-400",
    rail: "bg-zinc-500",
    icon: Ban,
  },
};

const DEFAULT_STATUS_STYLE: StatusStyle = {
  label: "Pending",
  badge: "border-border bg-muted/40 text-muted-foreground",
  rail: "bg-muted-foreground",
  icon: Clock,
};

const STATUS_ORDER: Record<string, number> = {
  running: 0,
  queued: 1,
  partial: 2,
  failed: 2,
  error: 2,
  cancelled: 3,
  completed: 4,
  success: 4,
};

function mergeCompanyProgress(
  queueItems: ScrapeQueueItem[],
  logs: SessionLog[]
): CompanyProgress[] {
  const progress = new Map<string, CompanyProgress>();

  for (const item of queueItems) {
    const key = `company-${item.companyId}`;
    progress.set(key, {
      key,
      companyId: item.companyId,
      queueItem: item,
      logs: [],
    });
  }

  for (const log of logs) {
    const key =
      log.companyId === null ? `log-${log.id}` : `company-${log.companyId}`;
    const entry = progress.get(key) ?? {
      key,
      companyId: log.companyId,
      logs: [],
    };
    entry.logs.push(log);
    progress.set(key, entry);
  }

  return Array.from(progress.values()).sort((left, right) => {
    const statusDifference =
      (STATUS_ORDER[getProgressStatus(left)] ?? 5) -
      (STATUS_ORDER[getProgressStatus(right)] ?? 5);
    if (statusDifference !== 0) return statusDifference;
    return getCompanyName(left).localeCompare(getCompanyName(right));
  });
}

function getLatestLog(progress: CompanyProgress): SessionLog | undefined {
  return progress.logs.at(-1);
}

function getProgressStatus(progress: CompanyProgress): string {
  const queueStatus = progress.queueItem?.status;
  if (queueStatus === "queued" || queueStatus === "running") {
    return queueStatus;
  }
  if (queueStatus === "failed" || queueStatus === "cancelled") {
    return queueStatus;
  }
  return getLatestLog(progress)?.status ?? queueStatus ?? "queued";
}

function getCompanyName(progress: CompanyProgress): string {
  return (
    getLatestLog(progress)?.companyName ??
    progress.queueItem?.companyName ??
    (progress.companyId === null ? "Unknown company" : `Company ${progress.companyId}`)
  );
}

function buildMetaItems(
  queueItem: ScrapeQueueItem | undefined,
  latestLog: SessionLog | undefined
): Array<string | false | null | undefined> {
  return [
    queueItem &&
      (queueItem.attemptCount === 0
        ? "Not started"
        : `Attempt ${queueItem.attemptCount} of ${queueItem.maxAttempts}`),
    latestLog?.duration !== null &&
      latestLog?.duration !== undefined &&
      formatDurationMs(latestLog.duration),
    latestLog?.fetchDuration != null &&
      `fetch ${formatDurationMs(latestLog.fetchDuration)}`,
    latestLog?.processingDuration != null &&
      `process ${formatDurationMs(latestLog.processingDuration)}`,
    latestLog?.persistenceDuration != null &&
      `save ${formatDurationMs(latestLog.persistenceDuration)}`,
    queueItem?.startedAt &&
      `Started ${formatDateTime(new Date(queueItem.startedAt))}`,
    queueItem?.status === "queued" &&
      queueItem.attemptCount > 0 &&
      `Retry at ${formatDateTime(new Date(queueItem.availableAt))}`,
    queueItem?.status === "running" &&
      queueItem.leaseExpiresAt &&
      `Lease until ${formatDateTime(new Date(queueItem.leaseExpiresAt))}`,
  ];
}

function CompanyProgressRow({ progress }: { progress: CompanyProgress }) {
  const latestLog = getLatestLog(progress);
  const queueItem = progress.queueItem;
  const status = getProgressStatus(progress);
  const statusStyle = STATUS_STYLES[status] ?? DEFAULT_STATUS_STYLE;
  const StatusIcon = statusStyle.icon;
  const companyName = getCompanyName(progress);
  const logoUrl = latestLog?.companyLogoUrl ?? queueItem?.companyLogoUrl;
  const platform = latestLog?.platform ?? queueItem?.platform;
  const meta = buildMetaItems(queueItem, latestLog);
  const matcherTotal = latestLog?.matcherJobsTotal ?? 0;
  const matcherConfig =
    latestLog?.matcherStatus && matcherTotal > 0
      ? MATCHER_STATUS_CONFIG[latestLog.matcherStatus] ?? MATCHER_STATUS_CONFIG.pending
      : null;
  const matchHref = latestLog?.matchSessionId
    ? `/history/ai/matching/${encodeURIComponent(latestLog.matchSessionId)}`
    : "/history/ai/matching";
  const issueLogs = progress.logs.filter((log) => log.errorMessage);
  const hasMetrics = [
    latestLog?.jobsFound,
    latestLog?.jobsAdded,
    latestLog?.jobsUpdated,
    latestLog?.jobsFiltered,
    latestLog?.jobsArchived,
  ].some((value) => (value ?? 0) > 0);
  const queueErrorIsDistinct =
    queueItem?.lastError &&
    !issueLogs.some((log) => log.errorMessage === queueItem.lastError);
  const queueErrorResolved = queueItem?.status === "completed";

  return (
    <article className="relative overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-border/60">
      <StatusRail className={statusStyle.rail} />
      <div className="py-4 pl-5 pr-4 sm:pl-6 sm:pr-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={companyName}
                className="h-10 w-10 shrink-0 rounded-md bg-muted object-contain p-1.5"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground">
                {companyName.charAt(0).toUpperCase()}
              </div>
            )}

            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h4 className="truncate text-[15px] font-semibold text-foreground">
                  {companyName}
                </h4>
                {platform && (
                  <span className="shrink-0 rounded border border-border bg-muted/40 px-2 py-1 text-[11px] leading-none text-muted-foreground">
                    {platform}
                  </span>
                )}
              </div>
              <MetaLine className="mt-1" items={meta} />
            </div>
          </div>

          <StatusPill
            label={statusStyle.label}
            className={statusStyle.badge}
            icon={StatusIcon}
            spin={status === "running"}
          />
        </div>

        {latestLog && hasMetrics && (
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 border-t border-border/60 pt-3">
            <SessionStat label="found" value={latestLog.jobsFound} />
            <SessionStat label="new" value={latestLog.jobsAdded} accent="emerald" />
            <SessionStat label="updated" value={latestLog.jobsUpdated} />
            <SessionStat label="filtered" value={latestLog.jobsFiltered} />
            <SessionStat label="archived" value={latestLog.jobsArchived} />
          </div>
        )}

        {matcherConfig && latestLog && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/60 pt-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <Sparkles className="h-4 w-4 text-purple-400" />
                Matching
              </span>
              <span
                className={cn(
                  "flex items-center gap-1.5 text-sm font-medium",
                  matcherConfig.color
                )}
              >
                {latestLog.matcherStatus === "in_progress" && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                {matcherConfig.label}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {latestLog.matcherJobsCompleted ?? 0}/{matcherTotal} jobs
              </span>
              {Boolean(latestLog.matcherErrorCount) && (
                <span className="flex items-center gap-1 text-xs text-red-400">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {latestLog.matcherErrorCount} failed
                </span>
              )}
            </div>

            <Button asChild variant="outline">
              <Link href={matchHref}>
                {latestLog.matchSessionId ? "Open match session" : "Match history"}
                <ArrowUpRight data-icon="inline-end" />
              </Link>
            </Button>
          </div>
        )}

        {(issueLogs.length > 0 || queueErrorIsDistinct) && (
          <div className="mt-3 space-y-2">
            {issueLogs.map((log) => {
              const warning = log.status === "partial";
              return (
                <div
                  key={log.id}
                  className={cn(
                    "flex gap-2 rounded-md border px-3 py-2",
                    warning
                      ? "border-amber-500/15 bg-amber-500/5 text-amber-300"
                      : "border-red-500/15 bg-red-500/5 text-red-300"
                  )}
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="min-w-0 text-xs">
                    {log.attemptsTotal > 1 && (
                      <span className="mr-2 font-medium">
                        Attempt {log.attemptNumber}
                        {log.isFinalAttempt ? " · final" : " · superseded"}
                      </span>
                    )}
                    <span className="break-words font-mono opacity-90">
                      {log.errorMessage}
                    </span>
                  </div>
                </div>
              );
            })}
            {queueErrorIsDistinct && (
              <div
                className={cn(
                  "flex gap-2 rounded-md border px-3 py-2",
                  queueErrorResolved
                    ? "border-amber-500/15 bg-amber-500/5 text-amber-300"
                    : "border-red-500/15 bg-red-500/5 text-red-300"
                )}
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p className="min-w-0 break-words font-mono text-xs opacity-90">
                  {queueErrorResolved && <span>Earlier queue attempt: </span>}
                  <span>{queueItem?.lastError}</span>
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export function CompanyProgressList({
  queueItems,
  logs,
}: {
  queueItems: ScrapeQueueItem[];
  logs: SessionLog[];
}) {
  const companies = mergeCompanyProgress(queueItems, logs);
  const statuses = companies.map(getProgressStatus);
  const running = statuses.filter((status) => status === "running").length;
  const waiting = statuses.filter((status) => status === "queued").length;
  const attention = statuses.filter((status) =>
    ["partial", "failed", "error"].includes(status)
  ).length;
  const complete = statuses.filter((status) =>
    ["completed", "success"].includes(status)
  ).length;

  return (
    <section aria-labelledby="company-progress-heading">
      <div className="mb-4 flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 id="company-progress-heading" className="text-base font-medium text-foreground">
            Company progress
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Queue state, scrape results, retries, and matching in one live view.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {running > 0 && (
            <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-blue-400">
              {running} scraping
            </span>
          )}
          {waiting > 0 && (
            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-amber-400">
              {waiting} waiting
            </span>
          )}
          {attention > 0 && (
            <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-red-400">
              {attention} need attention
            </span>
          )}
          <span className="rounded-full border border-border bg-muted/30 px-2.5 py-1 text-muted-foreground">
            {complete} complete
          </span>
        </div>
      </div>

      {companies.length > 0 ? (
        <div className="space-y-3">
          {companies.map((progress) => (
            <CompanyProgressRow key={progress.key} progress={progress} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No company work has been recorded for this session.
        </div>
      )}
    </section>
  );
}
