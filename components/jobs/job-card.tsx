"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MatchBadge } from "./match-badge";
import { ApplyButton } from "./apply-button";
import {
  Building2,
  Calendar,
  MapPin,
  Briefcase,
  Sparkles,
  CheckCircle,
  Star,
  DollarSign,
} from "lucide-react";

interface Job {
  id: number;
  title: string;
  url: string;
  location: string | null;
  locationType: string | null;
  department: string | null;
  salary: string | null;
  employmentType: string | null;
  seniorityLevel: string | null;
  status: string;
  matchScore: number | null;
  postedDate: string | null;
  discoveredAt: string;
  company: {
    id: number;
    name: string;
    logoUrl: string | null;
    platform: string | null;
  };
}

interface JobCardProps {
  job: Job;
}

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  viewed: "bg-muted text-muted-foreground border-border",
  interested: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  applied: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  rejected: "bg-red-500/10 text-red-400 border-red-500/20",
  archived: "bg-muted text-muted-foreground border-border",
};

const LOCATION_TYPE_ICONS: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

const SENIORITY_LABELS: Record<string, string> = {
  entry: "Entry",
  mid: "Mid",
  senior: "Senior",
  lead: "Lead",
  manager: "Manager",
  director: "Director",
  executive: "Executive",
};

export function JobCard({ job }: JobCardProps) {
  const queryClient = useQueryClient();
  const isReadOnlyPostingAction = job.status === "applied" || job.status === "archived";

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      const res = await fetch("/api/jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: job.id, status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const calculateMatchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      if (!res.ok) throw new Error("Failed to calculate match");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <Link
      href={`/jobs/${job.id}`}
      className="group block rounded-lg border border-border bg-card/70 p-4 transition-all hover:border-border"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {/* Company Logo */}
          {job.company.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={job.company.logoUrl}
              alt={job.company.name}
              className="h-10 w-10 rounded bg-muted object-contain p-1"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-lg font-medium text-muted-foreground">
              {job.company.name.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-foreground truncate">{job.title}</h3>
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              {job.company.name}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <MatchBadge score={job.matchScore} />
          {job.status !== "new" && (
            <Badge
              variant="outline"
              className={STATUS_COLORS[job.status] || STATUS_COLORS.new}
            >
              {job.status}
            </Badge>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {job.salary && (
          <span className="flex items-center gap-1 text-emerald-400">
            <DollarSign className="h-3.5 w-3.5" />
            {job.salary}
          </span>
        )}
        {job.seniorityLevel && (
          <Badge variant="outline" className="border-border text-muted-foreground">
            {SENIORITY_LABELS[job.seniorityLevel] || job.seniorityLevel}
          </Badge>
        )}
        {job.location && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {job.location}
          </span>
        )}
        {job.locationType && (
          <Badge variant="outline" className="border-border text-muted-foreground">
            {LOCATION_TYPE_ICONS[job.locationType] || job.locationType}
          </Badge>
        )}
        {job.department && (
          <span className="flex items-center gap-1">
            <Briefcase className="h-3.5 w-3.5" />
            {job.department}
          </span>
        )}
        {job.postedDate && (
          <span className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {formatDate(job.postedDate)}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        {/* Left side - Save and Mark Applied buttons */}
        <div className="flex items-center gap-2" onClick={(e) => e.preventDefault()}>
          {/* Save/Unsave Button */}
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
          ) : job.status !== "applied" ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => updateStatusMutation.mutate("interested")}
            >
              <Star className="h-3.5 w-3.5" />
              Save
            </Button>
          ) : null}

          {/* Mark Applied / Applied Button */}
          {job.status === "applied" ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => updateStatusMutation.mutate("viewed")}
              className="text-emerald-400 hover:text-emerald-300"
            >
              <CheckCircle className="h-3.5 w-3.5 fill-current" />
              Applied
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => updateStatusMutation.mutate("applied")}
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Mark Applied
            </Button>
          )}

          {/* Calculate Match - only show if no score */}
          {job.matchScore === null && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => calculateMatchMutation.mutate()}
              disabled={calculateMatchMutation.isPending}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {calculateMatchMutation.isPending ? "Scoring..." : "Score"}
            </Button>
          )}
        </div>

        {/* Right side - Apply button */}
        <div onClick={(e) => e.preventDefault()}>
          <ApplyButton
            url={job.url}
            size="xs"
            label={isReadOnlyPostingAction ? "Check Posting" : "Apply"}
            confirmOnOpen={!isReadOnlyPostingAction}
            onApply={
              isReadOnlyPostingAction
                ? undefined
                : () => {
                    if (job.status !== "applied") {
                      updateStatusMutation.mutate("applied");
                    }
                  }
            }
          />
        </div>
      </div>
    </Link>
  );
}
