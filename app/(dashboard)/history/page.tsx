"use client";

import { useState } from "react";
import { History, Sparkles } from "lucide-react";
import { SessionList } from "@/components/scrape-history/session-list";
import { MatchHistoryTab } from "@/components/history/match-history-tab";

type TabType = "scrape" | "match";

export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState<TabType>("scrape");

  return (
    <div className="h-full">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">History</h1>
        <p className="mt-1 text-zinc-400">View scraping and matching operation history</p>
      </div>

      {/* Tabs */}
      <div className="mb-6 border-b border-zinc-800">
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab("scrape")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === "scrape"
                ? "text-white border-emerald-500"
                : "text-zinc-400 border-transparent hover:text-zinc-300"
            }`}
          >
            <History className="h-4 w-4" />
            Scrape History
          </button>
          <button
            onClick={() => setActiveTab("match")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === "match"
                ? "text-white border-purple-500"
                : "text-zinc-400 border-transparent hover:text-zinc-300"
            }`}
          >
            <Sparkles className="h-4 w-4" />
            Match History
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "scrape" && <SessionList />}
      {activeTab === "match" && <MatchHistoryTab />}
    </div>
  );
}
