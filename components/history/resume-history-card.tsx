"use client";

import Link from "next/link";

import {
  AlertTriangle,
  Briefcase,
  GraduationCap,
  Sparkles,
  XCircle,
} from "lucide-react";

import { RESUME_PARSE_STATE_CONFIG } from "@/components/history/resume-history-state";
import {
  MetaLine,
  SessionStat,
  StatusPill,
  StatusRail,
} from "@/components/history/shared/session-primitives";
import { Badge } from "@/components/ui/badge";
import type { ResumeHistoryEntry } from "@/lib/api/contracts/history";
import { cn } from "@/lib/utils";
import {
  formatDate,
  formatFileSize,
  formatTime,
} from "@/lib/utils/format";

export function ResumeHistoryCard({ entry }: { entry: ResumeHistoryEntry }) {
  const config = RESUME_PARSE_STATE_CONFIG[entry.parseState];
  const StateIcon = config.icon;
  const createdAt = entry.createdAt ? new Date(entry.createdAt) : null;
  const summary = entry.parsedSummary;

  return (
    <Link
      href={`/history/ai/resume/${encodeURIComponent(entry.id)}`}
      className="group relative block overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-border/60"
    >
      <StatusRail className={config.railColor} />
      <div className="py-4 pl-5 pr-4 sm:pl-6 sm:pr-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
                config.bgColor
              )}
            >
              <StateIcon
                className={cn("h-5 w-5", config.color, config.spin && "animate-spin")}
              />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="truncate text-[15px] font-semibold text-foreground">
                  {entry.fileName ?? "Unnamed upload"}
                </h3>
                {entry.version === null ? null : (
                  <span className="shrink-0 rounded border border-border bg-muted/40 px-2 py-1 text-[11px] leading-none text-muted-foreground">
                    v{entry.version}
                  </span>
                )}
                {entry.isCurrent ? (
                  <Badge
                    variant="outline"
                    className="h-5 border-0 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-400"
                  >
                    Current
                  </Badge>
                ) : null}
                {entry.storageState && entry.storageState !== "ready" ? (
                  <Badge
                    variant="outline"
                    className="h-5 border-0 bg-amber-500/10 px-1.5 text-[10px] text-amber-400"
                  >
                    {entry.storageState}
                  </Badge>
                ) : null}
              </div>
              <MetaLine
                className="mt-1"
                items={[
                  createdAt && `${formatDate(createdAt)} at ${formatTime(createdAt)}`,
                  entry.fileType?.toUpperCase(),
                  entry.fileSizeBytes === null
                    ? null
                    : formatFileSize(entry.fileSizeBytes),
                  entry.aiRun && `${entry.aiRun.provider} · ${entry.aiRun.modelId}`,
                  config.hint,
                ]}
              />
            </div>
          </div>

          <StatusPill
            label={config.label}
            className={cn("border-transparent", config.color, config.bgColor)}
          />
        </div>

        {summary || entry.warnings.length > 0 || entry.aiRun?.errorCode ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border/60 pt-3">
            {summary ? (
              <>
                <SessionStat
                  value={summary.skillCount}
                  label="skills"
                  icon={Sparkles}
                />
                <SessionStat
                  value={summary.experienceCount}
                  label="roles"
                  icon={Briefcase}
                />
                <SessionStat
                  value={summary.educationCount}
                  label="education"
                  icon={GraduationCap}
                />
              </>
            ) : null}
            {entry.warnings.length > 0 ? (
              <SessionStat
                value={entry.warnings.length}
                label={`field warning${entry.warnings.length === 1 ? "" : "s"}`}
                icon={AlertTriangle}
              />
            ) : null}
            {entry.aiRun?.errorCode ? (
              <span className="flex items-center gap-1.5 text-xs text-red-400">
                <XCircle className="h-3.5 w-3.5 shrink-0" />
                {entry.aiRun.errorCode}
              </span>
            ) : null}
          </div>
        ) : null}

      </div>
    </Link>
  );
}
