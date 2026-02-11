"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MatchBadge } from "./match-badge";
import { ApplyButton } from "./apply-button";
import { MarkdownRenderer } from "./markdown-renderer";
import {
  Building2,
  Calendar,
  MapPin,
  Briefcase,
  X,
  Sparkles,
  Check,
  AlertCircle,
  Lightbulb,
  Loader2,
} from "lucide-react";

interface Job {
  id: number;
  title: string;
  description: string | null;
  descriptionFormat: "markdown" | "plain" | "html";
  url: string;
  location: string | null;
  locationType: string | null;
  department: string | null;
  salary: string | null;
  employmentType: string | null;
  status: string;
  matchScore: number | null;
  matchReasons: string[];
  matchedSkills: string[];
  missingSkills: string[];
  recommendations: string[];
  postedDate: string | null;
  discoveredAt: string;
  company: {
    id: number;
    name: string;
    logoUrl: string | null;
    platform: string | null;
  };
}

interface JobDetailProps {
  job: Job;
  onClose: () => void;
}

const STATUS_OPTIONS = [
  { value: "new", label: "New", color: "text-blue-400" },
  { value: "viewed", label: "Viewed", color: "text-zinc-400" },
  { value: "interested", label: "Interested", color: "text-purple-400" },
  { value: "applied", label: "Applied", color: "text-emerald-400" },
  { value: "rejected", label: "Rejected", color: "text-red-400" },
  { value: "archived", label: "Archived", color: "text-zinc-500" },
];

export function JobDetail({ job, onClose }: JobDetailProps) {
  const queryClient = useQueryClient();

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
    return date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              {job.company.logoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={job.company.logoUrl}
                  alt={job.company.name}
                  className="h-12 w-12 rounded bg-zinc-800 object-contain p-1"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded bg-zinc-800 text-xl font-medium text-zinc-400">
                  {job.company.name.charAt(0).toUpperCase()}
                </div>
              )}

              <div>
                <h2 className="text-xl font-semibold text-white">{job.title}</h2>
                <p className="flex items-center gap-1 text-sm text-zinc-400">
                  <Building2 className="h-4 w-4" />
                  {job.company.name}
                </p>
              </div>
            </div>

            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Meta */}
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-zinc-400">
            {job.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {job.location}
              </span>
            )}
            {job.locationType && (
              <Badge variant="outline" className="border-zinc-700">
                {job.locationType}
              </Badge>
            )}
            {job.department && (
              <span className="flex items-center gap-1">
                <Briefcase className="h-4 w-4" />
                {job.department}
              </span>
            )}
            {job.postedDate && (
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                Posted {formatDate(job.postedDate)}
              </span>
            )}
            {job.salary && (
              <Badge variant="outline" className="border-emerald-500/30 text-emerald-400">
                {job.salary}
              </Badge>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-auto p-6">
          {/* Match Score Section */}
          <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <MatchBadge score={job.matchScore} size="lg" showLabel />
                <span className="text-sm text-zinc-400">Match Score</span>
              </div>

              {job.matchScore === null ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => calculateMatchMutation.mutate()}
                  disabled={calculateMatchMutation.isPending}
                >
                  {calculateMatchMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Calculate Match
                </Button>
              ) : null}
            </div>

            {job.matchScore !== null && (
              <div className="mt-4 space-y-4">
                {/* Match Reasons */}
                {job.matchReasons.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-sm font-medium text-white">Why this score?</h4>
                    <ul className="space-y-1 text-sm text-zinc-400">
                      {job.matchReasons.map((reason, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-zinc-500">•</span>
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Matched Skills */}
                {job.matchedSkills.length > 0 && (
                  <div>
                    <h4 className="mb-2 flex items-center gap-1 text-sm font-medium text-emerald-400">
                      <Check className="h-4 w-4" />
                      Matched Skills
                    </h4>
                    <div className="flex flex-wrap gap-1">
                      {job.matchedSkills.map((skill, i) => (
                        <Badge
                          key={i}
                          variant="outline"
                          className="border-emerald-500/30 text-emerald-400"
                        >
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Missing Skills */}
                {job.missingSkills.length > 0 && (
                  <div>
                    <h4 className="mb-2 flex items-center gap-1 text-sm font-medium text-orange-400">
                      <AlertCircle className="h-4 w-4" />
                      Skills to Develop
                    </h4>
                    <div className="flex flex-wrap gap-1">
                      {job.missingSkills.map((skill, i) => (
                        <Badge
                          key={i}
                          variant="outline"
                          className="border-orange-500/30 text-orange-400"
                        >
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendations */}
                {job.recommendations.length > 0 && (
                  <div>
                    <h4 className="mb-2 flex items-center gap-1 text-sm font-medium text-blue-400">
                      <Lightbulb className="h-4 w-4" />
                      Recommendations
                    </h4>
                    <ul className="space-y-1 text-sm text-zinc-400">
                      {job.recommendations.map((rec, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-zinc-500">•</span>
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Description */}
          {job.description && (
            <div>
              <h3 className="mb-3 text-lg font-medium text-white">Description</h3>
              <MarkdownRenderer
                content={job.description}
                className="text-sm text-zinc-300"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 border-t border-zinc-800 bg-zinc-950 p-4">
          <div className="flex items-center justify-between">
            {/* Status Selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">Status:</span>
              <select
                value={job.status}
                onChange={(e) => updateStatusMutation.mutate(e.target.value)}
                className="h-8 rounded-none border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <ApplyButton
                url={job.url}
                onApply={() => {
                  if (job.status !== "applied") {
                    updateStatusMutation.mutate("applied");
                  }
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
