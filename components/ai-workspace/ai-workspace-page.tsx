"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Linkedin,
  Loader2,
  Pencil,
  Save,
  Star,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { RichTextEditor } from "@/components/ai-workspace/rich-text-editor";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { copyMarkdownToClipboard } from "@/lib/ai/writing/rich-text";
import { useAIContentWorkspace } from "@/lib/ai/writing/workspace/use-ai-content-workspace";
import type { AIContentType } from "@/lib/ai/contracts";
import { canOpenLinkedInProfile } from "@/lib/people/message";
import { isRecruiterPosition } from "@/lib/people/position";
import { applyConnectionPlaceholder } from "@/lib/people/referral-template";
import { cn } from "@/lib/utils";

interface JobResponse {
  jobs: Array<{
    id: number;
    status: string;
    title: string;
    company: {
      id: number;
      name: string;
    };
  }>;
}

interface PeopleResponse {
  people: Array<{
    email: string | null;
    firstName: string;
    fullName: string;
    id: number;
    isStarred: boolean;
    position: string | null;
    profileUrl: string;
  }>;
}

interface AIWorkspacePageProps {
  contentType: AIContentType;
  emptyStateDescription: string;
  icon: React.ElementType;
  iconClassName: string;
  peoplePanelDescription?: string;
  peoplePanelTitle?: string;
  peoplePanelToggleLabel?: string;
  peoplePanelEnabled?: boolean;
  requireApplied?: boolean;
  subtitle: string;
  title: string;
  workspaceHint: string;
}

function byRecruiterThenStarred(a: PeopleResponse["people"][number], b: PeopleResponse["people"][number]) {
  const recruiterDelta = Number(isRecruiterPosition(b.position)) - Number(isRecruiterPosition(a.position));
  if (recruiterDelta !== 0) return recruiterDelta;
  return Number(b.isStarred) - Number(a.isStarred);
}

export function AIWorkspacePage({
  contentType,
  emptyStateDescription,
  icon: Icon,
  iconClassName,
  peoplePanelDescription,
  peoplePanelEnabled = false,
  peoplePanelTitle,
  peoplePanelToggleLabel,
  requireApplied = false,
  subtitle,
  title,
  workspaceHint,
}: AIWorkspacePageProps) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const jobId = Number(params.id);
  const requestedVariantId = Number(searchParams.get("variantId") || "0");
  const [copied, setCopied] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  const { data: jobData, isLoading: isJobLoading } = useQuery<JobResponse>({
    enabled: Number.isFinite(jobId),
    queryKey: ["job", jobId],
    queryFn: async () => {
      const res = await fetch(`/api/jobs?id=${jobId}`);
      if (!res.ok) throw new Error("Failed to fetch job");
      return res.json();
    },
  });

  const job = jobData?.jobs?.[0];
  const canUseWorkspace = !requireApplied || job?.status === "applied";

  const {
    content,
    contentStatusText,
    currentContent,
    currentVariantIndex,
    currentVariantPrompt,
    hasChanges,
    isContentLoading,
    isSaving,
    isSending,
    modificationPrompt,
    navigateVariant,
    resetChanges,
    saveEdit,
    sendModification,
    setEditedContent,
    setModificationPrompt,
  } = useAIContentWorkspace({
    contentType,
    enabled: Boolean(job) && canUseWorkspace,
    jobId,
    requestedVariantId,
  });

  const { data: peopleData, isLoading: isPeopleLoading } = useQuery<PeopleResponse>({
    enabled: Boolean(job?.company.id) && peoplePanelEnabled,
    queryKey: ["people", "company", job?.company.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/people?companyId=${job?.company.id}&active=true&limit=200&sortBy=isStarred&sortOrder=desc`
      );
      if (!res.ok) throw new Error("Failed to fetch company people");
      return res.json();
    },
  });

  const starMutation = useMutation({
    mutationFn: async ({ id, isStarred }: { id: number; isStarred: boolean }) => {
      const res = await fetch(`/api/people/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isStarred }),
      });
      if (!res.ok) throw new Error("Failed to update star");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["people"] });
    },
  });

  const prioritizedPeople = useMemo(() => {
    const rows = peopleData?.people || [];
    return [...rows].sort(byRecruiterThenStarred);
  }, [peopleData]);

  const isBusy = isContentLoading || isSaving || isSending;

  const handleCopyCurrent = async () => {
    if (!currentContent.trim()) return;
    try {
      await copyMarkdownToClipboard(currentContent);
      setCopied(true);
      toast.success("Copied to clipboard");
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Copy failed:", error);
      toast.error("Failed to copy");
    }
  };

  const handleCopyForPerson = async (template: string, personName: string) => {
    try {
      await copyMarkdownToClipboard(template);
      toast.success(`Copied message for ${personName}`);
    } catch (error) {
      console.error("Copy for person failed:", error);
      toast.error("Failed to copy");
    }
  };

  const handleSendModification = async () => {
    if (!modificationPrompt.trim()) return;
    await sendModification();
  };

  if (isJobLoading || (isContentLoading && !content)) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="rounded-xl border border-border bg-card/70 p-4">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="mt-3 h-[220px] w-full" />
          <Skeleton className="mt-3 h-16 w-full" />
        </div>
        {peoplePanelEnabled ? (
          <div className="rounded-xl border border-border bg-card/70 p-4">
            <Skeleton className="h-6 w-44" />
            <div className="mt-4 space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (!job) {
    return (
      <EmptyState
        description={emptyStateDescription}
        icon={UserRound}
        title="Job not found"
      />
    );
  }

  if (requireApplied && job.status !== "applied") {
    return (
      <EmptyState
        title="Follow-up available after applying"
        description="Mark this job as Applied, then generate recruiter follow-up messages."
        icon={UserRound}
        action={{
          label: "Back to Job",
          onClick: () => router.push(`/jobs/${job.id}`),
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
            <Icon className={cn("h-6 w-6", iconClassName)} />
            {title}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {job.title} at {job.company.name}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              router.push(`/jobs/${job.id}`);
            }}
          >
            View Job Page
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{workspaceHint}</p>
            {contentStatusText ? (
              <p className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {contentStatusText}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void handleCopyCurrent();
              }}
              disabled={!currentContent.trim()}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              Copy Template
            </Button>

            {peoplePanelEnabled ? (
              isPreviewMode ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsPreviewMode(false)}
                  disabled={isBusy}
                >
                  <Pencil className="h-4 w-4" />
                  Edit Message
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => setIsPreviewMode(true)}
                  disabled={!currentContent.trim() || isBusy}
                >
                  <Linkedin className="h-4 w-4" />
                  {peoplePanelToggleLabel || "Ask People"}
                </Button>
              )
            ) : null}
          </div>
        </div>

        {!isPreviewMode && content && content.history.length > 1 ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-border py-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => navigateVariant("prev")}
                disabled={isPreviewMode}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground">
                Variant {currentVariantIndex + 1} of {content.history.length}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => navigateVariant("next")}
                disabled={isPreviewMode}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {currentVariantPrompt ? (
              <div className="rounded-md border border-border bg-background/40 px-2.5 py-1 text-xs text-muted-foreground">
                {currentVariantPrompt === "Manual edit"
                  ? "Manual edit"
                  : `Request: ${currentVariantPrompt}`}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="pt-4">
          <div className="relative">
            {hasChanges && !isPreviewMode ? (
              <div className="absolute bottom-2 right-2 z-10 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetChanges}
                  className="h-7"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-7 bg-emerald-600 text-white hover:bg-emerald-500"
                  onClick={() => {
                    void saveEdit();
                  }}
                  disabled={isBusy || !currentContent.trim()}
                >
                  {isSaving ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Save
                </Button>
              </div>
            ) : null}

            <RichTextEditor
              value={currentContent}
              onChange={setEditedContent}
              readOnly={isPreviewMode}
              disabled={isBusy}
            />
          </div>
        </div>

        {!isPreviewMode ? (
          <div className="mt-4 border-t border-border pt-4">
            <div className="flex gap-3">
              <Textarea
                value={modificationPrompt}
                onChange={(event) => setModificationPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (modificationPrompt.trim()) {
                      void handleSendModification();
                    }
                  }
                }}
                placeholder="Ask for changes (e.g., 'Make it shorter', 'Use a friendlier tone')."
                disabled={isBusy}
                className="min-h-[64px] resize-none border-border bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <Button
                onClick={() => {
                  void handleSendModification();
                }}
                disabled={!modificationPrompt.trim() || isBusy}
                className="h-[64px] w-[64px] shrink-0 bg-emerald-600 text-white hover:bg-emerald-500"
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-5 w-5" />
                )}
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Press Enter to send, Shift+Enter for new line.
            </p>
          </div>
        ) : null}
      </div>

      {peoplePanelEnabled && isPreviewMode ? (
        <div className="rounded-xl border border-border bg-card/70 p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-medium text-foreground">
                {peoplePanelTitle || `People at ${job.company.name}`}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {peoplePanelDescription || "Copy a personalized message and open their profile to send manually."}
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link href="/people">Open People</Link>
            </Button>
          </div>

          <div className="space-y-3">
            {isPeopleLoading ? (
              <div className="space-y-3 py-1">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : prioritizedPeople.length ? (
              prioritizedPeople.map((person) => {
                const personalizedMessage = applyConnectionPlaceholder(currentContent, person.firstName);
                const canOpenProfile = canOpenLinkedInProfile(person.profileUrl);
                const isRecruiter = isRecruiterPosition(person.position);

                return (
                  <div
                    key={person.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-yellow-300"
                        onClick={() => {
                          starMutation.mutate({ id: person.id, isStarred: !person.isStarred });
                        }}
                        title={person.isStarred ? "Unstar person" : "Star person"}
                      >
                        <Star
                          className={cn("h-4 w-4", person.isStarred && "fill-yellow-300 text-yellow-300")}
                        />
                      </button>

                      <div>
                        <p className="font-medium text-foreground">
                          {person.fullName}
                          {isRecruiter ? (
                            <span className="ml-2 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-300">
                              Recruiter
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {person.position || "Position N/A"}
                          {person.email ? <span className="ml-2 text-muted-foreground/70">• {person.email}</span> : null}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          void handleCopyForPerson(personalizedMessage, person.fullName);
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy Message
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={!canOpenProfile}
                        title={canOpenProfile ? "Open LinkedIn profile" : "Invalid LinkedIn URL"}
                        onClick={() => {
                          window.open(person.profileUrl, "_blank", "noopener,noreferrer");
                        }}
                      >
                        <Linkedin className="h-3.5 w-3.5" />
                        Open Profile
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <EmptyState
                action={{
                  label: "Go to People",
                  onClick: () => router.push("/people"),
                }}
                description="Import and map people on the People page, then return here for one-click outreach."
                icon={UserRound}
                title="No mapped people for this company"
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
