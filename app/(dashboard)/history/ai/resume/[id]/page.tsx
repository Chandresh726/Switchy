"use client";

import { use } from "react";

import { ResumeHistoryDetail } from "@/components/history/resume-history-detail";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ResumeHistoryDetailPage({ params }: PageProps) {
  const { id } = use(params);

  return <ResumeHistoryDetail entryId={id} />;
}
