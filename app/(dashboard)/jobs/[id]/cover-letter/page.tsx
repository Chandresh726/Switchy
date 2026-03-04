"use client";

import { FileText } from "lucide-react";

import { AIWorkspacePage } from "@/components/ai-workspace/ai-workspace-page";

export default function CoverLetterPage() {
  return (
    <AIWorkspacePage
      contentType="cover_letter"
      emptyStateDescription="Unable to load the job for cover letter generation."
      icon={FileText}
      iconClassName="text-emerald-400"
      subtitle="Generate, edit, and save rich-text cover letter variants."
      title="Cover Letter Workspace"
      workspaceHint="Create polished cover letters with bold emphasis and links when useful."
    />
  );
}
