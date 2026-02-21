"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  MessageCircle,
  Pencil,
  Save,
  Star,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { canOpenLinkedInProfile } from "@/lib/connections/message";
import { applyConnectionPlaceholder } from "@/lib/connections/referral-template";
import { cn } from "@/lib/utils";

interface JobResponse {
  jobs: Array<{
    id: number;
    title: string;
    company: {
      id: number;
      name: string;
    };
  }>;
}

interface ReferralVariant {
  id: number;
  variant: string;
  userPrompt?: string | null;
  createdAt: string;
}

interface ReferralContent {
  id: number;
  content: string;
  history: ReferralVariant[];
}

interface ReferralContentResponse {
  exists: boolean;
  content: ReferralContent | null;
}

interface ConnectionResponse {
  connections: Array<{
    id: number;
    firstName: string;
    fullName: string;
    profileUrl: string;
    position: string | null;
    email: string | null;
    isStarred: boolean;
  }>;
}

export default function ReferralSendPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const jobId = Number(params.id);
  const requestedVariantId = Number(searchParams.get("variantId") || "0");

  const [isContentLoading, setIsContentLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<ReferralContent | null>(null);
  const [currentVariantIndex, setCurrentVariantIndex] = useState(0);
  const [editedContent, setEditedContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [modificationPrompt, setModificationPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const hasInitializedVariant = useRef(false);

  const hasChanges = editedContent !== originalContent;
  const currentVariant = generatedContent?.history[currentVariantIndex];

  const { data: jobData, isLoading: isJobLoading } = useQuery<JobResponse>({
    queryKey: ["job", jobId],
    queryFn: async () => {
      const res = await fetch(`/api/jobs?id=${jobId}`);
      if (!res.ok) throw new Error("Failed to fetch job");
      return res.json();
    },
    enabled: Number.isFinite(jobId),
  });

  const job = jobData?.jobs?.[0];

  const { data: connectionsData, isLoading: isConnectionsLoading } = useQuery<ConnectionResponse>({
    queryKey: ["connections", "company", job?.company.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/connections?companyId=${job?.company.id}&active=true&limit=200&sortBy=isStarred&sortOrder=desc`
      );
      if (!res.ok) throw new Error("Failed to fetch company connections");
      return res.json();
    },
    enabled: Boolean(job?.company.id),
  });

  const starMutation = useMutation({
    mutationFn: async ({ id, isStarred }: { id: number; isStarred: boolean }) => {
      const res = await fetch(`/api/connections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isStarred }),
      });
      if (!res.ok) throw new Error("Failed to update star");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
  });

  const selectVariantByIndex = useCallback(
    (index: number, content?: ReferralContent | null) => {
      const nextContent = content || generatedContent;
      if (!nextContent || nextContent.history.length === 0) {
        return;
      }

      const safeIndex = Math.min(Math.max(index, 0), nextContent.history.length - 1);
      const variantText = nextContent.history[safeIndex]?.variant || nextContent.content;
      setCurrentVariantIndex(safeIndex);
      setEditedContent(variantText);
      setOriginalContent(variantText);
    },
    [generatedContent]
  );

  const generateContent = useCallback(
    async (userPrompt?: string) => {
      setIsContentLoading(true);
      try {
        const res = await fetch("/api/ai/content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId,
            type: "referral",
            userPrompt: userPrompt || null,
          }),
        });

        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || "Failed to generate");
        }

        const data = await res.json();
        const content = data.content as ReferralContent;
        setGeneratedContent(content);
        hasInitializedVariant.current = true;
        selectVariantByIndex(content.history.length - 1, content);
      } catch (error) {
        console.error("Generation error:", error);
        toast.error(error instanceof Error ? error.message : "Failed to generate content");
      } finally {
        setIsContentLoading(false);
      }
    },
    [jobId, selectVariantByIndex]
  );

  const checkExistingContent = useCallback(async () => {
    setIsContentLoading(true);
    try {
      const res = await fetch(`/api/ai/content?jobId=${jobId}&type=referral`);
      if (!res.ok) {
        throw new Error("Failed to load referral content");
      }
      const data = (await res.json()) as ReferralContentResponse;

      if (data.exists && data.content) {
        const content = data.content;
        setGeneratedContent(content);
        const requestedIndex = requestedVariantId
          ? content.history.findIndex((item) => item.id === requestedVariantId)
          : -1;
        const targetIndex = requestedIndex >= 0 ? requestedIndex : content.history.length - 1;
        selectVariantByIndex(targetIndex, content);
        hasInitializedVariant.current = true;
        return;
      }
    } catch (error) {
      console.error("Error checking existing referral:", error);
      toast.error("Failed to load saved referral content");
    } finally {
      setIsContentLoading(false);
    }

    await generateContent();
  }, [generateContent, jobId, requestedVariantId, selectVariantByIndex]);

  useEffect(() => {
    if (Number.isFinite(jobId) && !hasInitializedVariant.current) {
      checkExistingContent();
    }
  }, [checkExistingContent, jobId]);

  const currentTemplate = useMemo(() => {
    if (hasChanges) {
      return editedContent;
    }
    return currentVariant?.variant || generatedContent?.content || "";
  }, [currentVariant, editedContent, generatedContent, hasChanges]);

  const handleContentChange = (value: string) => {
    setEditedContent(value);
  };

  const copyText = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(successMessage);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const handleCopyCurrent = async () => {
    if (!currentTemplate.trim()) return;
    await copyText(currentTemplate, "Copied to clipboard");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveEdit = async () => {
    if (!generatedContent || !editedContent.trim()) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/ai/content/${generatedContent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: editedContent,
          userPrompt: "Manual edit",
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to save");
      }

      const data = await res.json();
      const content = data.content as ReferralContent;
      setGeneratedContent(content);
      selectVariantByIndex(content.history.length - 1, content);
      toast.success("Saved as new variant");
    } catch (error) {
      console.error("Save error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save variant");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendModification = async () => {
    if (!modificationPrompt.trim()) return;
    const prompt = modificationPrompt;
    setModificationPrompt("");
    setIsSending(true);
    try {
      await generateContent(prompt);
    } finally {
      setIsSending(false);
    }
  };

  const handleNavigateVariant = (direction: "prev" | "next") => {
    if (!generatedContent || generatedContent.history.length === 0) return;
    const historyLength = generatedContent.history.length;
    const nextIndex =
      direction === "prev"
        ? currentVariantIndex > 0
          ? currentVariantIndex - 1
          : historyLength - 1
        : currentVariantIndex < historyLength - 1
          ? currentVariantIndex + 1
          : 0;
    selectVariantByIndex(nextIndex);
  };

  const contentStatusText = isSaving
    ? "Saving variant..."
    : isSending
      ? "Generating update..."
      : isContentLoading
        ? "Updating content..."
        : null;

  if (isJobLoading || (isContentLoading && !generatedContent)) {
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
        <div className="rounded-xl border border-border bg-card/70 p-4">
          <Skeleton className="h-6 w-44" />
          <div className="mt-4 space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <EmptyState
        icon={UserRound}
        title="Job not found"
        description="Unable to load the job for referral outreach."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
            <MessageCircle className="h-6 w-6 text-purple-400" />
            Referral Workspace
          </h1>
          <p className="mt-1 text-muted-foreground">
            {job.title} at {job.company.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.push(`/jobs/${job.id}`)}>
            View Job Page
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              Generate variants, iterate edits, then lock to send personalized outreach.
            </p>
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
              onClick={handleCopyCurrent}
              disabled={!currentTemplate.trim()}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              Copy Template
            </Button>
            {isPreviewMode ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsPreviewMode(false)}
                disabled={isContentLoading || isSending || isSaving}
              >
                <Pencil className="h-4 w-4" />
                Edit Message
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => setIsPreviewMode(true)}
                disabled={!currentTemplate.trim() || isContentLoading || isSending || isSaving}
              >
                <Linkedin className="h-4 w-4" />
                Ask Connections
              </Button>
            )}
          </div>
        </div>

        {!isPreviewMode && generatedContent && generatedContent.history.length > 1 ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-border py-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => handleNavigateVariant("prev")}
                disabled={isPreviewMode}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground">
                Variant {currentVariantIndex + 1} of {generatedContent.history.length}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => handleNavigateVariant("next")}
                disabled={isPreviewMode}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {currentVariant?.userPrompt ? (
              <div className="rounded-md border border-border bg-background/40 px-2.5 py-1 text-xs text-muted-foreground">
                {currentVariant.userPrompt === "Manual edit"
                  ? "Manual edit"
                  : `Request: ${currentVariant.userPrompt}`}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="pt-4">
          <div className="relative border border-border bg-background/30">
            {hasChanges && !isPreviewMode ? (
              <div className="absolute bottom-2 right-2 z-10 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditedContent(originalContent)}
                  className="h-7"
                >
                  Cancel
                </Button>
              <Button
                size="sm"
                className="h-7 bg-emerald-600 text-white hover:bg-emerald-500"
                onClick={handleSaveEdit}
                disabled={isSaving || isContentLoading || !editedContent.trim()}
              >
                  {isSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                  Save
                </Button>
              </div>
            ) : null}

            <Textarea
              value={editedContent}
              onChange={(event) => handleContentChange(event.target.value)}
              readOnly={isPreviewMode}
              disabled={isContentLoading || isSaving}
              className={cn(
                "min-h-[220px] resize-none border-0 bg-transparent p-4 text-sm leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0",
                isPreviewMode ? "cursor-default" : ""
              )}
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
                placeholder="Ask for changes (e.g., 'Make it shorter', 'Make it more direct')."
                disabled={isSending || isContentLoading || isSaving}
                className="min-h-[64px] resize-none border-border bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <Button
                onClick={() => void handleSendModification()}
                disabled={!modificationPrompt.trim() || isSending || isContentLoading || isSaving}
                className="h-[64px] w-[64px] shrink-0 bg-emerald-600 text-white hover:bg-emerald-500"
              >
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Press Enter to send, Shift+Enter for new line.
            </p>
          </div>
        ) : null}
      </div>

      {isPreviewMode ? (
        <div className="rounded-xl border border-border bg-card/70 p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-medium text-foreground">Connections at {job.company.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Copy a personalized message and open their profile to send manually.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link href="/connections">Open Connections</Link>
            </Button>
          </div>

          <div className="space-y-3">
            {isConnectionsLoading ? (
              <div className="space-y-3 py-1">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : connectionsData?.connections.length ? (
              connectionsData.connections.map((connection) => {
                const personalizedMessage = applyConnectionPlaceholder(currentTemplate, connection.firstName);
                const canOpenProfile = canOpenLinkedInProfile(connection.profileUrl);

                return (
                  <div
                    key={connection.id}
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-yellow-300"
                        onClick={() =>
                          starMutation.mutate({ id: connection.id, isStarred: !connection.isStarred })
                        }
                        title={connection.isStarred ? "Unstar connection" : "Star connection"}
                      >
                        <Star
                          className={cn("h-4 w-4", connection.isStarred && "fill-yellow-300 text-yellow-300")}
                        />
                      </button>
                      <div>
                        <p className="font-medium text-foreground">{connection.fullName}</p>
                        <p className="text-xs text-muted-foreground">
                          {connection.position || "Position N/A"}
                          {connection.email && (
                            <span className="ml-2 text-muted-foreground/70">
                              • {connection.email}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() =>
                          copyText(personalizedMessage, `Copied message for ${connection.fullName}`)
                        }
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy Message
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={!canOpenProfile}
                        title={canOpenProfile ? "Open LinkedIn profile" : "Invalid LinkedIn URL"}
                        onClick={() =>
                          window.open(connection.profileUrl, "_blank", "noopener,noreferrer")
                        }
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
                icon={UserRound}
                title="No mapped connections for this company"
                description="Import and map connections on the Connections page, then return here for one-click outreach."
                action={{
                  label: "Go to Connections",
                  onClick: () => router.push("/connections"),
                }}
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
