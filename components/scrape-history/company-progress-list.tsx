import Link from "next/link";
import {
  AlertCircle,
  Archive,
  Briefcase,
  Clock,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDateTime, formatDurationMs } from "@/lib/utils/format";
import { MATCHER_STATUS_CONFIG } from "@/lib/utils/status-config";

export interface SessionLog {
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
  jobsArchived: number | null;
  errorMessage: string | null;
  duration: number | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  matcherStatus: string | null;
  matcherJobsTotal: number | null;
  matcherJobsCompleted: number | null;
  matcherDuration: number | null;
  matcherErrorCount: number | null;
  attemptNumber: number;
  attemptsTotal: number;
  isFinalAttempt: boolean;
}

export interface ScrapeQueueItem {
  id: string;
  companyId: number;
  companyName: string | null;
  companyLogoUrl?: string | null;
  platform?: string | null;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  availableAt: Date | string;
  workerId: string | null;
  lockedAt: Date | string | null;
  leaseExpiresAt: Date | string | null;
  cancelRequested: boolean;
  lastError: string | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface CompanyProgress {
  key: string;
  companyId: number | null;
  queueItem?: ScrapeQueueItem;
  logs: SessionLog[];
}

const STATUS_STYLES: Record<
  string,
  { label: string; badge: string; rail: string }
> = {
  queued: {
    label: "Waiting",
    badge: "border-amber-500/20 bg-amber-500/10 text-amber-400",
    rail: "bg-amber-400",
  },
  running: {
    label: "Scraping",
    badge: "border-blue-500/20 bg-blue-500/10 text-blue-400",
    rail: "bg-blue-400",
  },
  success: {
    label: "Complete",
    badge: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    rail: "bg-emerald-400",
  },
  completed: {
    label: "Complete",
    badge: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    rail: "bg-emerald-400",
  },
  partial: {
    label: "Partial",
    badge: "border-amber-500/20 bg-amber-500/10 text-amber-400",
    rail: "bg-amber-400",
  },
  error: {
    label: "Failed",
    badge: "border-red-500/20 bg-red-500/10 text-red-400",
    rail: "bg-red-400",
  },
  failed: {
    label: "Failed",
    badge: "border-red-500/20 bg-red-500/10 text-red-400",
    rail: "bg-red-400",
  },
  cancelled: {
    label: "Cancelled",
    badge: "border-zinc-500/20 bg-zinc-500/10 text-zinc-400",
    rail: "bg-zinc-500",
  },
};

const DEFAULT_STATUS_STYLE = {
  label: "Pending",
  badge: "border-border bg-muted/40 text-muted-foreground",
  rail: "bg-muted-foreground",
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

function ProgressMetric({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number | null | undefined;
  icon: typeof Briefcase;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <p
        className={cn(
          "mt-1 text-sm font-semibold tabular-nums text-foreground",
          accent && "text-emerald-400"
        )}
      >
        {value === null || value === undefined ? "—" : value}
      </p>
    </div>
  );
}

function CompanyProgressRow({ progress }: { progress: CompanyProgress }) {
  const latestLog = getLatestLog(progress);
  const queueItem = progress.queueItem;
  const status = getProgressStatus(progress);
  const statusStyle = STATUS_STYLES[status] ?? DEFAULT_STATUS_STYLE;
  const companyName = getCompanyName(progress);
  const logoUrl = latestLog?.companyLogoUrl ?? queueItem?.companyLogoUrl;
  const platform = latestLog?.platform ?? queueItem?.platform;
  const matcherConfig = latestLog?.matcherStatus
    ? MATCHER_STATUS_CONFIG[latestLog.matcherStatus] ?? MATCHER_STATUS_CONFIG.pending
    : null;
  const issueLogs = progress.logs.filter((log) => log.errorMessage);
  const queueErrorIsDistinct =
    queueItem?.lastError &&
    !issueLogs.some((log) => log.errorMessage === queueItem.lastError);

  return (
    <article className="relative overflow-hidden rounded-lg border border-border bg-card">
      <div className={cn("absolute inset-y-0 left-0 w-1", statusStyle.rail)} />
      <div className="p-4 pl-5 sm:p-5 sm:pl-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={companyName}
                className="h-10 w-10 shrink-0 rounded-lg bg-muted object-contain p-1.5"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground">
                {companyName.charAt(0).toUpperCase()}
              </div>
            )}

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="truncate font-medium text-foreground">
                  {companyName}
                </h4>
                {platform && (
                  <Badge
                    variant="outline"
                    className="h-5 border-border bg-background/40 px-1.5 text-[10px] text-muted-foreground"
                  >
                    {platform}
                  </Badge>
                )}
                <Badge variant="outline" className={cn("h-5 px-2 text-[10px]", statusStyle.badge)}>
                  {status === "running" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  {statusStyle.label}
                </Badge>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {queueItem && (
                  <span className="flex items-center gap-1.5">
                    <RefreshCw className="h-3 w-3" />
                    {queueItem.attemptCount === 0
                      ? "Not started"
                      : `Attempt ${queueItem.attemptCount} of ${queueItem.maxAttempts}`}
                  </span>
                )}
                {latestLog?.duration !== null && latestLog?.duration !== undefined && (
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    {formatDurationMs(latestLog.duration)}
                  </span>
                )}
                {queueItem?.startedAt && (
                  <span>Started {formatDateTime(new Date(queueItem.startedAt))}</span>
                )}
                {queueItem?.status === "queued" && queueItem.attemptCount > 0 && (
                  <span>Retry at {formatDateTime(new Date(queueItem.availableAt))}</span>
                )}
                {queueItem?.status === "running" && queueItem.leaseExpiresAt && (
                  <span>Lease until {formatDateTime(new Date(queueItem.leaseExpiresAt))}</span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-x-5 gap-y-3 border-t border-border/70 pt-4 sm:grid-cols-5 xl:min-w-[460px] xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
            <ProgressMetric label="Found" value={latestLog?.jobsFound} icon={Briefcase} />
            <ProgressMetric label="New" value={latestLog?.jobsAdded} icon={Plus} accent />
            <ProgressMetric label="Updated" value={latestLog?.jobsUpdated} icon={RefreshCw} />
            <ProgressMetric label="Filtered" value={latestLog?.jobsFiltered} icon={Filter} />
            <ProgressMetric label="Archived" value={latestLog?.jobsArchived} icon={Archive} />
          </div>
        </div>

        {(issueLogs.length > 0 || queueErrorIsDistinct) && (
          <div className="mt-4 space-y-2 border-t border-border/70 pt-4">
            {issueLogs.map((log) => {
              const warning = log.status === "partial";
              return (
                <div
                  key={log.id}
                  className={cn(
                    "flex gap-2 rounded-md border px-3 py-2.5",
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
                    <span className="break-words font-mono text-[11px] opacity-90">
                      {log.errorMessage}
                    </span>
                  </div>
                </div>
              );
            })}
            {queueErrorIsDistinct && (
              <div className="flex gap-2 rounded-md border border-red-500/15 bg-red-500/5 px-3 py-2.5 text-red-300">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p className="break-words font-mono text-[11px] opacity-90">
                  {queueItem?.lastError}
                </p>
              </div>
            )}
          </div>
        )}

        {matcherConfig && latestLog?.matcherJobsTotal && latestLog.matcherJobsTotal > 0 && (
          <div className="mt-4 flex flex-col gap-2 border-t border-border/70 pt-4 text-xs sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-purple-400" />
              <span className="text-muted-foreground">Matching</span>
              <span className={cn("font-medium", matcherConfig.color)}>
                {matcherConfig.label}
              </span>
              {latestLog.matcherStatus === "in_progress" && (
                <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
              )}
            </div>
            <div className="flex items-center gap-3 text-muted-foreground">
              <span className="tabular-nums">
                {latestLog.matcherJobsCompleted ?? 0}/{latestLog.matcherJobsTotal}
              </span>
              {Boolean(latestLog.matcherErrorCount) && (
                <span className="flex items-center gap-1 text-red-400">
                  <AlertCircle className="h-3 w-3" />
                  {latestLog.matcherErrorCount}
                </span>
              )}
              <Link
                href="/history/match"
                className="text-blue-400 transition-colors hover:text-blue-300"
              >
                Match history
              </Link>
            </div>
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
      <div className="mb-4 flex flex-col gap-3 px-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="company-progress-heading" className="font-medium text-foreground">
            Company progress
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Queue state, scrape results, retries, and matching in one live view.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          {running > 0 && <span className="text-blue-400">{running} scraping</span>}
          {waiting > 0 && <span className="text-amber-400">{waiting} waiting</span>}
          {attention > 0 && <span className="text-red-400">{attention} need attention</span>}
          <span>{complete} complete</span>
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
