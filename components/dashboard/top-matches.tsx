"use client";

import { useQuery } from "@tanstack/react-query";
import { MatchBadge } from "@/components/jobs/match-badge";
import { Building2, MapPin, Clock, ExternalLink } from "lucide-react";
import Link from "next/link";

interface Job {
  id: number;
  title: string;
  url: string;
  location: string | null;
  locationType: string | null;
  matchScore: number | null;
  discoveredAt: string;
  company: {
    id: number;
    name: string;
    logoUrl: string | null;
  };
}

export function TopMatches() {
  const { data, isLoading } = useQuery({
    queryKey: ["jobs", "top-matches"],
    queryFn: async () => {
      // Fetch top 5 unviewed jobs with highest match scores
      const res = await fetch("/api/jobs?status=new&sortBy=matchScore&sortOrder=desc&limit=5");
      if (!res.ok) throw new Error("Failed to fetch jobs");
      return res.json();
    },
  });

  const jobs: Job[] = data?.jobs || [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/50"
          />
        ))}
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-700 p-8 text-center">
        <p className="text-sm text-zinc-400">
          No new jobs with match scores yet. Add companies and refresh to see your top matches.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {jobs.map((job) => (
        <Link
          key={job.id}
          href={`/jobs/${job.id}`}
          className="group block rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-medium text-white group-hover:text-emerald-400">
                  {job.title}
                </h3>
                {job.matchScore !== null && (
                  <MatchBadge score={job.matchScore} size="sm" />
                )}
              </div>
              <div className="mt-1 flex items-center gap-3 text-sm text-zinc-400">
                <span className="flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" />
                  {job.company.name}
                </span>
                {job.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {job.location}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {formatRelativeTime(new Date(job.discoveredAt))}
                </span>
              </div>
            </div>
            <ExternalLink className="h-4 w-4 flex-shrink-0 text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </Link>
      ))}

      {jobs.length === 5 && (
        <Link
          href="/jobs?status=new&sortBy=matchScore"
          className="block text-center text-sm text-zinc-400 hover:text-zinc-300"
        >
          View all jobs
        </Link>
      )}
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
