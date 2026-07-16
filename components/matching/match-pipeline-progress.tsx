"use client";

import Link from "next/link";

import { Check, CircleDot, Clock3, Loader2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  MatchJobProgress,
  MatchPhaseProgress,
} from "@/lib/hooks/use-match-session";

interface MatchPipelineProgressProps {
  analysis: MatchPhaseProgress;
  matching: MatchPhaseProgress;
  jobs: MatchJobProgress[];
  compact?: boolean;
}

interface PhaseProgressProps {
  label: string;
  value: MatchPhaseProgress;
  color: string;
}

function PhaseProgress({ label, value, color }: PhaseProgressProps) {
  const percentage = value.total > 0
    ? Math.round((value.completed / value.total) * 100)
    : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {value.completed}/{value.total}
          {value.active > 0 ? ` · ${value.active} active` : ""}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${label} progress`}
        aria-valuemin={0}
        aria-valuemax={value.total}
        aria-valuenow={value.completed}
      >
        <div
          className={cn("h-full transition-[width] duration-300", color)}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {value.queued > 0 ? <span>{value.queued} waiting</span> : null}
        {value.cached > 0 ? <span>{value.cached} cached</span> : null}
        {value.failed > 0 ? <span className="text-red-500">{value.failed} failed</span> : null}
      </div>
    </div>
  );
}

function stageLabel(job: MatchJobProgress): {
  label: string;
  icon: typeof Clock3;
  className: string;
} {
  if (job.matchStatus === "matching") {
    return { label: "Matching", icon: Loader2, className: "text-blue-500" };
  }
  if (job.analysisStatus === "analyzing") {
    return { label: "Analyzing", icon: Loader2, className: "text-violet-500" };
  }
  if (job.matchStatus === "completed") {
    return { label: "Matched", icon: Check, className: "text-emerald-500" };
  }
  if (job.matchStatus === "cached") {
    return { label: "Matched · cached", icon: Check, className: "text-emerald-500" };
  }
  if (job.matchStatus === "failed") {
    return {
      label: job.errorStage === "analysis" ? "Analysis failed" : "Match failed",
      icon: XCircle,
      className: "text-red-500",
    };
  }
  if (job.matchStatus === "queued") {
    return { label: "Ready to match", icon: CircleDot, className: "text-amber-500" };
  }
  return { label: "Waiting for analysis", icon: Clock3, className: "text-muted-foreground" };
}

export function MatchPipelineProgress({
  analysis,
  matching,
  jobs,
  compact = false,
}: MatchPipelineProgressProps) {
  const displayedJobs = compact ? jobs.slice(0, 6) : jobs;
  return (
    <div className="space-y-4 rounded-lg border border-border bg-background/40 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <PhaseProgress label="Job analysis" value={analysis} color="bg-violet-500" />
        <PhaseProgress label="Final matching" value={matching} color="bg-blue-500" />
      </div>

      {displayedJobs.length > 0 ? (
        <div className={cn("divide-y divide-border border-t border-border", !compact && "max-h-[28rem] overflow-y-auto")}>
          {displayedJobs.map((job) => {
            const stage = stageLabel(job);
            const StageIcon = stage.icon;
            return (
              <div key={job.jobId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <Link
                    href={`/jobs/${job.jobId}`}
                    className="block truncate font-medium text-foreground hover:underline"
                  >
                    {job.jobTitle}
                  </Link>
                  {job.companyName ? (
                    <p className="truncate text-xs text-muted-foreground">{job.companyName}</p>
                  ) : null}
                  {job.errorMessage && !compact ? (
                    <p className="mt-1 text-xs text-red-500">{job.errorMessage}</p>
                  ) : null}
                </div>
                <Badge variant="outline" className={cn("shrink-0 gap-1.5", stage.className)}>
                  <StageIcon className={cn("h-3 w-3", ["Matching", "Analyzing"].includes(stage.label) && "animate-spin")} />
                  {stage.label}
                </Badge>
              </div>
            );
          })}
          {compact && jobs.length > displayedJobs.length ? (
            <p className="py-2 text-xs text-muted-foreground">
              {jobs.length - displayedJobs.length} more jobs are in this session.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
