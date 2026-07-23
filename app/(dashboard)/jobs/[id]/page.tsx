"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ApiErrorState } from "@/components/ui/api-error-state";
import { Badge } from "@/components/ui/badge";
import { MatchBadge } from "@/components/jobs/match-badge";
import {
  MatchBreakdown,
  MatchStaleNote,
} from "@/components/jobs/match-breakdown";
import { ApplyButton } from "@/components/jobs/apply-button";
import { JobAIActions } from "@/components/jobs/job-ai-actions";
import { LegacyMatchAlert } from "@/components/jobs/legacy-match-alert";
import { MarkdownRenderer } from "@/components/jobs/markdown-renderer";
import { getJob, updateJob } from "@/lib/api/clients/jobs";
import { getApiErrorMessage, isApiNotFoundError } from "@/lib/api/error-presentation";
import { sanitizeHtmlContent } from "@/lib/jobs/description-processor";
import type { JobStatus } from "@/lib/jobs/status";
import { useQueuedJobMatch } from "@/lib/hooks/use-queued-job-match";
import { cacheOwnership, queryKeys } from "@/lib/query-keys";
import {
  Building2,
  Calendar,
  MapPin,
  Briefcase,
  ArrowLeft,
  Sparkles,
  Loader2,
  Star,
  CheckCircle,
} from "lucide-react";
import { toast } from "sonner";

const STATUS_OPTIONS: Array<{ value: JobStatus; label: string; color: string }> = [
  { value: "new", label: "New", color: "text-blue-400" },
  { value: "viewed", label: "Viewed", color: "text-muted-foreground" },
  { value: "interested", label: "Interested", color: "text-purple-400" },
  { value: "applied", label: "Applied", color: "text-emerald-400" },
  { value: "rejected", label: "Rejected", color: "text-red-400" },
  { value: "archived", label: "Archived", color: "text-muted-foreground" },
];

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const jobId = parseInt(params.id as string);
  const hasValidJobId = Number.isInteger(jobId) && jobId > 0;

  const { data: job, error, isError, isLoading, refetch } = useQuery({
    queryKey: queryKeys.jobs.detail(jobId),
    queryFn: () => getJob(jobId),
    enabled: hasValidJobId,
  });
  const {
    mutation: calculateMatchMutation,
    isMatching,
  } = useQueuedJobMatch({
    jobId: hasValidJobId ? jobId : 0,
  });
  const isReadOnlyPostingAction = job?.status === "applied" || job?.status === "archived";

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: JobStatus) => {
      return updateJob(jobId, { status: newStatus });
    },
    onSuccess: () => void cacheOwnership.jobMutation(queryClient, {
      jobId,
      companyId: job?.company.id,
    }),
    onError: (mutationError) => {
      toast.error(getApiErrorMessage(mutationError, "Failed to update job status"));
    },
  });

  useEffect(() => {
    if (job && job.status === "new") {
      updateStatusMutation.mutate("viewed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status]);

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
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError && !isApiNotFoundError(error)) {
    return (
      <ApiErrorState
        error={error}
        fallbackMessage="The job could not be loaded."
        onRetry={() => void refetch()}
      />
    );
  }

  if (!hasValidJobId || isApiNotFoundError(error) || !job) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Job not found</p>
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
      <div className="mb-6 border-b border-border pb-6">
        <div className="flex items-start gap-4">
          <Link
            href={`/companies/${job.company.id}/jobs`}
            className="transition-opacity hover:opacity-85"
            title={`View company details for ${job.company.name}`}
            aria-label={`View company details for ${job.company.name}`}
          >
            {job.company.logoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={job.company.logoUrl}
                alt={job.company.name}
                className="h-16 w-16 rounded-lg bg-muted object-contain p-2"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-2xl font-medium text-muted-foreground">
                {job.company.name.charAt(0).toUpperCase()}
              </div>
            )}
          </Link>

          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-foreground">{job.title}</h1>
            <p className="mt-1 flex items-center gap-1 text-muted-foreground">
              <Building2 className="h-4 w-4" />
              {job.company.name}
            </p>

            {/* Meta */}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {job.salary && (
                <span className="flex items-center gap-1 text-emerald-400">
                  {job.salary}
                </span>
              )}
              {job.seniorityLevel && (
                <Badge variant="outline" className="border-border">
                  {job.seniorityLevel.charAt(0).toUpperCase() + job.seniorityLevel.slice(1)}
                </Badge>
              )}
              {job.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {job.location}
                </span>
              )}
              {job.locationType && (
                <Badge variant="outline" className="border-border">
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
                <Badge variant="outline" className="border-border">
                  {job.employmentType}
                </Badge>
              )}
              {job.postedDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  Posted {formatDate(job.postedDate)}
                </span>
              )}
            </div>
          </div>

          {job.matchScore !== null ? (
            <MatchBadge score={job.matchScore} size="lg" showLabel />
          ) : job.matchStale ? (
            <Badge variant="outline" className="border-amber-500/40 text-amber-300">
              Match stale
            </Badge>
          ) : null}
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => calculateMatchMutation.mutate()}
            disabled={isMatching}
          >
            {isMatching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isMatching
              ? "Scoring..."
              : job.matchLegacy
                ? "Rematch"
                : job.matchResultId
                  ? "Refresh Match"
                  : "Calculate Match"}
          </Button>

          {/* Status selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Status:</span>
            <select
              value={job.status}
              onChange={(e) => {
                const selected = STATUS_OPTIONS.find((option) => option.value === e.target.value);
                if (selected) {
                  updateStatusMutation.mutate(selected.value);
                }
              }}
              className="h-8 rounded border border-border bg-card px-2 text-sm text-foreground"
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
            companyId={job.company.id}
            jobStatus={job.status}
          />

          <ApplyButton
            url={job.url}
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

      {/* Match Analysis */}
      {(job.matchResultId !== null || job.matchLegacy) && (
        <div className="mb-6 rounded-lg border border-border bg-card/70 p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium text-foreground">Match Analysis</h2>
            {job.matchStale && !job.matchLegacy ? <MatchStaleNote /> : null}
          </div>

          <div className="space-y-4">
            {job.matchLegacy ? (
              <LegacyMatchAlert />
            ) : (
                  <MatchBreakdown
                    breakdown={job.matchBreakdown}
                    summary={job.matchSummary}
                    reasoning={job.matchReasoning}
                    matchedSkills={job.matchedSkills}
                  />
            )}
          </div>
        </div>
      )}

      {/* Description */}
      {job.description && (
        <div className="pb-8">
          <h2 className="mb-4 text-lg font-medium text-foreground">Job Description</h2>
          {job.descriptionFormat === "html" ? (
            <div
              className="text-sm text-foreground/80 prose prose-invert prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: sanitizeHtmlContent(job.description) }}
            />
          ) : job.descriptionFormat === "plain" ? (
            <p className="text-sm text-foreground/80 whitespace-pre-wrap">{job.description}</p>
          ) : (
            <MarkdownRenderer
              content={job.description}
              className="text-sm text-foreground/80"
            />
          )}
        </div>
      )}
    </div>
  );
}
