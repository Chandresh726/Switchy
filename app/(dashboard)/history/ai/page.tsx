"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Wand2,
  MessageCircle,
  FileText,
  Trash2,
  Clock,
  ExternalLink,
  Building2,
  Layers,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AIContentEditor } from "@/components/ai-content-editor";
import type { ContentResponse } from "@/lib/ai/writing/types";

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
    month: "short",
    day: "numeric",
  });
}

function getTypeConfig(type: string) {
  if (type === "referral") {
    return {
      icon: MessageCircle,
      label: "Referral Message",
      color: "text-purple-400",
      bgColor: "bg-purple-500/10",
      borderColor: "border-purple-500/20",
      hoverBorderColor: "hover:border-purple-500/40",
    };
  }
  return {
    icon: FileText,
    label: "Cover Letter",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
    hoverBorderColor: "hover:border-emerald-500/40",
  };
}

interface AIHistoryCardProps {
  content: ContentResponse;
  onDelete: (id: number) => void;
  isDeleting: boolean;
  onClick: () => void;
}

function AIHistoryCard({ content, onDelete, isDeleting, onClick }: AIHistoryCardProps) {
  const typeConfig = getTypeConfig(content.type);
  const TypeIcon = typeConfig.icon;

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDelete(content.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "group flex flex-col gap-3 p-4 rounded-lg border transition-all duration-200 cursor-pointer",
        "bg-zinc-900/50 hover:bg-zinc-900",
        "border-zinc-800 hover:border-zinc-700",
        typeConfig.hoverBorderColor
      )}
    >
      {/* Logo + Header Row */}
      <div className="flex items-start gap-3">
        {/* Company Logo */}
        <div className="shrink-0">
          {content.companyLogoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={content.companyLogoUrl}
              alt={content.companyName || "Company"}
              className="h-10 w-10 rounded-lg bg-zinc-800 object-contain p-1.5"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 text-sm font-medium text-zinc-400">
              {(content.companyName || "?").charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Header */}
        <div className="flex-1 flex items-start justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <h4 className="font-medium text-white truncate">
              {content.jobTitle || "Untitled Job"}
            </h4>
            <div className="flex items-center gap-2 mt-0.5 text-sm text-zinc-400">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{content.companyName || "Unknown Company"}</span>
            </div>
          </div>

          {/* Delete Button */}
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-8 w-8 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
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
                    className="bg-red-500 hover:bg-red-600 text-white"
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

      {/* Preview & Metadata */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-500">
        {/* Variants Indicator */}
        {content.history.length > 1 && (
          <span className="flex items-center gap-1 text-zinc-400">
            <Layers className="h-3 w-3" />
            {content.history.length} variants
          </span>
        )}

        {/* Preview */}
        <span className="truncate flex-1 min-w-0 mr-4">
          {(content.history[0]?.variant || content.content).slice(0, 80)}...
        </span>

        {/* Type Badge & Duration */}
        <div className="flex items-center gap-3 shrink-0">
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] h-5 px-1.5 border-0",
              typeConfig.bgColor,
              typeConfig.color
            )}
          >
            <TypeIcon className="h-3 w-3 mr-1" />
            {typeConfig.label}
          </Badge>
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-zinc-400" />
            {formatDate(content.updatedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function AIHistoryPage() {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [selectedContent, setSelectedContent] = useState<ContentResponse | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

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
      setSelectedContent(null);
    },
    onError: () => {
      toast.error("Failed to delete");
      setDeletingId(null);
    },
  });

  const handleDelete = (id: number) => {
    setDeletingId(id);
    deleteMutation.mutate(id);
  };

  const handleCardClick = (content: ContentResponse) => {
    window.scrollTo({ top: 0, behavior: "instant" });
    setSelectedContent(content);
    setIsDrawerOpen(true);
  };

  const handleDrawerOpenChange = (open: boolean) => {
    setIsDrawerOpen(open);
    if (!open) {
      setSelectedContent(null);
    }
  };

  const handleGenerate = async (userPrompt?: string) => {
    if (!selectedContent) return;

    try {
      const res = await fetch("/api/ai/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: selectedContent.jobId,
          type: selectedContent.type,
          userPrompt: userPrompt || null,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to generate");
      }

      const data = await res.json();
      setSelectedContent(data.content);
      queryClient.invalidateQueries({ queryKey: ["ai-history-all"] });
    } catch (error) {
      console.error("Generation error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to generate content");
    }
  };

  const handleSaveEdit = async (newContent: string, userPrompt?: string) => {
    if (!selectedContent) return;

    const res = await fetch(`/api/ai/content/${selectedContent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: newContent,
        userPrompt: userPrompt || "Manual edit",
      }),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to save");
    }

    const data = await res.json();
    setSelectedContent(data.content);
    queryClient.invalidateQueries({ queryKey: ["ai-history-all"] });
  };

  const contents = data?.contents || [];

  // Group by date
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

  const selectedTypeConfig = selectedContent ? getTypeConfig(selectedContent.type) : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (contents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center mb-4">
          <Wand2 className="h-8 w-8 text-zinc-600" />
        </div>
        <h3 className="text-lg font-medium text-white mb-1">No AI-generated content yet</h3>
        <p className="text-sm text-zinc-400 text-center max-w-md mb-6">
          Generate referral messages and cover letters from job pages to see them here
        </p>
        <Link href="/jobs">
          <Button variant="outline" className="border-zinc-700 hover:bg-zinc-800">
            <ExternalLink className="h-4 w-4 mr-2" />
            Browse Jobs
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-8">
        {Object.entries(groupedContents).map(([date, items]) => (
          <div key={date}>
            <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-3 sticky top-0 bg-zinc-950 py-2 z-10">
              {date}
            </h3>
            <div className="space-y-3">
              {items.map((content) => (
                <AIHistoryCard
                  key={content.id}
                  content={content}
                  onDelete={handleDelete}
                  isDeleting={deletingId === content.id}
                  onClick={() => handleCardClick(content)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {selectedContent && selectedTypeConfig && (
        <AIContentEditor
          isOpen={isDrawerOpen}
          onOpenChange={handleDrawerOpenChange}
          content={selectedContent}
          isLoading={false}
          onGenerate={handleGenerate}
          onSaveEdit={handleSaveEdit}
          title={selectedTypeConfig.label}
          description={
            selectedContent.type === "referral"
              ? `Message to send to your connection at ${selectedContent.companyName || "Unknown Company"} requesting a referral`
              : `Cover letter for ${selectedContent.jobTitle || "Untitled Job"} at ${selectedContent.companyName || "Unknown Company"}`
          }
          typeConfig={selectedTypeConfig}
        />
      )}
    </>
  );
}
