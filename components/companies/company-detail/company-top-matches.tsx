"use client";

import Link from "next/link";
import { ChevronRight, MapPin, CalendarDays } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils/format";

import type { CompanyJob } from "./types";

interface CompanyTopMatchesProps {
  jobs: CompanyJob[];
}

const LOCATION_TYPE_LABELS: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

function getMatchScoreConfig(score: number | null): { label: string; className: string } {
  if (typeof score !== "number") {
    return {
      label: "No score",
      className: "border-border bg-muted/40 text-muted-foreground",
    };
  }

  if (score >= 85) {
    return {
      label: `${score.toFixed(0)}% match`,
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    };
  }

  return {
    label: `${score.toFixed(0)}% match`,
    className: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  };
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function CompanyTopMatches({ jobs }: CompanyTopMatchesProps) {
  const topJobs = jobs
    .filter((job) => typeof job.matchScore === "number" && job.matchScore >= 75)
    .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))
    .slice(0, 3);

  if (topJobs.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">⭐</span>
        <h3 className="text-sm font-medium text-foreground">Top Matches</h3>
        <span className="text-xs text-muted-foreground">
          {topJobs.length} high-scoring role{topJobs.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {topJobs.map((job) => {
          const matchConfig = getMatchScoreConfig(job.matchScore);
          const postedDate = parseDate(job.discoveredAt);

          return (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="group flex flex-col gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 transition-all hover:border-emerald-500/40 hover:bg-emerald-500/10"
            >
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-sm font-medium text-foreground line-clamp-2">{job.title}</h4>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {job.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {job.location}
                  </span>
                )}
                {job.locationType && (
                  <Badge variant="outline" className="border-border text-[11px] text-muted-foreground">
                    {LOCATION_TYPE_LABELS[job.locationType] || job.locationType}
                  </Badge>
                )}
              </div>

              <div className="mt-auto flex items-center justify-between pt-2">
                <span
                  className={cn(
                    "inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium",
                    matchConfig.className
                  )}
                >
                  {matchConfig.label}
                </span>
                {postedDate && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <CalendarDays className="h-3 w-3" />
                    {formatRelativeTime(postedDate)}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
