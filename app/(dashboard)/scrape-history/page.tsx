"use client";

import { SessionList } from "@/components/scrape-history/session-list";

export default function ScrapeHistoryPage() {
  return (
    <div className="h-full">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Scrape History</h1>
        <p className="mt-1 text-zinc-400">View history of job scraping operations</p>
      </div>

      {/* Session List */}
      <SessionList />
    </div>
  );
}
