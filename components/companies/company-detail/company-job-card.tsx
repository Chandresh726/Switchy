"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin, CheckCircle, Star, Loader2, CalendarDays } from "lucide-react";

import { NewJobBadge } from "@/components/jobs/new-job-badge";
import { MatchBadge } from "@/components/jobs/match-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateJob } from "@/lib/api/clients/jobs";
import { isNewJob } from "@/lib/jobs/is-new-job";
import type { JobStatus } from "@/lib/jobs/status";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils/format";

import type { CompanyJob } from "@/lib/api/contracts/companies";

interface CompanyJobCardProps {
  job: CompanyJob;
  currentTime: number;
}

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  viewed: "bg-muted text-muted-foreground border-border",
  interested: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  applied: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  rejected: "bg-red-500/10 text-red-400 border-red-500/20",
  archived: "bg-muted text-muted-foreground border-border",
};

const LOCATION_TYPE_LABELS: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

export function CompanyJobCard({ job, currentTime }: CompanyJobCardProps) {
  const queryClient = useQueryClient();
  const shouldShowNewTag = isNewJob({
    discoveredAt: job.discoveredAt,
    viewedAt: job.viewedAt,
    status: job.status,
    currentTime,
  });
  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: JobStatus) => {
      return updateJob(job.id, { status: newStatus });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-overview"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  return (
    <Link
      href={`/jobs/${job.id}`}
      className="group block rounded-lg border border-border bg-card/70 p-4 transition-all hover:border-emerald-500/30"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-foreground truncate">{job.title}</h3>
            {shouldShowNewTag ? (
              <NewJobBadge />
            ) : job.status !== "new" ? (
              <Badge
                variant="outline"
                className={cn("text-[11px]", STATUS_COLORS[job.status] || STATUS_COLORS.new)}
              >
                {job.status}
              </Badge>
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
            {job.discoveredAt && (
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                {formatRelativeTime(new Date(job.discoveredAt))}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <MatchBadge score={job.matchScore} size="sm" showLabel />

          <div className="flex items-center gap-1" onClick={(e) => e.preventDefault()}>
            {job.status === "interested" ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => updateStatusMutation.mutate("viewed")}
                className="text-purple-400 hover:text-purple-300"
              >
                <Star className="h-3.5 w-3.5 fill-current" />
                Saved
              </Button>
            ) : job.status !== "applied" && job.status !== "archived" ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => updateStatusMutation.mutate("interested")}
                disabled={updateStatusMutation.isPending}
              >
                {updateStatusMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Star className="h-3.5 w-3.5" />
                )}
                Save
              </Button>
            ) : null}

            {job.status === "applied" ? (
              <Button
                variant="ghost"
                size="xs"
                className="text-emerald-400 hover:text-emerald-300"
              >
                <CheckCircle className="h-3.5 w-3.5 fill-current" />
                Applied
              </Button>
            ) : job.status !== "archived" ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => updateStatusMutation.mutate("applied")}
                disabled={updateStatusMutation.isPending}
              >
                {updateStatusMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle className="h-3.5 w-3.5" />
                )}
                Applied
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </Link>
  );
}
