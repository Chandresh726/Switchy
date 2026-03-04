"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Clock,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  MessageCircle,
  Send,
  Trash2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

import type { AIContentType } from "@/lib/ai/contracts";
import { getContentTypeLabel, getWorkspacePathWithVariant } from "@/lib/ai/writing/workspace/routes";
import type { ContentResponse } from "@/lib/ai/writing/types";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
}

function getTypeConfig(type: AIContentType) {
  if (type === "referral") {
    return {
      bgColor: "bg-purple-500/10",
      color: "text-purple-400",
      hoverBorderColor: "hover:border-purple-500/40",
      icon: MessageCircle,
    };
  }

  if (type === "recruiter_follow_up") {
    return {
      bgColor: "bg-blue-500/10",
      color: "text-blue-400",
      hoverBorderColor: "hover:border-blue-500/40",
      icon: Send,
    };
  }

  return {
    bgColor: "bg-emerald-500/10",
    color: "text-emerald-400",
    hoverBorderColor: "hover:border-emerald-500/40",
    icon: FileText,
  };
}

interface AIHistoryCardProps {
  content: ContentResponse;
  isDeleting: boolean;
  onClick: () => void;
  onDelete: (id: number) => void;
}

function AIHistoryCard({ content, isDeleting, onClick, onDelete }: AIHistoryCardProps) {
  const typeConfig = getTypeConfig(content.type);
  const TypeIcon = typeConfig.icon;

  const handleDelete = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onDelete(content.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "group flex cursor-pointer flex-col gap-3 rounded-lg border p-4 transition-all duration-200",
        "bg-card/70 hover:bg-card",
        "border-border hover:border-border",
        typeConfig.hoverBorderColor
      )}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0">
          {content.companyLogoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={content.companyLogoUrl}
              alt={content.companyName || "Company"}
              className="h-10 w-10 rounded-lg bg-muted object-contain p-1.5"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-sm font-medium text-muted-foreground">
              {(content.companyName || "?").charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="truncate font-medium text-foreground">
              {content.jobTitle || "Untitled Job"}
            </h4>
            <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{content.companyName || "Unknown Company"}</span>
            </div>
          </div>

          <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-8 w-8 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete AI Content?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete this generated content. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-red-500 text-foreground hover:bg-red-600"
                    disabled={isDeleting}
                  >
                    {isDeleting ? "Deleting..." : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {content.history.length > 1 ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Layers className="h-3 w-3" />
            {content.history.length} variants
          </span>
        ) : null}

        <span className="mr-4 min-w-0 flex-1 truncate">
          {(content.history[content.history.length - 1]?.variant || content.content).slice(0, 80)}...
        </span>

        <div className="flex shrink-0 items-center gap-3">
          <Badge
            variant="outline"
            className={cn(
              "h-5 border-0 px-1.5 text-[10px]",
              typeConfig.bgColor,
              typeConfig.color
            )}
          >
            <TypeIcon className="mr-1 h-3 w-3" />
            {getContentTypeLabel(content.type)}
          </Badge>
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            {formatDate(content.updatedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function AIHistoryPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<{ contents: ContentResponse[] }>({
    queryKey: ["ai-history-all"],
    queryFn: async () => {
      const res = await fetch("/api/ai/history");
      if (!res.ok) throw new Error("Failed to fetch AI history");
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/ai/content/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-history-all"] });
      toast.success("Deleted successfully");
      setDeletingId(null);
    },
    onError: () => {
      toast.error("Failed to delete");
      setDeletingId(null);
    },
  });

  const contents = data?.contents || [];

  const groupedContents = contents.reduce((acc, content) => {
    const date = new Date(content.updatedAt);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let key: string;
    if (date.toDateString() === today.toDateString()) {
      key = "Today";
    } else if (date.toDateString() === yesterday.toDateString()) {
      key = "Yesterday";
    } else {
      key = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    }

    if (!acc[key]) acc[key] = [];
    acc[key].push(content);
    return acc;
  }, {} as Record<string, ContentResponse[]>);

  const handleDelete = (id: number) => {
    setDeletingId(id);
    deleteMutation.mutate(id);
  };

  const handleCardClick = (content: ContentResponse) => {
    const latestVariantId = content.history[content.history.length - 1]?.id;
    router.push(getWorkspacePathWithVariant(content.jobId, content.type, latestVariantId));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (contents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-16">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-card">
          <Wand2 className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="mb-1 text-lg font-medium text-foreground">No AI-generated content yet</h3>
        <p className="mb-6 max-w-md text-center text-sm text-muted-foreground">
          Generate referral messages, recruiter follow-ups, and cover letters from job pages to see them here
        </p>
        <Link href="/jobs">
          <Button variant="outline" className="border-border hover:bg-muted">
            <ExternalLink className="mr-2 h-4 w-4" />
            Browse Jobs
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {Object.entries(groupedContents).map(([date, items]) => (
        <div key={date}>
          <h3 className="sticky top-0 z-10 mb-3 bg-background py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {date}
          </h3>
          <div className="space-y-3">
            {items.map((content) => (
              <AIHistoryCard
                key={content.id}
                content={content}
                isDeleting={deletingId === content.id}
                onClick={() => handleCardClick(content)}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
