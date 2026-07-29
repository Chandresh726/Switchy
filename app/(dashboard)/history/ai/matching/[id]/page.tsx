"use client";

import { MatchSessionDetail } from "@/components/history/match-session-detail";
import { use } from "react";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function MatchHistoryDetailPage({ params }: PageProps) {
  const { id } = use(params);

  return (
    <div className="h-full">
      <MatchSessionDetail sessionId={id} />
    </div>
  );
}
