"use client";

import { Send } from "lucide-react";

import { AIWorkspacePage } from "@/components/ai-workspace/ai-workspace-page";

export default function RecruiterFollowUpPage() {
  return (
    <AIWorkspacePage
      contentType="recruiter_follow_up"
      emptyStateDescription="Unable to load the job for recruiter follow-up."
      icon={Send}
      iconClassName="text-blue-400"
      peoplePanelDescription="Recruiters are surfaced first. Copy a personalized follow-up and send manually."
      peoplePanelEnabled
      peoplePanelTitle="People at this company"
      peoplePanelToggleLabel="Message Recruiters"
      requireApplied
      subtitle="Follow up after applying and ask for a review of your application."
      title="Recruiter Follow-up Workspace"
      workspaceHint="Generate concise post-application outreach and tailor it per recruiter."
    />
  );
}
