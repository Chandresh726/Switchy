"use client";

import { SessionDetail } from "@/components/scrape-history/session-detail";
import { use } from "react";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function HistoryDetailPage({ params }: PageProps) {
  const { id } = use(params);

  return (
    <div className="h-full">
      <SessionDetail sessionId={id} />
    </div>
  );
}
