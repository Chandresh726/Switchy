"use client";

import Link from "next/link";
import { History, Sparkles, Trash2, Wand2, type LucideIcon } from "lucide-react";
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
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { clearAIHistory } from "@/lib/api/clients/ai";
import {
  clearMatchHistory,
  clearScrapeHistory,
} from "@/lib/api/clients/history";
import { cacheOwnership } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/api/error-presentation";

interface HistoryLayoutClientProps {
  children: React.ReactNode;
}

interface HistoryTab {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  activeBorder: string;
  /** What "Clear <label> History" wipes, and what it deletes. */
  clearLabel: string;
  clearDescription: string;
  clear: (queryClient: QueryClient) => Promise<unknown>;
}

const HISTORY_TABS: HistoryTab[] = [
  {
    id: "scrape",
    label: "Scrape",
    href: "/history/scrape",
    icon: History,
    activeBorder: "border-emerald-500",
    clearLabel: "Scrape",
    clearDescription: "all scrape sessions and their company logs",
    clear: async (queryClient) => {
      await clearScrapeHistory();
      await cacheOwnership.clearScrapeHistory(queryClient);
    },
  },
  {
    id: "matching",
    label: "Matching",
    href: "/history/ai/matching",
    icon: Sparkles,
    activeBorder: "border-purple-500",
    clearLabel: "Match",
    clearDescription: "all match sessions and their per-job results",
    clear: async (queryClient) => {
      await clearMatchHistory();
      await cacheOwnership.clearMatchHistory(queryClient);
    },
  },
  {
    id: "writing",
    label: "Writing",
    href: "/history/ai/writing",
    icon: Wand2,
    activeBorder: "border-blue-500",
    clearLabel: "Writing",
    clearDescription: "all generated content and its variant history",
    clear: async (queryClient) => {
      await clearAIHistory();
      await cacheOwnership.clearAIContent(queryClient);
    },
  },
];

// Only scrape and match sessions have detail pages; writing links out to the
// job workspace instead.
const DETAIL_PATH = /^\/history\/(scrape|ai\/matching)\/[^/]+$/;

function resolveActiveTab(pathname: string | null): HistoryTab {
  const match = HISTORY_TABS.find((tab) => pathname?.startsWith(tab.href));
  return match ?? HISTORY_TABS[0];
}

export function HistoryLayoutClient({ children }: HistoryLayoutClientProps) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);

  const activeTab = resolveActiveTab(pathname);
  const isDetailPage = DETAIL_PATH.test(pathname ?? "");

  const handleClearHistory = async () => {
    setIsDeleting(true);
    try {
      await activeTab.clear(queryClient);
      toast.success(`${activeTab.clearLabel} history cleared successfully`);
    } catch (error) {
      console.error("Failed to clear history:", error);
      toast.error(getApiErrorMessage(error, "Failed to clear history"));
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
            <h1 className="text-2xl font-semibold text-foreground">History</h1>
            <p className="mt-1 text-muted-foreground">
              Scraping runs, AI matching, and AI writing activity
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
                Clear {activeTab.clearLabel} History
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete {activeTab.clearDescription}. AI
                  usage totals are kept, since they record model spend rather
                  than content. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleClearHistory}
                  className="bg-red-500 hover:bg-red-600 text-foreground"
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
        <div className="mb-6 flex items-center gap-1 border-b border-border">
          {HISTORY_TABS.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = tab.id === activeTab.id;
            return (
              <Link
                key={tab.id}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors",
                  isActive
                    ? cn("text-foreground", tab.activeBorder)
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <TabIcon className="h-4 w-4" />
                {tab.label}
              </Link>
            );
          })}
        </div>
      )}

      {/* Tab Content */}
      {children}
    </div>
  );
}
