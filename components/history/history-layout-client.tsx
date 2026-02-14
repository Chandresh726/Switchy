"use client";

import Link from "next/link";
import { History, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";
import { usePathname } from "next/navigation";

interface HistoryLayoutClientProps {
  children: React.ReactNode;
}

export function HistoryLayoutClient({ children }: HistoryLayoutClientProps) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);

  // Determine active tab from pathname
  // Handle base /history path explicitly - default to scrape tab
  const isScrapeTab = pathname === "/history" || (pathname?.startsWith("/history/scrape") ?? false);
  const isMatchTab = pathname?.startsWith("/history/match") ?? false;
  const isAITab = pathname?.startsWith("/history/ai") ?? false;
  const activeTab = isMatchTab ? "match" : isAITab ? "ai" : "scrape";

  // Check if we're on a detail page (has an ID after match, scrape, or ai)
  const isDetailPage = /^\/history\/(match|scrape|ai)\/[^/]+$/.test(pathname ?? "");

  const getTabLabel = () => {
    switch (activeTab) {
      case "scrape":
        return "Scrape";
      case "match":
        return "Match";
      case "ai":
        return "AI";
      default:
        return "Scrape";
    }
  };

  const handleClearHistory = async () => {
    setIsDeleting(true);
    try {
      let endpoint: string;
      let queryKey: string;

      switch (activeTab) {
        case "scrape":
          endpoint = "/api/scrape-history";
          queryKey = "scrape-history";
          break;
        case "match":
          endpoint = "/api/match-history";
          queryKey = "match-history";
          break;
        case "ai":
          endpoint = "/api/ai/history";
          queryKey = "ai-history-all";
          break;
        default:
          endpoint = "/api/scrape-history";
          queryKey = "scrape-history";
      }

      const res = await fetch(endpoint, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to clear history");

      queryClient.invalidateQueries({
        queryKey: [queryKey],
      });

      toast.success(`${getTabLabel()} history cleared successfully`);
    } catch (error) {
      console.error("Failed to clear history:", error);
      toast.error("Failed to clear history");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="h-full">
      {/* Header - Hide on detail pages */}
      {!isDetailPage && (
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">History</h1>
            <p className="mt-1 text-zinc-400">
              View scraping and matching operation history
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="border-red-500/20 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Clear {getTabLabel()} History
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all {activeTab === "scrape" ? "scrape" : activeTab === "match" ? "match" : "AI"} history records.
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleClearHistory}
                  className="bg-red-500 hover:bg-red-600 text-white"
                  disabled={isDeleting}
                >
                  {isDeleting ? "Clearing..." : "Yes, clear all"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {/* Tabs - Hide on detail pages */}
      {!isDetailPage && (
        <div className="mb-6 flex items-center gap-1 border-b border-zinc-800">
          <Link
            href="/history/scrape"
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              isScrapeTab
                ? "text-white border-emerald-500"
                : "text-zinc-400 border-transparent hover:text-zinc-200"
            }`}
          >
            <History className="h-4 w-4" />
            Scrape History
          </Link>
          <Link
            href="/history/match"
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              isMatchTab
                ? "text-white border-purple-500"
                : "text-zinc-400 border-transparent hover:text-zinc-200"
            }`}
          >
            <Sparkles className="h-4 w-4" />
            Match History
          </Link>
          <Link
            href="/history/ai"
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              isAITab
                ? "text-white border-blue-500"
                : "text-zinc-400 border-transparent hover:text-zinc-200"
            }`}
          >
            <Wand2 className="h-4 w-4" />
            AI History
          </Link>
        </div>
      )}

      {/* Tab Content */}
      {children}
    </div>
  );
}
