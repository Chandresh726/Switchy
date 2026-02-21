"use client";

import { useState, useMemo } from "react";
import { Briefcase, ArrowUp, ArrowDown } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";

import { CompanyJobCard } from "./company-job-card";
import { CompanyTopMatches } from "./company-top-matches";

import type { CompanyJob } from "./types";

interface CompanyJobsTabProps {
  jobs: CompanyJob[];
}

type SortKey = "matchScore" | "discoveredAt";
type SortDir = "desc" | "asc";
type StatusFilter = "all" | "new" | "viewed" | "interested" | "applied" | "rejected" | "archived";

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "matchScore", label: "Match Score" },
  { key: "discoveredAt", label: "Posted Date" },
];

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All Statuses" },
  { value: "new", label: "New" },
  { value: "viewed", label: "Viewed" },
  { value: "interested", label: "Saved" },
  { value: "applied", label: "Applied" },
  { value: "rejected", label: "Rejected" },
  { value: "archived", label: "Archived" },
];

function sortJobs(jobs: CompanyJob[], key: SortKey, dir: SortDir): CompanyJob[] {
  return [...jobs].sort((a, b) => {
    if (key === "matchScore") {
      const aScore = a.matchScore ?? -1;
      const bScore = b.matchScore ?? -1;
      return dir === "desc" ? bScore - aScore : aScore - bScore;
    }
    if (key === "discoveredAt") {
      const aTime = a.discoveredAt ? new Date(a.discoveredAt).getTime() : 0;
      const bTime = b.discoveredAt ? new Date(b.discoveredAt).getTime() : 0;
      return dir === "desc" ? bTime - aTime : aTime - bTime;
    }
    return 0;
  });
}

export function CompanyJobsTab({ jobs }: CompanyJobsTabProps) {
  const [sortKey, setSortKey] = useState<SortKey>("discoveredAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const filteredAndSorted = useMemo(() => {
    const filtered =
      statusFilter === "all" ? jobs : jobs.filter((j) => j.status === statusFilter);
    return sortJobs(filtered, sortKey, sortDir);
  }, [jobs, sortKey, sortDir, statusFilter]);

  if (jobs.length === 0) {
    return (
      <EmptyState
        icon={Briefcase}
        title="No jobs yet"
        description="Run a job refresh to discover open positions at this company."
      />
    );
  }

  const isFiltered = statusFilter !== "all";

  return (
    <div className="space-y-6">
      <CompanyTopMatches jobs={jobs} />

      <div className="space-y-3">
        {/* Header + controls row */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            All Roles{" "}
            <span className="text-foreground">
              ({filteredAndSorted.length}
              {isFiltered && (
                <span className="text-muted-foreground"> / {jobs.length}</span>
              )}
              )
            </span>
          </h3>

          {/* Controls — matching existing company-filters.tsx pattern */}
          <div className="flex items-center gap-2">
            {/* Status dropdown */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="h-7 border border-border bg-muted px-2 text-xs text-foreground/80"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <div className="h-5 w-px bg-muted" />

            {/* Sort dropdown */}
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="h-7 border border-border bg-muted px-2 text-xs text-foreground/80"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>

            {/* Sort direction toggle */}
            <button
              type="button"
              onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
              className="p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title={sortDir === "desc" ? "Descending" : "Ascending"}
            >
              {sortDir === "desc" ? (
                <ArrowDown className="h-3.5 w-3.5" />
              ) : (
                <ArrowUp className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Job list */}
        {filteredAndSorted.length === 0 ? (
          <div className="rounded-lg border border-border bg-muted/20 py-8 text-center text-sm text-muted-foreground">
            No roles match the selected filter.
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredAndSorted.map((job) => (
              <CompanyJobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
