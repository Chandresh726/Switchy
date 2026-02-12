"use client";

import Link from "next/link";
import { History, Sparkles, Trash2 } from "lucide-react";
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
  const activeTab = isMatchTab ? "match" : "scrape";

  const handleClearHistory = async () => {
    setIsDeleting(true);
    try {
      const endpoint =
        activeTab === "scrape" ? "/api/scrape-history" : "/api/match-history";

      const res = await fetch(endpoint, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to clear history");

      queryClient.invalidateQueries({
        queryKey: [activeTab === "scrape" ? "scrape-history" : "match-history"],
      });

      toast.success(
        `${activeTab === "scrape" ? "Scrape" : "Match"} history cleared successfully`
      );
    } catch (error) {
      console.error("Failed to clear history:", error);
      toast.error("Failed to clear history");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="h-full">
      {/* Header */}
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
              Clear {activeTab === "scrape" ? "Scrape" : "Match"} History
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete all{" "}
                {activeTab === "scrape" ? "scrape" : "match"} history records.
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

      {/* Tabs */}
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
      </div>

      {/* Tab Content */}
      {children}
    </div>
  );
}
