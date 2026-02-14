"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MatchBadge } from "@/components/jobs/match-badge";
import { ApplyButton } from "@/components/jobs/apply-button";
import { JobAIActions } from "@/components/jobs/job-ai-actions";
import { MarkdownRenderer } from "@/components/jobs/markdown-renderer";
import { sanitizeHtmlContent } from "@/lib/jobs/description-processor";
import {
  Building2,
  Calendar,
  MapPin,
  Briefcase,
  ArrowLeft,
  Sparkles,
  Check,
  AlertCircle,
  Lightbulb,
  Loader2,
  Star,
  CheckCircle,
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

const STATUS_OPTIONS = [
  { value: "new", label: "New", color: "text-blue-400" },
  { value: "viewed", label: "Viewed", color: "text-zinc-400" },
  { value: "interested", label: "Interested", color: "text-purple-400" },
  { value: "applied", label: "Applied", color: "text-emerald-400" },
  { value: "rejected", label: "Rejected", color: "text-red-400" },
  { value: "archived", label: "Archived", color: "text-zinc-500" },
];

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const jobId = parseInt(params.id as string);

  const { data: jobData, isLoading } = useQuery<{ jobs: Job[] }>({
    queryKey: ["job", jobId],
    queryFn: async () => {
      const res = await fetch(`/api/jobs?id=${jobId}`);
      if (!res.ok) throw new Error("Failed to fetch job");
      return res.json();
    },
  });

  const job = jobData?.jobs?.[0];

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      const res = await fetch("/api/jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: jobId, status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const calculateMatchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) throw new Error("Failed to calculate match");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job", jobId] });
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

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-zinc-400">Job not found</p>
        <Button variant="outline" onClick={() => router.push("/jobs")}>
          <ArrowLeft className="h-4 w-4" />
          Back to Jobs
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      {/* Back button */}
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={() => router.push("/jobs")}>
          <ArrowLeft className="h-4 w-4" />
          Back to Jobs
        </Button>
      </div>

      {/* Header */}
      <div className="mb-6 border-b border-zinc-800 pb-6">
        <div className="flex items-start gap-4">
          {job.company.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={job.company.logoUrl}
              alt={job.company.name}
              className="h-16 w-16 rounded-lg bg-zinc-800 object-contain p-2"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-zinc-800 text-2xl font-medium text-zinc-400">
              {job.company.name.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-white">{job.title}</h1>
            <p className="mt-1 flex items-center gap-1 text-zinc-400">
              <Building2 className="h-4 w-4" />
              {job.company.name}
            </p>

            {/* Meta */}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-zinc-400">
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
              {job.employmentType && (
                <Badge variant="outline" className="border-zinc-700">
                  {job.employmentType}
                </Badge>
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

          <MatchBadge score={job.matchScore} size="lg" showLabel />
        </div>

        {/* Action buttons */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {/* Save/Unsave */}
          {job.status === "interested" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateStatusMutation.mutate("viewed")}
              className="text-purple-400 border-purple-500/30"
            >
              <Star className="h-4 w-4 fill-current" />
              Saved
            </Button>
          ) : job.status !== "applied" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateStatusMutation.mutate("interested")}
            >
              <Star className="h-4 w-4" />
              Save
            </Button>
          ) : null}

          {/* Mark Applied / Applied */}
          {job.status === "applied" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateStatusMutation.mutate("viewed")}
              className="text-emerald-400 border-emerald-500/30"
            >
              <CheckCircle className="h-4 w-4 fill-current" />
              Applied
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateStatusMutation.mutate("applied")}
            >
              <CheckCircle className="h-4 w-4" />
              Mark Applied
            </Button>
          )}

          {/* Calculate Match */}
          {job.matchScore === null && (
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
              {calculateMatchMutation.isPending ? "Scoring..." : "Calculate Match"}
            </Button>
          )}

          {/* Status selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-500">Status:</span>
            <select
              value={job.status}
              onChange={(e) => updateStatusMutation.mutate(e.target.value)}
              className="h-8 rounded border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1" />

          <JobAIActions
            jobId={job.id}
            jobTitle={job.title}
            companyName={job.company.name}
          />

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

      {/* Match Analysis */}
      {job.matchScore !== null && (
        <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="mb-4 text-lg font-medium text-white">Match Analysis</h2>

          <div className="space-y-4">
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
        </div>
      )}

      {/* Description */}
      {job.description && (
        <div className="pb-8">
          <h2 className="mb-4 text-lg font-medium text-white">Job Description</h2>
          {job.descriptionFormat === "html" ? (
            <div
              className="text-sm text-zinc-300 prose prose-invert prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: sanitizeHtmlContent(job.description) }}
            />
          ) : job.descriptionFormat === "plain" ? (
            <p className="text-sm text-zinc-300 whitespace-pre-wrap">{job.description}</p>
          ) : (
            <MarkdownRenderer
              content={job.description}
              className="text-sm text-zinc-300"
            />
          )}
        </div>
      )}
    </div>
  );
}
