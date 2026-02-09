"use client";

import { useState } from "react";
import { History, Sparkles, Trash2 } from "lucide-react";
import { SessionList } from "@/components/scrape-history/session-list";
import { MatchHistoryTab } from "@/components/history/match-history-tab";
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

type TabType = "scrape" | "match";

export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState<TabType>("scrape");
  const [isDeleting, setIsDeleting] = useState(false);
  const queryClient = useQueryClient();

  const handleClearHistory = async () => {
    setIsDeleting(true);
    try {
      const endpoint =
        activeTab === "scrape" ? "/api/scrape-history" : "/api/match-history";

      const res = await fetch(endpoint, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to clear history");

      // Invalidate queries to refresh the list
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
        <button
          onClick={() => setActiveTab("scrape")}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === "scrape"
              ? "text-white border-emerald-500"
              : "text-zinc-400 border-transparent hover:text-zinc-200"
          }`}
        >
          <History className="h-4 w-4" />
          Scrape History
        </button>
        <button
          onClick={() => setActiveTab("match")}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === "match"
              ? "text-white border-purple-500"
              : "text-zinc-400 border-transparent hover:text-zinc-200"
          }`}
        >
          <Sparkles className="h-4 w-4" />
          Match History
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "scrape" && <SessionList />}
      {activeTab === "match" && <MatchHistoryTab />}
    </div>
  );
}
